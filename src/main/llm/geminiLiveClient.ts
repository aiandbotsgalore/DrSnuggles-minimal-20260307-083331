/**
 * GEMINI LIVE CLIENT - December 2025 Standard
 *
 * Modern implementation using @google/genai SDK (v1.30.0+)
 * Model: gemini-2.5-flash-native-audio-preview-12-2025 (stable GA live audio model)
 * Audio: 16kHz 16-bit mono PCM → base64
 * Voice: Charon (hardcoded for Dr. Snuggles)
 *
 * Features:
 * - Native audio processing (single low-latency model)
 * - Affective dialogue (emotion, tone, pace awareness)
 * - Proactive audio (intelligent VAD)
 * - Async startChat() session API
 * - Exponential backoff reconnection
 * - Latency logging
 * - True turn-taking with VAD
 * - Audio-only responses
 */

import EventEmitter from "eventemitter3";
import {
  GoogleGenAI,
  Modality,
  StartSensitivity,
  EndSensitivity,
} from "@google/genai";
import { VoiceActivityDetector } from "../audio/vad";
import { DrSnugglesBrain } from "../../brain/DrSnugglesBrain";
import { GeminiDiagnostics, KNOWN_LIVE_MODELS } from "./geminiDiagnostics";
import {
  PERFORMANCE_CONFIG,
  FEATURE_FLAGS,
} from "../../config/performance.config";
import { telemetry } from "../telemetry/TelemetryService";
import {
  getOutputTranscriptionDelta,
  appendSessionContext,
} from "../../shared/stringUtils";

/** Response token details from usage metadata */
interface ResponseTokenDetail {
  modality?: string;
  tokenCount?: number;
}

/** Live API server message structure */
interface LiveServerMessage {
  setupComplete?: boolean;
  sessionResumptionUpdate?: {
    resumable?: boolean;
    newHandle?: string;
  };
  usageMetadata?: {
    totalTokenCount: number;
    responseTokensDetails?: ResponseTokenDetail[];
  };
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        };
      }>;
    };
    userTurn?: {
      parts?: Array<{ text?: string }>;
    };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
}

/** Live API session interface (subset we use) */
interface LiveSession {
  sendClientContent(content: {
    turns: Array<{
      role: string;
      parts: Array<{
        text?: string;
        functionResponse?: { name: string; response: Record<string, unknown> };
      }>;
    }>;
    turnComplete?: boolean;
  }): void;

  sendRealtimeInput(input: {
    audio?: { mimeType: string; data: string };
    mediaChunks?: Array<{ mimeType: string; data: string }>;
    audioStreamEnd?: boolean;
    activityStart?: Record<string, never>;
    activityEnd?: Record<string, never>;
  }): void;

  close(): void;
}

// Debug logging gate - controlled by FEATURE_FLAGS
const DEBUG = FEATURE_FLAGS.ENABLE_DEBUG_LOGS;
const LOCAL_VAD_ENABLED = FEATURE_FLAGS.ENABLE_LOCAL_VAD;
const POST_SPEAKING_COOLDOWN_MS = 2500;
const AUDIO_STREAMING_SAFETY_MS = 1000;

// Live API model selection - Use ACTUAL working models
// Updated Feb 2026: Using verified working model from diagnostics
// Removed unused candidates per Phase 2 audit
const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-12-2025";
const VOICE_NAME = "Charon"; // Deep, authoritative Dr. Snuggles voice
// SAFE_LIVE_CONFIG removed — affective dialog, proactive audio, and thinking are always enabled

// Reconnection config using PERFORMANCE_CONFIG
const RECONNECT_CONFIG = {
  maxAttempts: PERFORMANCE_CONFIG.NETWORK.MAX_RETRY_ATTEMPTS,
  initialDelay: PERFORMANCE_CONFIG.NETWORK.RETRY_DELAY_MS,
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: PERFORMANCE_CONFIG.NETWORK.RETRY_BACKOFF_MULTIPLIER,
  jitter: 500, // +/- 500ms random
};

/**
 * Dr. Snuggles System Prompt
 * Note: Complex prompt variant removed in audit cleanup - use Brain's updateSystemInstruction() for elaborate prompts
 */
const DR_SNUGGLES_PROMPT = `You are Dr. Snuggles. You are helpful, sarcastic, and scientific. Keep answers short.`;

/**
 * Events emitted by the GeminiLiveClient.
 */
export interface GeminiLiveClientEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  audioReceived: (audioData: Buffer, latencyMs: number) => void;
  error: (error: Error) => void;
  reconnecting: (attempt: number, delayMs: number) => void;
  message: (message: {
    id?: string;
    role: string;
    text: string;
    timestamp: number;
    streaming?: boolean;
  }) => void;
  userTranscription: (transcription: string, timestamp: number) => void; // User speech transcription
  interruption: () => void; // User started speaking
  thought: (thought: string) => void; // Internal thought process detected
  textForTTS: (text: string) => void; // Text response that needs ElevenLabs TTS
  usageMetadata: (usage: {
    totalTokenCount: number;
    responseTokensDetails?: ResponseTokenDetail[];
  }) => void; // Token usage stats
}

export interface SessionConfig {
  sessionSummaries?: string[];
  knowledgeContext?: string;
  personalityMix?: { comedy: number; research: number; energy: number };
  responseModalities?: Modality[]; // Allow overriding modalities
  enableInputTranscription?: boolean; // Enable inputAudioTranscription even in TEXT-only mode
  enableOutputTranscription?: boolean; // Enable outputAudioTranscription even in TEXT-only mode
  model?: string; // Force a specific model
  modelCandidates?: string[]; // Override fallback model list
  mediaResolution?:
    | "MEDIA_RESOLUTION_LOW"
    | "MEDIA_RESOLUTION_MEDIUM"
    | "MEDIA_RESOLUTION_HIGH"; // Resolution for image/video inputs
  thinkingBudget?: number; // Thinking budget in tokens (0 = off, default 1024)
  startSensitivity?: StartSensitivity | "Low" | "Medium" | "High"; // VAD start sensitivity
  endSensitivity?: EndSensitivity | "Low" | "Medium" | "High"; // VAD end sensitivity
}

/**
 * Client for the Gemini Live API (2025 Implementation).
 *
 * Features turn-based voice activity detection, automatic reconnection with backoff,
 * and integration with the modern Google GenAI SDK.
 */
export class GeminiLiveClient extends EventEmitter<GeminiLiveClientEvents> {
  private genAI: GoogleGenAI;
  private session: LiveSession | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect: boolean = true;
  private lastConfig: SessionConfig = {};
  private previousSessionHandle: string | null = null;
  private vad: VoiceActivityDetector;
  private brain: DrSnugglesBrain | null = null; // Brain integration
  private connectionAbortController: AbortController | null = null;

  // Latency tracking
  private lastChunkSentTime: number = 0;
  private requestStartTime: number = 0; // For RTT telemetry
  private hasReceivedResponseThisTurn: boolean = false; // Track first chunk per turn

  // Speaking timeout fallback - clears Gemini speaking state if no audio arrives
  private speakingTimeout: NodeJS.Timeout | null = null;
  private readonly SPEAKING_TIMEOUT_MS = 5000;

  // Echo guard: timestamp of when last audio output ended (turnComplete + buffer).
  // inputTranscription events arriving within ECHO_GUARD_MS of this time are
  // Gemini's own speech mis-labeled as user input — suppress them.
  private lastAudioOutputEndTime: number = 0;
  private readonly ECHO_GUARD_MS = 8000; // 8 seconds — generous to cover server-side lag

  // Text modality tracking (for STT fallback decision)
  private _isTextModalityWorking: boolean = false;

  // Streaming transcription state (prevents re-emitting full text repeatedly)
  private lastInputTranscriptionText: string = "";
  private lastOutputTranscriptionText: string = "";
  private lastAssistantResponseText: string = "";
  private currentAssistantStreamId: string | null = null;

  // Debounce user transcription: accumulate deltas and emit as one chunk
  private pendingUserTranscription: string = "";
  private userTranscriptionTimer: NodeJS.Timeout | null = null;
  private readonly USER_TRANSCRIPTION_DEBOUNCE_MS = 400;

  // Current voice (can be changed dynamically)
  private currentVoice: string = VOICE_NAME;

  // Voice mode: 'gemini-native' uses Gemini's audio, 'elevenlabs-custom' uses text→ElevenLabs
  private voiceMode: "gemini-native" | "elevenlabs-custom" = "gemini-native";
  private interruptionsEnabled: boolean = false;
  private isAssistantSpeaking: boolean = false;
  private isAssistantCooldown: boolean = false;
  private cooldownTimer: NodeJS.Timeout | null = null;
  private playbackEndTime: number = 0; // Virtual clock for when audio finishes playing

  /**
   * Initializes the GeminiLiveClient.
   *
   * @param {string} apiKey - The API key for Gemini.
   * @param {DrSnugglesBrain} [brain] - Optional brain for memory and personality integration.
   */
  constructor(apiKey: string, brain?: DrSnugglesBrain) {
    super();
    // Use v1alpha API version for native audio features (affective dialog, proactive audio, thinking)
    this.genAI = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
    // Use configured sample rate (48000)
    this.vad = new VoiceActivityDetector({
      sampleRate: PERFORMANCE_CONFIG.AUDIO.SAMPLE_RATE,
    });
    this.brain = brain || null;

    console.log("[GeminiLiveClient] Initialized with SDK v1.30.0+");
    console.log(`[GeminiLiveClient] Model: ${MODEL_NAME}`);
    console.log(`[GeminiLiveClient] Voice: ${this.currentVoice}`);

    if (this.brain) {
      console.log("[GeminiLiveClient] Brain integration ACTIVE");
    }

    // Hybrid VAD events
    if (LOCAL_VAD_ENABLED) {
      this.vad.on("speech", () => {
        if (!this.interruptionsEnabled) {
          return;
        }
        console.log(
          `[GeminiLiveClient] 🎤 Local VAD speech detected (THRESHOLD EXCEEDED). Emitting interruption signal.`,
        );
        this.emit("interruption");
      });

      // Hybrid VAD: Trigger end-of-turn when local VAD detects silence
      // This ensures responsiveness even if server-side VAD lags
      this.vad.on("silence", () => {
        if (!this.interruptionsEnabled) {
          return;
        }
        if (this.isConnected && this.session) {
          console.log(
            "[GeminiLiveClient] 🔇 Local VAD silence. Forcing turn complete.",
          );
          // Use sendRealtimeInput to signal end of stream, avoiding conflict with realtime mode
          this.session.sendRealtimeInput({ audioStreamEnd: true });
        }
      });
    } else {
      console.log(
        "[GeminiLiveClient] 💤 Local VAD disabled (server-side VAD only)",
      );
    }

    // Initialize Brain with Basic Prompt (Overrides default character.json)
    if (this.brain) {
      console.log(
        "[GeminiLiveClient] Initializing Brain with BASIC default prompt",
      );
      this.brain.updateSystemInstruction(DR_SNUGGLES_PROMPT);
    }
  }

  /**
   * Start live session with Gemini.
   * Connects to the service and sets up event callbacks.
   *
   * @param {SessionConfig} [config={}] - Configuration for the session.
   * @returns {Promise<void>}
   */
  public async connect(config: SessionConfig = {}): Promise<void> {
    if (this.isConnected) {
      console.warn("[GeminiLiveClient] Already connected");
      return;
    }

    this.lastConfig = config;
    this.shouldReconnect = true;

    // Create new AbortController for this connection attempt
    if (this.connectionAbortController) {
      this.connectionAbortController.abort();
    }
    this.connectionAbortController = new AbortController();
    const signal = this.connectionAbortController.signal;

    // Simplified model selection - prioritize the required model
    const selectedModel = MODEL_NAME;

    // Helper to attempt connection
    const tryConnect = async (isRetryInstruction = false): Promise<void> => {
      try {
        console.log(
          `[GeminiLiveClient] Starting session... (Retry: ${isRetryInstruction}, Model: ${selectedModel})`,
        );

        // Build system instruction (async if brain is active)
        let systemInstruction = await this.buildSystemInstruction(config);

        // FALLBACK: If this is a retry after invalid argument, use simple instruction
        if (isRetryInstruction) {
          console.warn(
            "[GeminiLiveClient] ⚠️ USING FALLBACK SYSTEM INSTRUCTION due to previous error",
          );
          systemInstruction =
            "You are Dr. Snuggles. You are helpful, sarcastic, and scientific. Keep answers short.";
        }

        // 🔍 DEBUG: Log system instruction stats
        console.log(
          `[GeminiLiveClient] System Instruction Length: ${systemInstruction.length} chars`,
        );

        // Build the config for logging/debugging.
        // Keep Gemini in AUDIO mode even when using ElevenLabs custom voice.
        const responseModalities = config.responseModalities || [
          Modality.AUDIO,
        ];
        const isAudioMode = responseModalities.includes(Modality.AUDIO);

        console.log(`[GeminiLiveClient] 🎙️ Voice Mode: ${this.voiceMode}`);
        console.log(
          `[GeminiLiveClient] Selected model: ${selectedModel} (Audio mode: ${isAudioMode})`,
        );

        // Only include speechConfig if AUDIO modality is requested
        // TEXT-only mode cannot have voice settings
        const liveConfig: any = {
          responseModalities,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          // Enable infinite sessions via context window compression
          contextWindowCompression: {
            slidingWindow: {},
          },
          // Enable session resumption if we have a handle
          sessionResumption: this.previousSessionHandle
            ? {
                handle: this.previousSessionHandle,
              }
            : undefined,
        };

        if (this.brain) {
          const tools = this.brain.getToolManifest();
          if (tools && tools.length > 0) {
            liveConfig.tools = tools;
          }
        }

        // Transcriptions (can be enabled regardless of response modality when audio is being streamed)
        if (isAudioMode || config.enableInputTranscription) {
          liveConfig.inputAudioTranscription = {};
        }
        if (isAudioMode || config.enableOutputTranscription) {
          liveConfig.outputAudioTranscription = {};
        }

        // Only include speechConfig if AUDIO modality is requested
        // TEXT-only mode cannot have voice settings
        if (isAudioMode) {
          liveConfig.speechConfig = {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.currentVoice,
              },
            },
          };

          // Always enable advanced voice capabilities
          liveConfig.enableAffectiveDialog = true;
          liveConfig.proactivity = { proactiveAudio: true };
          liveConfig.thinkingConfig = {
            thinkingBudget:
              config.thinkingBudget !== undefined
                ? config.thinkingBudget
                : 1024,
            includeThoughts: true,
          };

          // Map VAD sensitivities to SDK Enums
          const startSensitivityMap: Record<string, StartSensitivity> = {
            Low: StartSensitivity.START_SENSITIVITY_LOW,
            Medium: StartSensitivity.START_SENSITIVITY_LOW, // Default
            High: StartSensitivity.START_SENSITIVITY_HIGH,
          };

          const endSensitivityMap: Record<string, EndSensitivity> = {
            Low: EndSensitivity.END_SENSITIVITY_LOW,
            Medium: EndSensitivity.END_SENSITIVITY_LOW, // Default
            High: EndSensitivity.END_SENSITIVITY_HIGH,
          };

          // Automatic VAD configuration for better turn-taking
          liveConfig.realtimeInputConfig = {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity:
                typeof config.startSensitivity === "string"
                  ? startSensitivityMap[config.startSensitivity] ||
                    StartSensitivity.START_SENSITIVITY_HIGH
                  : config.startSensitivity ||
                    StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity:
                typeof config.endSensitivity === "string"
                  ? endSensitivityMap[config.endSensitivity] ||
                    EndSensitivity.END_SENSITIVITY_HIGH
                  : config.endSensitivity ||
                    EndSensitivity.END_SENSITIVITY_HIGH,
              prefixPaddingMs: 20,
              silenceDurationMs: 500,
            },
          };
        }

        // Media resolution for image/video inputs
        if (config.mediaResolution) {
          liveConfig.mediaResolution = config.mediaResolution;
        }

        // 🔍 DIAGNOSTIC: Log full configuration
        GeminiDiagnostics.logConfig(
          { model: selectedModel, ...liveConfig },
          "Live API Request",
        );

        telemetry.updateWSStatus("connecting");

        // Check if aborted before assigning session
        if (signal.aborted) {
          console.log(
            "[GeminiLiveClient] Connection aborted before completion",
          );
          return;
        }

        this.session = await this.genAI.live.connect({
          model: selectedModel,
          config: liveConfig,
          callbacks: {
            onopen: () => {
              if (signal.aborted) {
                console.log("[GeminiLiveClient] Connection aborted after open");
                this.disconnect();
                return;
              }
              this.isConnected = true;
              this.reconnectAttempts = 0;
              telemetry.updateWSStatus("connected");
              this.emit("connected");
              console.log("[GeminiLiveClient] ✅ Connected successfully");
              console.log(
                "[GeminiLiveClient] Session Keys:",
                Object.keys(this.session || {}),
              );
            },
            onmessage: (e: any) => this.handleMessage(e),
            onerror: (e: any) => {
              console.error("[GeminiLiveClient] Error:", e.error);
              telemetry.updateWSStatus("error");
              this.emit("error", e.error);
              if (this.shouldReconnect && !signal.aborted) {
                this.scheduleReconnect();
              }
            },
            onclose: (e: any) => {
              // Parse and log the close code with actionable diagnostic information
              const diagnosis = GeminiDiagnostics.parseCloseCode(
                e.code,
                e.reason,
              );
              console.error(
                `[GeminiLiveClient] Connection closed:\n   ${diagnosis}`,
              );
              this.isConnected = false;
              telemetry.updateWSStatus("disconnected");
              this.emit("disconnected", e.reason || "Connection closed");

              // KILL SWITCH: Stop reconnecting only on explicit auth/API key errors.
              // Code 1008 may also mean capability/policy mismatch, which can be transient.
              if (
                e.code === 1007 ||
                (e.reason && e.reason.toLowerCase().includes("api key"))
              ) {
                console.error(
                  "[GeminiLiveClient] 🛑 AUTH/CONFIG ERROR - Stopping reconnection attempts",
                );
                console.error(
                  `[GeminiLiveClient] 💡 Try one of these models: ${KNOWN_LIVE_MODELS.slice(0, 3).join(", ")}`,
                );
                this.shouldReconnect = false;
                this.emit("error", new Error(`Connection failed: ${e.reason}`));
                return;
              }

              // Reconnect on abnormal closure (but not on normal close or auth errors)
              if (
                this.shouldReconnect &&
                e.code !== 1000 &&
                e.code !== 1001 &&
                !signal.aborted
              ) {
                this.scheduleReconnect();
              }
            },
          },
        });

        console.log("[GeminiLiveClient] Session connecting...");
      } catch (error: any) {
        if (signal.aborted) {
          console.log("[GeminiLiveClient] Connection aborted during setup");
          return;
        }

        console.error("[GeminiLiveClient] Connection failed:", error);

        // Check for "invalid argument" and retry ONCE with simple config
        if (
          !isRetryInstruction &&
          (error.message?.includes("invalid argument") ||
            error.message?.includes("InvalidArgument"))
        ) {
          console.log(
            "[GeminiLiveClient] ⚠️ Caught Invalid Argument error. Retrying with simplified config...",
          );
          await tryConnect(true);
          return;
        }

        this.emit("error", error as Error);
        if (this.shouldReconnect && !isRetryInstruction) {
          // Don't schedule reconnect if fallback also failed immediately
          this.scheduleReconnect();
        }
        throw error;
      }
    };

    await tryConnect(false);
  }

  /**
   * Send a text message to Gemini to trigger a voice response.
   * Useful for initial greetings or fallback mode.
   *
   * @param {string} text - The text to send.
   * @returns {Promise<void>}
   */
  public async sendText(text: string): Promise<void> {
    if (!this.isConnected || !this.session) {
      console.warn("[GeminiLiveClient] Cannot send text - not connected");
      return;
    }

    try {
      // Use formal turn structure for maximum compatibility
      await this.session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      });
      console.log("[GeminiLiveClient] 📝 Sent text message:", text);
    } catch (error) {
      console.error("[GeminiLiveClient] Failed to send text:", error);
      this.emit("error", error as Error);
    }
  }

  private isMuted: boolean = false;

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    console.log(`[GeminiLiveClient] Mute state set to: ${muted}`);
  }

  /**
   * Set the voice for audio output.
   * Note: Requires reconnection to take effect.
   *
   * @param {string} voice - The voice name (e.g., 'Charon', 'Kore', 'Puck').
   */
  public setVoice(voice: string): void {
    this.currentVoice = voice;
    console.log(`[GeminiLiveClient] Voice set to: ${voice}`);
    console.log(
      `[GeminiLiveClient] ⚠️ Note: Reconnect required for voice change to take effect`,
    );
  }

  /**
   * Get the current voice.
   * @returns {string} The current voice name.
   */
  public getVoice(): string {
    return this.currentVoice;
  }

  /**
   * Set voice generation mode.
   * 'gemini-native' = Gemini generates audio directly (Charon voice, affective dialogue)
   * 'elevenlabs-custom' = Gemini returns text, ElevenLabs generates audio (custom voice)
   *
   * @param {string} mode - Voice mode to use
   * @returns {Promise<void>}
   */
  public async setVoiceMode(
    mode: "gemini-native" | "elevenlabs-custom",
  ): Promise<void> {
    if (this.voiceMode === mode) {
      console.log(`[GeminiLiveClient] Voice mode already set to: ${mode}`);
      return;
    }

    this.voiceMode = mode;
    console.log(`[GeminiLiveClient] 🎙️ Voice mode changed to: ${mode}`);

    // If connected, reconnect with new modality
    if (this.isConnected) {
      console.log("[GeminiLiveClient] Reconnecting with new voice mode...");
      await this.disconnect();
      await this.connect(this.lastConfig);
    }
  }

  /**
   * Get current voice generation mode.
   */
  public getVoiceMode(): "gemini-native" | "elevenlabs-custom" {
    return this.voiceMode;
  }

  /**
   * Check if client is currently connected.
   * @returns {boolean} True if connected.
   */
  public get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Send audio chunk to Gemini (16kHz PCM16 base64).
   * Accepts raw Buffer of s16le bytes from NativeAudioManager — zero resampling.
   *
   * @param {Buffer} rawS16leBuffer - Raw 16kHz s16le PCM bytes from ffmpeg.
   * @returns {Promise<number>} The latency of the send operation, or 0 if skipped.
   */
  public async sendAudio(rawS16leBuffer: Buffer): Promise<number> {
    if (!this.isConnected || !this.session) {
      if (DEBUG)
        console.log(
          "[GeminiLiveClient] 🚫 Audio gate: not connected (isConnected=%s, session=%s)",
          this.isConnected,
          !!this.session,
        );
      return 0;
    }

    if (this.isMuted) {
      if (DEBUG) console.log("[GeminiLiveClient] 🚫 Audio gate: muted");
      return 0;
    }

    // DEBUG: Log status of speaking/cooldown states
    if (DEBUG && (this.isAssistantSpeaking || this.isAssistantCooldown)) {
      console.log(
        `[GeminiLiveClient] 🔍 Gate Check: speaking=${this.isAssistantSpeaking}, cooldown=${this.isAssistantCooldown}, interrupts=${this.interruptionsEnabled}`,
      );
    }

    if (!this.interruptionsEnabled) {
      if (this.isAssistantSpeaking || this.isAssistantCooldown) {
        if (DEBUG && Math.random() < 0.05) {
          const remainingMs = Math.max(0, this.playbackEndTime - Date.now());
          console.log(
            `[GeminiLiveClient] 🛡️ GATE BLOCKED: Assistant speaking/cooldown. Remaining play: ${remainingMs.toFixed(0)}ms`,
          );
        }
        return 0;
      }
    }

    const startTime = performance.now();
    this.lastChunkSentTime = startTime;

    if (!this.hasReceivedResponseThisTurn && this.requestStartTime === 0) {
      this.requestStartTime = startTime;
    }

    try {
      // Zero resampling: raw s16le bytes → base64 directly
      const base64Audio = rawS16leBuffer.toString("base64");

      if (!base64Audio || base64Audio.length === 0) {
        console.warn("[GeminiLiveClient] Skipping empty audio chunk");
        return 0;
      }

      await this.session.sendRealtimeInput({
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Audio,
        },
      });

      const latency = performance.now() - startTime;
      if (DEBUG)
        console.log(
          `[GeminiLiveClient] 📤 Sent audio chunk (${rawS16leBuffer.length} bytes, latency: ${latency.toFixed(2)}ms)`,
        );

      return latency;
    } catch (error) {
      console.error("[GeminiLiveClient] Failed to send audio:", error);
      this.emit("error", error as Error);
      return -1;
    }
  }

  /**
   * Send an image to Gemini (base64).
   * Used for Multimodal vision (screenshots).
   *
   * @param {string} base64Image - The base64-encoded image (JPEG/PNG).
   */
  public async sendImage(base64Image: string): Promise<void> {
    if (!this.isConnected || !this.session) {
      console.warn("[GeminiLiveClient] Cannot send image - not connected");
      return;
    }

    try {
      console.log(
        `[GeminiLiveClient] 📸 Sending image (${base64Image.length} bytes)...`,
      );

      await this.session.sendRealtimeInput({
        mediaChunks: [
          {
            mimeType: "image/jpeg",
            data: base64Image,
          },
        ],
      });

      console.log("[GeminiLiveClient] ✅ Image sent successfully");
    } catch (error) {
      console.error("[GeminiLiveClient] Failed to send image:", error);
      this.emit("error", error as Error);
    }
  }

  /**
   * Disconnect session.
   * Stops reconnection attempts and closes the session.
   *
   * @returns {Promise<void>}
   */
  public async disconnect(): Promise<void> {
    console.log("[GeminiLiveClient] Disconnecting...");

    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Abort any pending connection attempts
    if (this.connectionAbortController) {
      this.connectionAbortController.abort();
      this.connectionAbortController = null;
    }

    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
      this.speakingTimeout = null;
    }

    if (this.session) {
      try {
        // Close session if SDK provides close method
        if (typeof this.session.close === "function") {
          await this.session.close();
        }
      } catch (error) {
        console.error("[GeminiLiveClient] Error closing session:", error);
      }
      this.session = null;
    }

    this.isConnected = false;
    this.isAssistantSpeaking = false;
    this.vad.reset();
    this.emit("disconnected", "User disconnect");

    console.log("[GeminiLiveClient] Disconnected");
  }

  /**
   * Get VAD state.
   * @returns {object} The current state of the Voice Activity Detector.
   */
  public getVADState() {
    return this.vad.getState();
  }

  public setInterruptionsEnabled(enabled: boolean): void {
    this.interruptionsEnabled = Boolean(enabled);
    console.log(
      `[GeminiLiveClient] Interruption gate: ${this.interruptionsEnabled ? "enabled" : "disabled"}`,
    );
  }

  /**
   * Update VAD configuration at runtime.
   * Allows dynamic adjustment of voice activity detection sensitivity.
   *
   * @param {Partial<import('../audio/vad').VADConfig>} config - Partial VAD configuration to update.
   */
  public updateVADConfig(config: {
    rmsThreshold?: number;
    minSpeechFrames?: number;
    minSilenceFrames?: number;
    zcrThreshold?: number;
  }): void {
    console.log("[GeminiLiveClient] Updating VAD config:", config);
    this.vad.updateConfig(config);
  }

  /**
   * Check if text modality is working (for STT fallback decision).
   * @returns {boolean} True if text has been received from Gemini.
   */
  public get isTextModalityWorking(): boolean {
    return this._isTextModalityWorking;
  }

  // ===== PRIVATE METHODS =====

  /**
   * Handle incoming message from Gemini.
   * Processes audio responses and manages turn-taking.
   *
   * @param {object} event - The message event.
   */
  private _handleMessageCount: number = 0;
  private _audioStringCount: number = 0;

  private async handleMessage(
    event: { data?: LiveServerMessage | string } | LiveServerMessage | string,
  ): Promise<void> {
    try {
      // The SDK already parses JSON messages for us
      const message: LiveServerMessage | string =
        (event as { data?: LiveServerMessage | string }).data ??
        (event as LiveServerMessage | string);

      // 🔍 AUDIT: Count every message so we know handleMessage is being called
      this._handleMessageCount++;
      if (
        this._handleMessageCount <= 5 ||
        this._handleMessageCount % 100 === 0
      ) {
        console.log(
          `[GeminiLiveClient] 📩 handleMessage #${this._handleMessageCount} — type: ${typeof message}`,
        );
      }

      // Skip logging for binary/base64 audio data
      if (typeof message === "string") {
        if (LOCAL_VAD_ENABLED) {
          // 🎤 Blind VAD while Gemini is talking to prevent feedback interruptions
          this.vad.setGeminiSpeaking(true);
        }

        // 🔊 NATIVE AUDIO: The model sends raw base64 strings for audio
        this._audioStringCount++;
        console.log(
          `[GeminiLiveClient] 🔊 Audio string path #${this._audioStringCount}: ${message.length} chars`,
        );

        try {
          // Zero resampling: base64 → raw 24kHz s16le Buffer
          const audioData = Buffer.from(message, "base64");

          const latency =
            this.lastChunkSentTime > 0
              ? performance.now() - this.lastChunkSentTime
              : 0;

          console.log(
            `[GeminiLiveClient] 🔊 Emitting audioReceived (string path): ${audioData.length} bytes`,
          );
          this.emit("audioReceived", audioData, latency);
        } catch (e) {
          console.error("[GeminiLiveClient] Failed to process audio chunk:", e);
        }
        return;
      }

      // 🔍 DIAGNOSTIC: Log ALL JSON messages to debug what we're receiving
      if (DEBUG)
        console.log(
          "[GeminiLiveClient] 📨 Received message:",
          JSON.stringify(message, null, 2),
        );

      // Handle setup complete  - connection ready for realtime audio
      if (message.setupComplete) {
        console.log(
          "[GeminiLiveClient] Setup complete - ready for voice conversation",
        );
        return;
      }

      // Handle Session Resumption Update (Keep session alive across reconnections)
      if (message.sessionResumptionUpdate) {
        const update = message.sessionResumptionUpdate;
        if (update.resumable && update.newHandle) {
          console.log(
            "[GeminiLiveClient] 🔄 Received Session Resumption Handle:",
            update.newHandle,
          );
          this.previousSessionHandle = update.newHandle;
        }
      }

      // Handle token usage metadata
      if (message.usageMetadata) {
        const usage = message.usageMetadata;
        console.log(
          `[GeminiLiveClient] 📊 Token usage: ${usage.totalTokenCount} total`,
        );
        if (DEBUG && usage.responseTokensDetails) {
          for (const detail of usage.responseTokensDetails) {
            if (detail.modality && detail.tokenCount) {
              console.log(
                `[GeminiLiveClient]    ${detail.modality}: ${detail.tokenCount}`,
              );
            }
          }
        }
        this.emit("usageMetadata", {
          totalTokenCount: usage.totalTokenCount,
          responseTokensDetails: usage.responseTokensDetails,
        });
      }

      // Handle server content (model turn, user turn, transcriptions)
      if (message.serverContent) {
        await this.handleServerContent(message.serverContent);
      }
    } catch (error) {
      console.error("[GeminiLiveClient] Error handling message:", error);
      this.emit("error", error as Error);
    }
  }

  /**
   * Handle detailed server content from Gemini.
   */
  private async handleServerContent(
    content: NonNullable<LiveServerMessage["serverContent"]>,
  ): Promise<void> {
    // 🔍 DEBUG: Log full server content to find where audio is hiding
    if (DEBUG)
      console.log(
        "[GeminiLiveClient] 🔍 SERVER CONTENT:",
        JSON.stringify(content, null, 2),
      );

    // 1. Handle Input Transcription (User Speech)
    // ECHO GUARD: Suppress input transcriptions that are actually Gemini's own speech.
    // The server-side inputTranscription mis-labels the model's audio as "user" input.
    // These arrive during speaking AND for several seconds after turnComplete.
    if (content.inputTranscription?.text || content.userTurn?.parts) {
      const msSinceLastOutput = Date.now() - this.lastAudioOutputEndTime;
      const isInEchoWindow =
        this.isAssistantSpeaking ||
        this.isAssistantCooldown ||
        (this.lastAudioOutputEndTime > 0 &&
          msSinceLastOutput < this.ECHO_GUARD_MS);

      if (isInEchoWindow) {
        console.log(
          `[GeminiLiveClient] 🛡️ ECHO GUARD: Suppressed inputTranscription (speaking=${this.isAssistantSpeaking}, cooldown=${this.isAssistantCooldown}, msSinceOutput=${msSinceLastOutput.toFixed(0)}):`,
          content.inputTranscription?.text?.substring(0, 50),
        );
      } else {
        this.handleInputTranscription(content);
      }
    }

    // 2. Handle Output Transcription (Model Speech Text)
    // This is used for the UI transcript when audio is playing
    let outputTranscriptionText = content.outputTranscription?.text || null;

    // 3. Handle Model Turn (Audio & Tools)
    let assistantEmittedThisMessage = false;

    if (content.modelTurn?.parts) {
      if (LOCAL_VAD_ENABLED) {
        this.vad.setGeminiSpeaking(true);
      }

      let textContent = "";

      for (const part of content.modelTurn.parts) {
        // 🔍 DEBUG: Log part MIME types to see if audio is present
        if (DEBUG) {
          console.log(
            "[GeminiLiveClient] Processing part. MimeType:",
            part.inlineData?.mimeType,
            "Text:",
            part.text ? "(text content)" : "none",
          );
        }

        // Handle Native Thoughts
        if ((part as any).thought) {
          const nativeThought = (part as any).thought;
          if (DEBUG) console.log("🧠 [NATIVE THOUGHT]:", nativeThought);
          this.emit("thought", nativeThought);
        }

        // Handle Audio
        if (part.inlineData?.mimeType?.startsWith("audio/")) {
          this.handleAudioPart(part.inlineData.data);
        }

        // Handle Text (accumulate for processing)
        if (part.text) {
          textContent += part.text;
        }

        // Handle Function Calls
        if (part.functionCall) {
          await this.handleToolCall(part.functionCall);
        }
      }

      // Process accumulated text (Thoughts & Dialogue)
      if (textContent) {
        this.processModelText(textContent);
        assistantEmittedThisMessage = true;
      } else if (
        typeof outputTranscriptionText === "string" &&
        outputTranscriptionText.trim()
      ) {
        // Fallback to output transcription if no text part
        this.processModelText(outputTranscriptionText, true);
        assistantEmittedThisMessage = true;
      }
    }

    // 4. Fallback: If no model turn but we have output transcription
    if (
      !assistantEmittedThisMessage &&
      typeof outputTranscriptionText === "string" &&
      outputTranscriptionText.trim()
    ) {
      this.processModelText(outputTranscriptionText, true);
    }

    // 5. Handle Turn Completion
    if (content.turnComplete) {
      if (this.isAssistantSpeaking) {
        const remainingPlaybackMs = Math.max(
          0,
          this.playbackEndTime - Date.now(),
        );
        const totalCooldown = remainingPlaybackMs + POST_SPEAKING_COOLDOWN_MS;

        console.log(
          `[GeminiLiveClient] ⏲️ Assistant finished generation. Buffered audio: ${remainingPlaybackMs.toFixed(0)}ms. Total gate delay: ${totalCooldown.toFixed(0)}ms`,
        );

        this.isAssistantCooldown = true;
        if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
        this.cooldownTimer = setTimeout(() => {
          this.isAssistantCooldown = false;
          this.isAssistantSpeaking = false;
          if (LOCAL_VAD_ENABLED) {
            this.vad.setGeminiSpeaking(false);
          }
          console.log(
            "[GeminiLiveClient] ✅ Virtual playback + cooldown finished, mic re-enabled",
          );
        }, totalCooldown);
      } else {
        this.isAssistantSpeaking = false;
        if (LOCAL_VAD_ENABLED) {
          this.vad.setGeminiSpeaking(false);
        }
      }

      // Stamp when the assistant finished so the echo guard can reject
      // stale inputTranscriptions that arrive after turnComplete.
      this.lastAudioOutputEndTime = Date.now();

      // Flush any pending user transcription
      if (this.userTranscriptionTimer) {
        clearTimeout(this.userTranscriptionTimer);
        this.userTranscriptionTimer = null;
      }
      if (this.pendingUserTranscription.trim()) {
        this.emit(
          "userTranscription",
          this.pendingUserTranscription,
          Date.now(),
        );
        this.brain?.addToBuffer("user", this.pendingUserTranscription);
        this.pendingUserTranscription = "";
      }

      this.lastInputTranscriptionText = "";
      this.lastOutputTranscriptionText = "";
      this.lastAssistantResponseText = "";
      this.currentAssistantStreamId = null;
      this.hasReceivedResponseThisTurn = false;
      console.log("[GeminiLiveClient] 🔄 Turn complete, user can speak");
    }

    // 6. Handle Interruption
    if (content.interrupted) {
      console.log("[GeminiLiveClient] 🛑 Gemini was interrupted");
      this.isAssistantSpeaking = false;
      this.isAssistantCooldown = false;
      this.playbackEndTime = 0; // Clear virtual playback clock on interruption
      if (this.cooldownTimer) {
        clearTimeout(this.cooldownTimer);
        this.cooldownTimer = null;
      }
      if (LOCAL_VAD_ENABLED) {
        this.vad.setGeminiSpeaking(false);
      }
    }
  }

  /**
   * Handle input transcription (what user said).
   */
  private handleInputTranscription(
    content: NonNullable<LiveServerMessage["serverContent"]>,
  ): void {
    // Streamed transcription delta
    const inputTranscriptionText = content.inputTranscription?.text;
    if (
      typeof inputTranscriptionText === "string" &&
      inputTranscriptionText.trim()
    ) {
      const delta = getOutputTranscriptionDelta(
        inputTranscriptionText,
        this.lastInputTranscriptionText,
      );
      this.lastInputTranscriptionText = inputTranscriptionText;

      if (delta.trim()) {
        if (DEBUG)
          console.log(
            "[GeminiLiveClient] 👤 INPUT TRANSCRIPTION (delta):",
            delta,
          );
        // Debounce: accumulate deltas and emit as one coherent chunk
        this.pendingUserTranscription += delta;
        if (this.userTranscriptionTimer) {
          clearTimeout(this.userTranscriptionTimer);
        }
        this.userTranscriptionTimer = setTimeout(() => {
          if (this.pendingUserTranscription.trim()) {
            this.emit(
              "userTranscription",
              this.pendingUserTranscription,
              Date.now(),
            );
            this.brain?.addToBuffer("user", this.pendingUserTranscription);
            this.pendingUserTranscription = "";
          }
          this.userTranscriptionTimer = null;
        }, this.USER_TRANSCRIPTION_DEBOUNCE_MS);
      }
    }

    // Final user turn parts
    if (!inputTranscriptionText && content.userTurn?.parts) {
      let userTranscription = "";
      for (const part of content.userTurn.parts) {
        if (part.text) userTranscription += part.text;
      }
      if (userTranscription) {
        if (DEBUG) console.log("🎤 [USER SAID]:", userTranscription);
        this.emit("userTranscription", userTranscription, Date.now());
        this.emit("message", {
          role: "user",
          text: userTranscription,
          timestamp: Date.now(),
        });
        this.brain?.addToBuffer("user", userTranscription);
      }
    }
  }

  /**
   * Handle incoming audio data part.
   */
  private _audioPartCount: number = 0;

  private handleAudioPart(base64Audio: string): void {
    // Zero resampling: base64 → raw 24kHz s16le Buffer
    const audioData = Buffer.from(base64Audio, "base64");

    // Calculate virtual playback duration contribution
    // 24kHz, 16-bit mono = 48000 bytes/sec
    const chunkDurationMs = (audioData.length / 48000) * 1000;
    this.playbackEndTime =
      Math.max(Date.now(), this.playbackEndTime) + chunkDurationMs;

    const latency =
      this.lastChunkSentTime > 0
        ? performance.now() - this.lastChunkSentTime
        : 0;

    // 🔍 AUDIT: Unconditional log so we can confirm this path fires
    this._audioPartCount++;
    console.log(
      `[GeminiLiveClient] 📥 Audio inlineData path #${this._audioPartCount}: ${audioData.length} bytes, latency: ${latency.toFixed(2)}ms`,
    );

    // Reset speaking timeout
    this.resetSpeakingTimeout();
    this.isAssistantSpeaking = true;
    this.isAssistantCooldown = false;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }

    // Safety: While audio is arriving, keep a short sliding cooldown
    // to prevent mic capture if turnComplete is delayed.
    this.isAssistantCooldown = true;
    const slidingCooldown = setTimeout(() => {
      // Only clear if this is still the active cooldown timer
      // otherwise turnComplete's longer timer takes over.
      if (this.cooldownTimer === slidingCooldown) {
        this.isAssistantCooldown = false;
        this.cooldownTimer = null;
      }
    }, AUDIO_STREAMING_SAFETY_MS);
    this.cooldownTimer = slidingCooldown;

    // Telemetry: Mark first chunk received
    if (!this.hasReceivedResponseThisTurn && this.requestStartTime > 0) {
      this.hasReceivedResponseThisTurn = true;
      telemetry.markGeminiFirstChunk(this.requestStartTime);
      this.requestStartTime = 0;
    }

    this.emit("audioReceived", audioData, latency);
  }

  /**
   * Process text from model (dialogue or transcription).
   */
  private processModelText(
    text: string,
    isTranscription: boolean = false,
  ): void {
    let delta = text;

    // If handling transcription stream, calculate delta
    if (isTranscription) {
      delta = getOutputTranscriptionDelta(
        text,
        this.lastOutputTranscriptionText,
      );
      this.lastOutputTranscriptionText = text;
    } else {
      delta = getOutputTranscriptionDelta(text, this.lastAssistantResponseText);
      this.lastAssistantResponseText = text;
    }

    if (!delta.trim()) return;

    this._isTextModalityWorking = true;

    // PARSE THOUGHTS: Extract [[THOUGHT]] tags OR **Bold Headers** thought patterns
    // Pattern 1: [[THOUGHT]] ... [[/THOUGHT]]
    // Pattern 2: **Header** ... (assumed to be thought/context)
    let cleanText = delta;
    const thoughtEvents: string[] = [];

    // 1. Handle [[THOUGHT]] tags
    const tagRegex = /\[\[THOUGHT\]\]([\s\S]*?)\[\[\/THOUGHT\]\]/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(cleanText)) !== null) {
      if (tagMatch[1].trim()) thoughtEvents.push(tagMatch[1].trim());
    }
    cleanText = cleanText.replace(tagRegex, "");

    // 2. Handle **Bold Headers** (common CoT leakage)
    // Matches **Title** followed by text, up until the next **Title** or the "real" speech
    // This is a heuristic: If the text STARTS with **, it's likely a thought block.
    const headerRegex = /(\*\*[^*]+\*\*[\s\S]*?)(?=\*\*|$)/g;
    // Only apply if the text actually looks like it starts with a thought header
    if (cleanText.trim().startsWith("**")) {
      let headerMatch;
      // We need to be careful not to strip legitimate bold text, but usually start-of-message bolding is CoT
      // Let's assume the whole message segments starting with ** are thoughts if they don't look like dialogue
      // For now, let's aggressively capture these as thoughts
      while ((headerMatch = headerRegex.exec(cleanText)) !== null) {
        thoughtEvents.push(headerMatch[1].trim());
      }
      cleanText = cleanText.replace(headerRegex, "").trim();
    }

    // Emit all collected thoughts
    thoughtEvents.forEach((t) => {
      if (DEBUG) console.log("🧠 [THOUGHT]:", t);
      this.emit("thought", t);
    });

    if (cleanText) {
      if (!this.currentAssistantStreamId) {
        this.currentAssistantStreamId = crypto.randomUUID();
      }
      if (DEBUG) console.log("🤖 [DR. SNUGGLES SAID]:", cleanText);
      this.emit("message", {
        id: this.currentAssistantStreamId,
        role: "assistant",
        text: cleanText,
        timestamp: Date.now(),
        streaming: true,
      });

      if (this.voiceMode === "elevenlabs-custom") {
        this.emit("textForTTS", cleanText);
      }

      this.brain?.addToBuffer("assistant", cleanText);
    }
  }

  /**
   * Handle tool/function calls from the model.
   */
  private async handleToolCall(functionCall: {
    name: string;
    args: Record<string, unknown>;
  }): Promise<void> {
    console.log(
      `[GeminiLiveClient] 🔧 Function call requested: ${functionCall.name}`,
    );
    console.log(`[GeminiLiveClient] Arguments:`, functionCall.args);

    if (this.brain) {
      try {
        const result = await this.brain.executeTool(
          functionCall.name,
          functionCall.args,
        );
        console.log(`[GeminiLiveClient] ✅ Tool executed:`, result);
        await this.sendToolResponse(functionCall.name, result);
      } catch (error) {
        console.error("[GeminiLiveClient] ❌ Tool execution failed:", error);
        await this.sendToolResponse(functionCall.name, {
          error: String(error),
        });
      }
    } else {
      console.warn(
        "[GeminiLiveClient] ⚠️ Function call requested but brain not available",
      );
    }
  }

  /**
   * Send tool execution result back to Gemini.
   * PHASE 2 FIX: Implemented to close the tool usage loop.
   */
  private async sendToolResponse(
    functionName: string,
    result: any,
  ): Promise<void> {
    if (!this.isConnected || !this.session) {
      console.warn(
        "[GeminiLiveClient] Cannot send tool response - not connected",
      );
      return;
    }

    try {
      console.log(
        `[GeminiLiveClient] 📤 Sending tool response for: ${functionName}`,
      );

      // Construct the tool response properly according to Gemini Live API structure
      const toolResponse = {
        turns: [
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: functionName,
                  response: { result: result },
                },
              },
            ],
          },
        ],
      };

      await this.session.sendClientContent({
        ...toolResponse,
        turnComplete: true,
      });
      console.log("[GeminiLiveClient] ✅ Tool response sent successfully");
    } catch (error) {
      console.error(
        "[GeminiLiveClient] ❌ Failed to send tool response:",
        error,
      );
      this.emit("error", error as Error);
    }
  }

  /**
   * Reset speaking timeout - fallback to clear Gemini speaking state
   * if no new audio arrives within the timeout period.
   */
  private resetSpeakingTimeout(): void {
    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
    }
    this.speakingTimeout = setTimeout(() => {
      this.isAssistantSpeaking = false;
      if (LOCAL_VAD_ENABLED && this.vad.getState().isGeminiSpeaking) {
        console.log(
          "[GeminiLiveClient] ⏰ Speaking timeout - clearing Gemini speaking state",
        );
        this.vad.setGeminiSpeaking(false);
      }
    }, this.SPEAKING_TIMEOUT_MS);
  }

  /**
   * Strip markdown formatting from system instruction.
   * The Gemini Live API rejects systemInstructions with markdown formatting.
   *
   * @param {string} text - The text to clean.
   * @returns {string} Plain text without markdown.
   */
  private stripMarkdown(text: string): string {
    return (
      text
        // Remove bold/italic: **text** or *text*
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        // Remove headers: ### Header
        .replace(/^#{1,6}\s+/gm, "")
        // Remove inline code: `code`
        .replace(/`([^`]+)`/g, "$1")
        // Clean up extra whitespace
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }

  /**
   * Build system instruction with context.
   * Integrates time, session history, knowledge, and personality into the prompt.
   * If brain is available, uses brain-enhanced context with RAG memories.
   *
   * @param {SessionConfig} config - The session configuration.
   * @returns {Promise<string>} The complete system instruction.
   */
  private async buildSystemInstruction(config: SessionConfig): Promise<string> {
    let baseInstruction = DR_SNUGGLES_PROMPT;
    let knowledgeContext = config.knowledgeContext || "";

    // If brain is available, use it to prepare context
    if (this.brain) {
      console.log("[GeminiLiveClient] Using Brain for system instruction");

      // Get brain-enhanced context with RAG memories
      const snapshot = telemetry.getSnapshot();
      this.brain.updateVitals({
        audioQueueMs: snapshot.audio.queueMs,
        audioJitterMs: snapshot.audio.jitterMs,
        aiRttMs: snapshot.ai.rttMs,
        ipcRttMs: snapshot.transport.ipcLatencyMs,
        wsConnected: snapshot.transport.wsStatus === "connected",
      });
      const brainContext = await this.brain.prepareSessionContext(
        config.knowledgeContext || "conversation",
      );

      // Brain already includes personality + RAG memories
      baseInstruction = brainContext.systemInstruction;
    } else {
      // Fallback: Add personality mix manually if no brain
      if (config.personalityMix) {
        const { comedy, research, energy } = config.personalityMix;
        baseInstruction += `\nPersonality Mix: Comedy: ${comedy}%, Research: ${research}%, Energy: ${energy}%\n`;
      }
    }

    // Use shared utility to append session context
    const fullInstruction = appendSessionContext(
      baseInstruction,
      config.sessionSummaries,
      knowledgeContext,
    );

    // Strip all markdown formatting before returning
    return this.stripMarkdown(fullInstruction);
  }

  /**
   * Schedule reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectAttempts >= RECONNECT_CONFIG.maxAttempts) {
      console.error("[GeminiLiveClient] Max reconnection attempts reached");
      this.emit("error", new Error("Max reconnection attempts reached"));
      return;
    }

    this.reconnectAttempts++;

    // Calculate delay with exponential backoff
    const baseDelay = Math.min(
      RECONNECT_CONFIG.initialDelay *
        Math.pow(
          RECONNECT_CONFIG.backoffMultiplier,
          this.reconnectAttempts - 1,
        ),
      RECONNECT_CONFIG.maxDelay,
    );

    // Add jitter
    const jitter = (Math.random() - 0.5) * RECONNECT_CONFIG.jitter;
    const delay = baseDelay + jitter;

    console.log(
      `[GeminiLiveClient] 🔄 Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts}/${RECONNECT_CONFIG.maxAttempts})`,
    );

    this.emit("reconnecting", this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(() => {
      this.connect(this.lastConfig).catch((error) => {
        console.error("[GeminiLiveClient] Reconnection failed:", error);
      });
    }, delay);
  }
}
