/**
 * MAIN PROCESS - December 2025 Modernized
 *
 * Wires up the complete Echosphere AI system with:
 * - New GeminiLiveClient (16kHz audio, native-audio model)
 * - AudioManager2025 (volume monitoring)
 * - Knowledge store (Orama)
 * - IPC handlers for audio streaming
 * - Latency tracking
 */

import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// Must use require for Electron in CommonJS mode - two-step pattern for proper initialization
const electron = require("electron");
const { app, BrowserWindow } = electron;

// Load environment variables IMMEDIATELY
const envPath = path.join(process.cwd(), ".env.local");
console.log(`[ENV] Loading .env from: ${envPath}`);
dotenv.config({ path: envPath, override: true });

import { GeminiLiveClient } from "./llm/geminiLiveClient";
import { GeminiDiagnostics } from "./llm/geminiDiagnostics";
import { AudioManager2025 } from "./audio/audioManager2025";
import { NativeAudioManager } from "./audio/NativeAudioManager";
import { ElevenLabsService } from "./tts/elevenlabsService";
import { SnugglesWebSocketServer } from "./websocketServer";
import { CircularBuffer } from "./utils/circularBuffer";

const isHeadlessProcess =
  process.argv.includes("--headless") ||
  process.env.SNUGGLES_HEADLESS === "1" ||
  process.env.HEADLESS === "1";
let suppressStdConsole = isHeadlessProcess;

function ignoreBrokenPipeErrors(
  stream: NodeJS.WritableStream | null | undefined,
): void {
  if (!stream || typeof (stream as any).on !== "function") {
    return;
  }
  (stream as any).on("error", (_error: any) => {
    // Never let stdio stream errors crash Electron main.
    // In headless/dev-sidecar mode stdout can be a closed pipe.
    suppressStdConsole = true;
  });
}

ignoreBrokenPipeErrors(process.stdout);
ignoreBrokenPipeErrors(process.stderr);

function isBrokenPipeError(error: any): boolean {
  return (
    error?.code === "EPIPE" || String(error?.message || "").includes("EPIPE")
  );
}

process.on("uncaughtException", (error: any) => {
  if (isBrokenPipeError(error)) {
    suppressStdConsole = true;
    return;
  }
  console.error("[Main] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason: any) => {
  if (isBrokenPipeError(reason)) {
    suppressStdConsole = true;
    return;
  }
  console.error("[Main] Unhandled rejection:", reason);
});

// 🔍 DEBUG: Capture all logs to file for analysis
// NOTE: LOG_FILE is initialized later after app.whenReady() since app.getPath() requires app to be ready
let LOG_FILE: string | null = null;
let logStream: fs.WriteStream | null = null;

function fileLog(level: string, ...args: any[]) {
  const msg = args
    .map((a) => {
      if (a instanceof Error) {
        return `[ERROR: ${a.message}]\nStack: ${a.stack}`;
      }
      if (typeof a === "object") {
        try {
          const json = JSON.stringify(a);
          if (json === "{}" && a !== null) {
            // Handle non-enumerable properties (like custom Errors)
            const keys = Object.getOwnPropertyNames(a);
            if (keys.length > 0) {
              return `{ ${keys.map((k) => `${k}: ${String((a as any)[k])}`).join(", ")} }`;
            }
          }
          return json;
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
  if (logStream) {
    try {
      logStream.write(`[${new Date().toISOString()}] [${level}] ${msg}\n`);
    } catch {
      // Never crash main process on logging failures.
    }
  }
}

// Hook into console
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function safeConsoleWrite(writer: (...args: any[]) => void, ...args: any[]) {
  if (suppressStdConsole) {
    return;
  }
  try {
    writer(...args);
  } catch (error: any) {
    if (error?.code === "EPIPE") {
      suppressStdConsole = true;
      return;
    }
    throw error;
  }
}

console.log = (...args) => {
  fileLog("INFO", ...args);
  safeConsoleWrite(originalLog, ...args);
};
console.error = (...args) => {
  fileLog("ERROR", ...args);
  safeConsoleWrite(originalError, ...args);
};
console.warn = (...args) => {
  fileLog("WARN", ...args);
  safeConsoleWrite(originalWarn, ...args);
};

import { KnowledgeStore } from "./knowledge/store";
import { SessionMemoryService } from "./memory/database";
import { DrSnugglesBrain } from "../brain/DrSnugglesBrain";
import {
  IPC_CHANNELS,
  ConnectionStatus,
  LatencyMetrics,
} from "../shared/types";

// ENV loading moved to top

// Unset GOOGLE_API_KEY if it exists (to avoid SDK conflicts)
if (process.env.GOOGLE_API_KEY) {
  console.log(
    "⚠️  Unsetting GOOGLE_API_KEY to avoid conflicts with GEMINI_API_KEY",
  );
  delete process.env.GOOGLE_API_KEY;
}

const API_KEY = process.env.GEMINI_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "GuzPQFD9JSeGAgP09DOb"; // Custom voice (updated Dec 2025)

// PROOF OF LIFE: Show first 10 chars of API key to verify it loaded correctly
if (API_KEY) {
  console.log(`[ENV] ✅ API Key loaded: ${API_KEY.substring(0, 10)}...`);

  // 🔍 PRE-FLIGHT DIAGNOSTIC: Validate API key format immediately
  const diagnostics = new GeminiDiagnostics(API_KEY);
  const formatCheck = diagnostics.validateApiKeyFormat();
  if (!formatCheck.passed) {
    console.error(`[ENV] ⚠️ API Key format issue: ${formatCheck.message}`);
    if (formatCheck.suggestion) {
      console.error(`[ENV] 💡 ${formatCheck.suggestion}`);
    }
  }
} else {
  console.error("[ENV] ❌ API Key is EMPTY! Check your .env.local file");
}

/**
 * Configuration constants for AI behavior
 */
const EMOTION_LEVEL_THRESHOLDS = {
  LOW: 33,
  MEDIUM: 66,
  HIGH: 100,
} as const;

const EMOTION_DESCRIPTORS = {
  LOW: "reserved and measured",
  MEDIUM: "moderately expressive",
  HIGH: "highly expressive and dynamic",
} as const;

const VAD_SENSITIVITY_CONFIG = {
  Low: { rmsThreshold: 0.02, minSpeechFrames: 5 },
  Medium: { rmsThreshold: 0.01, minSpeechFrames: 3 },
  High: { rmsThreshold: 0.005, minSpeechFrames: 2 },
} as const;

/**
 * The main application class for Dr. Snuggles (2025 Edition).
 *
 * This modernized version integrates the new Gemini Live Client, advanced audio management,
 * and enhanced knowledge storage features. It handles the complete lifecycle of the Electron
 * application and manages IPC communication between the main and renderer processes.
 */
class SnugglesApp2025 {
  /**
   * Broadcast a message to all connected browser UIs via WebSocket.
   */
  private broadcastToUi(channel: string, payload?: any) {
    if (this.wsServer) {
      this.wsServer.broadcast(channel, payload);
    }
  }

  private audioManager: AudioManager2025;
  private nativeAudioManager: NativeAudioManager;
  private wsServer: SnugglesWebSocketServer;
  private geminiLiveClient: GeminiLiveClient;
  private elevenLabsService: ElevenLabsService;
  private knowledgeStore: KnowledgeStore;
  private sessionMemory: SessionMemoryService;
  private brain: DrSnugglesBrain; // Brain integration
  private latencyMetrics = new CircularBuffer<LatencyMetrics>(1000);
  private useCustomVoice: boolean = false; // Toggle for ElevenLabs (false = Gemini native audio, true = ElevenLabs custom)
  private customVoiceExplicitOptIn: boolean = false;
  private voiceTestTimeout: NodeJS.Timeout | null = null; // Cleanup for voice test disconnect
  private sessionStartInFlight: boolean = false;
  private lastAudioLevelEmitAt: number = 0;
  private assistantSpeakingTimer: NodeJS.Timeout | null = null;
  private uiVadState: { isSpeaking: boolean; isListening: boolean } = {
    isSpeaking: false,
    isListening: false,
  };

  /**
   * Initializes the SnugglesApp2025.
   *
   * Sets up audio manager, Gemini client with brain, knowledge store.
   * IPC handlers and config are set up after app is ready.
   */
  constructor() {
    this.brain = new DrSnugglesBrain({ apiKey: API_KEY });
    this.audioManager = new AudioManager2025();
    this.nativeAudioManager = new NativeAudioManager();
    this.wsServer = new SnugglesWebSocketServer(3030);
    this.geminiLiveClient = new GeminiLiveClient(API_KEY, this.brain);
    this.elevenLabsService = new ElevenLabsService(
      ELEVENLABS_API_KEY,
      ELEVENLABS_VOICE_ID,
      "eleven_flash_v2_5",
    );
    this.knowledgeStore = new KnowledgeStore();
    this.sessionMemory = new SessionMemoryService();

    // Note: setupIPC() and setupGeminiEventHandlers() are called in initialize() after app.whenReady()
  }

  private broadcastConnectionStatus(partial: Partial<ConnectionStatus>): void {
    const connected = partial.connected ?? this.geminiLiveClient.connected;
    const connecting = partial.connecting ?? false;
    const status: ConnectionStatus = {
      connected,
      connecting,
      error: partial.error ?? null,
      quality: partial.quality ?? (connected ? 100 : connecting ? 40 : 0),
    };
    this.broadcastToUi(IPC_CHANNELS.CONNECTION_STATUS, status);
  }

  private calculateInputLevelPercent(rawBuffer: Buffer): number {
    if (!rawBuffer || rawBuffer.length < 2) {
      return 0;
    }
    const sampleCount = Math.floor(rawBuffer.length / 2);
    if (sampleCount <= 0) {
      return 0;
    }

    let sumSquares = 0;
    for (let i = 0; i < sampleCount; i++) {
      const sample = rawBuffer.readInt16LE(i * 2) / 32768;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    return Math.min(100, Math.max(0, rms * 100));
  }

  private broadcastVADState(partial: Partial<{ isSpeaking: boolean; isListening: boolean }>): void {
    this.uiVadState = {
      ...this.uiVadState,
      ...partial,
    };
    this.broadcastToUi(IPC_CHANNELS.GENAI_VAD_STATE, this.uiVadState);
  }

  private markAssistantSpeaking(): void {
    this.broadcastVADState({ isSpeaking: false, isListening: true });
    if (this.assistantSpeakingTimer) {
      clearTimeout(this.assistantSpeakingTimer);
    }
    this.assistantSpeakingTimer = setTimeout(() => {
      this.broadcastVADState({ isListening: false });
      this.assistantSpeakingTimer = null;
    }, 400);
  }

  private markUserInterruption(): void {
    this.broadcastVADState({ isSpeaking: true, isListening: false });
    setTimeout(() => {
      this.broadcastVADState({ isSpeaking: false });
    }, 500);
  }

  private async startGeminiSession(
    config: any = {},
    source: string = "unknown",
  ): Promise<{ success: boolean; error?: string }> {
    if (this.geminiLiveClient.connected) {
      return { success: true };
    }
    if (this.sessionStartInFlight) {
      return { success: true };
    }

    this.sessionStartInFlight = true;
    this.broadcastConnectionStatus({
      connected: false,
      connecting: true,
      error: null,
    });

    try {
      if (!this.customVoiceExplicitOptIn) {
        this.useCustomVoice = false;
      }
      console.log(`[Main] 🎙️ Starting Gemini Live session (${source})...`);
      const sessionSummaries = await this.getRecentSummaries(3);
      const knowledgeContext = await this.knowledgeStore.getSystemContext();

      await this.geminiLiveClient.connect({
        sessionSummaries,
        knowledgeContext,
        enableInputTranscription: this.useCustomVoice,
        ...config,
      });

      return { success: true };
    } catch (error: any) {
      console.error(`[Main] ❌ Session start failed (${source}):`, error);
      this.broadcastConnectionStatus({
        connected: false,
        connecting: false,
        error: error?.message || "Failed to start session",
      });
      return {
        success: false,
        error: error?.message || "Failed to start session",
      };
    } finally {
      this.sessionStartInFlight = false;
    }
  }

  /**
   * Safely send text to Gemini with error handling.
   * Wraps sendText() calls to prevent uncaught errors and notify the UI on failure.
   *
   * @param {string} text - The text to send to Gemini.
   * @param {string} [context=''] - Context description for logging.
   * @returns {Promise<boolean>} True if sent successfully, false otherwise.
   */
  private async safeSendText(
    text: string,
    context: string = "",
  ): Promise<boolean> {
    try {
      await this.geminiLiveClient.sendText(text);
      return true;
    } catch (error) {
      const errorMsg = `Failed to send ${context || "text"}`;
      console.error(`[Main] ❌ ${errorMsg}:`, error);
      this.broadcastConnectionStatus({
        connected: false,
        connecting: false,
        error: `${errorMsg}. Check connection.`,
      });
      return false;
    }
  }

  /**
   * Sets up event handlers for the Gemini Live Client.
   *
   * Handles connection events (connected, disconnected, reconnecting),
   * audio reception, and errors. Updates the renderer process via IPC.
   */
  private setupGeminiEventHandlers(): void {
    // Connected
    this.geminiLiveClient.on("connected", () => {
      console.log("[Main] ✅ Gemini connected");
      this.broadcastConnectionStatus({
        connected: true,
        connecting: false,
        error: null,
      });
      this.broadcastToUi(IPC_CHANNELS.STREAM_STATUS, { isLive: true });
      this.broadcastVADState({ isSpeaking: false, isListening: false });
    });

    // Disconnected
    this.geminiLiveClient.on("disconnected", (reason) => {
      console.log(`[Main] ❌ Gemini disconnected: ${reason}`);
      this.broadcastConnectionStatus({
        connected: false,
        connecting: false,
        error: reason,
      });
      this.broadcastToUi(IPC_CHANNELS.STREAM_STATUS, { isLive: false });
      this.broadcastVADState({ isSpeaking: false, isListening: false });
    });

    // Interruption (User started speaking)
    this.geminiLiveClient.on("interruption", () => {
      console.log(
        "[Main] 🛑 Interruption detected. Signaling renderer to stop playback.",
      );
      // Clear echo suppression so mic input resumes for the user's interruption
      this.nativeAudioManager.clearEchoSuppression();
      this.broadcastToUi(IPC_CHANNELS.GENAI_INTERRUPTION);
      this.markUserInterruption();
    });

    // Audio received — play via Native Audio (Node.js), NOT the browser
    let audioReceivedCount = 0;
    this.geminiLiveClient.on(
      "audioReceived",
      (audioBuffer: Buffer, latencyMs) => {
        audioReceivedCount++;
        if (audioReceivedCount <= 3 || audioReceivedCount % 50 === 0) {
          console.log(
            `[Main] 🔊 audioReceived #${audioReceivedCount}: ${audioBuffer.length} bytes, useCustomVoice=${this.useCustomVoice}`,
          );
        }
        // === NATIVE AUDIO PLAYBACK (raw 24kHz s16le → ffplay) ===
        if (!this.useCustomVoice) {
          this.nativeAudioManager.play(audioBuffer);
        }
        this.markAssistantSpeaking();

        // Track latency (broadcast to browser for UI, but NOT audio data)
        const metrics: LatencyMetrics = {
          audioUpload: 0,
          geminiProcessing: latencyMs,
          audioDownload: 0,
          totalRoundtrip: latencyMs,
          timestamp: Date.now(),
        };
        this.latencyMetrics.push(metrics);
        this.broadcastToUi(IPC_CHANNELS.GENAI_LATENCY_UPDATE, metrics);
      },
    );

    // User Transcription (What the user said)
    this.geminiLiveClient.on(
      "userTranscription",
      (transcription, timestamp) => {
        console.log(`[Main] 🎤 User said: ${transcription}`);
        this.broadcastToUi(IPC_CHANNELS.MESSAGE_RECEIVED, {
          id: crypto.randomUUID(),
          timestamp: timestamp,
          role: "user",
          text: transcription,
          streaming: true,
        });
      },
    );

    // Text message received
    this.geminiLiveClient.on("message", async (message) => {
      console.log(
        `[Main] 📝 Text received: ${message.text.substring(0, 50)}...`,
      );
      this.broadcastToUi(IPC_CHANNELS.MESSAGE_RECEIVED, {
        id: (message as any).id || crypto.randomUUID(),
        ...message,
      });

      // Use ElevenLabs for custom voice synthesis
      if (this.useCustomVoice && message.role === "assistant") {
        try {
          console.log("[Main] 🎙️ Synthesizing with ElevenLabs custom voice...");
          const audioData = await this.elevenLabsService.textToSpeech(
            message.text,
          );

          // Forward custom voice audio to renderer
          this.broadcastToUi(IPC_CHANNELS.GENAI_AUDIO_RECEIVED, audioData);
          console.log("[Main] ✅ Custom voice audio sent to renderer");
        } catch (error: any) {
          console.error(
            "[Main] ⚠️ ElevenLabs TTS failed, falling back to Gemini voice:",
            error,
          );
          const details = `${error?.message || ""} ${JSON.stringify(error?.body || {})}`;
          if (details.includes("quota_exceeded") || details.includes("401")) {
            this.useCustomVoice = false;
            this.customVoiceExplicitOptIn = false;
            this.broadcastToUi(IPC_CHANNELS.UI_TOAST, {
              type: "error",
              message:
                "ElevenLabs credits are exhausted. Switched back to Gemini native voice.",
            });
          }
        }
      }
    });

    // Error
    this.geminiLiveClient.on("error", (error) => {
      console.error("[Main] ⚠️ Gemini error:", error);
      this.broadcastConnectionStatus({
        connected: false,
        connecting: false,
        error: error.message,
      });
      this.broadcastToUi(IPC_CHANNELS.STREAM_STATUS, { isLive: false });
      this.broadcastVADState({ isSpeaking: false, isListening: false });
    });

    // Reconnecting
    this.geminiLiveClient.on("reconnecting", (attempt, delayMs) => {
      console.log(
        `[Main] 🔄 Reconnecting... (attempt ${attempt}, delay ${delayMs}ms)`,
      );
      this.broadcastConnectionStatus({
        connected: false,
        connecting: true,
        error: `Reconnecting (attempt ${attempt})...`,
      });
    });

    // Text for TTS (ElevenLabs custom voice mode)
    this.geminiLiveClient.on("textForTTS", async (text) => {
      console.log(
        "[Main] 🎙️ textForTTS received, converting with ElevenLabs...",
      );
      try {
        const audioBuffer = await this.elevenLabsService.textToSpeech(text);
        // Convert MP3 buffer to format that renderer can play
        // The audioPlaybackService can handle MP3/encoded audio
        this.broadcastToUi(IPC_CHANNELS.GENAI_AUDIO_RECEIVED, audioBuffer);
        console.log("[Main] ✅ ElevenLabs audio sent to renderer");
      } catch (error) {
        console.error("[Main] ❌ ElevenLabs TTS failed:", error);
      }
    });
  }

  // IPC removed — all communication via WebSocket (setupWSHandlers)

  /**
   * Sets up event handlers for the WebSocket server (Browser UI).
   * Maps browser-sent WebSocket messages to the same handlers used by Electron IPC.
   */
  private setupWSHandlers(): void {
    if (!this.wsServer) return;

    this.wsServer.on("client-connected", (client: any) => {
      this.wsServer?.sendToClient(client, IPC_CHANNELS.CONNECTION_STATUS, {
        connected: this.geminiLiveClient.connected,
        connecting: this.sessionStartInFlight,
        error: null,
        quality: this.geminiLiveClient.connected
          ? 100
          : this.sessionStartInFlight
            ? 40
            : 0,
      });
      this.wsServer?.sendToClient(client, IPC_CHANNELS.STREAM_STATUS, {
        isLive: this.geminiLiveClient.connected,
      });
      // Intentionally do not auto-start sessions on UI connect.
      // Session lifecycle must be user-driven via START SESSION.
    });

    // ===== Session Control (mirrors IPC GENAI_START_SESSION) =====
    this.wsServer.on(
      IPC_CHANNELS.GENAI_START_SESSION,
      async (config: any, respond?: (r: any) => void) => {
        const result = await this.startGeminiSession(config, "WS");
        if (respond) respond(result);
      },
    );

    // ===== Stream Status (start/stop toggle from UI) =====
    this.wsServer.on(IPC_CHANNELS.STREAM_STATUS, async (data: any) => {
      const isLive = typeof data === "boolean" ? data : data?.isLive;
      console.log(`[Main] 📡 WS: Stream status update → isLive=${isLive}`);
      if (isLive === false && this.geminiLiveClient.connected) {
        await this.geminiLiveClient.disconnect();
      } else if (
        isLive === true &&
        !this.geminiLiveClient.connected &&
        !this.sessionStartInFlight
      ) {
        await this.startGeminiSession({}, "WS stream toggle");
      }
    });

    // ===== Disconnect =====
    this.wsServer.on(
      IPC_CHANNELS.DISCONNECT_GEMINI,
      async (_: any, respond?: (r: any) => void) => {
        try {
          console.log("[Main] 🔌 WS: Disconnecting Gemini...");
          await this.geminiLiveClient.disconnect();
          if (respond) respond({ success: true });
        } catch (error: any) {
          if (respond) respond({ success: false, error: error.message });
        }
      },
    );

    // ===== Text Messages =====
    this.wsServer.on(IPC_CHANNELS.SEND_MESSAGE, async (text: string) => {
      console.log("[Main] 📝 WS: Text message received:", text);
      await this.geminiLiveClient.sendText(text);
    });

    // ===== Audio Interrupt =====
    this.wsServer.on("audio:interrupt", async () => {
      await this.safeSendText(" ", "WS interrupt");
    });

    // ===== Audio Chunk (no-op: NativeAudioManager handles mic input) =====
    this.wsServer.on(IPC_CHANNELS.GENAI_SEND_AUDIO_CHUNK, async () => {
      // Intentionally ignored. Microphone audio is captured by NativeAudioManager.
      // The browser should NOT send audio over WebSocket in native-audio mode.
    });

    // ===== Voice Controls =====
    this.wsServer.on(IPC_CHANNELS.VOICE_SELECT, async (voice: string) => {
      try {
        console.log(`[Main] 🗣️ WS voice:select: ${voice}`);
        this.geminiLiveClient.setVoice(voice);
        if (this.geminiLiveClient.connected) {
          await this.geminiLiveClient.disconnect();
          const sessionSummaries = await this.getRecentSummaries(3);
          const knowledgeContext = await this.knowledgeStore.getSystemContext();
          await this.geminiLiveClient.connect({
            sessionSummaries,
            knowledgeContext,
          });
        }
      } catch (error: any) {
        console.error("[Main] ❌ WS voice:select failed:", error);
      }
    });

    this.wsServer.on(IPC_CHANNELS.VOICE_TEST, async (payload: unknown) => {
      // Voice panel sends a voice string; header sends tone-test payload.
      if (typeof payload !== "string" || !payload.trim()) {
        console.log("[Main] 🔊 Audio test requested from UI");
        this.nativeAudioManager.playTestTone();
        return;
      }

      const voice = payload.trim();
      console.log(`[Main] 🗣️ WS voice:test: ${voice}`);
      this.geminiLiveClient.setVoice(voice);
      const wasConnected = this.geminiLiveClient.connected;
      try {
        if (!wasConnected) {
          await this.geminiLiveClient.connect({});
        }
        await this.geminiLiveClient.sendText(
          "Hello! This is a voice test. How do I sound?",
        );
        if (!wasConnected) {
          if (this.voiceTestTimeout) clearTimeout(this.voiceTestTimeout);
          this.voiceTestTimeout = setTimeout(async () => {
            await this.geminiLiveClient.disconnect();
            this.voiceTestTimeout = null;
          }, 10000);
        }
      } catch (error) {
        console.error("[Main] ❌ WS voice:test failed:", error);
      }
    });

    this.wsServer.on(
      IPC_CHANNELS.VOICE_STYLE,
      async (styleConfig: {
        style: string;
        pace: string;
        tone: string;
        accent: string;
      }) => {
        const styleInstruction = `[Voice Direction: Speak in a ${styleConfig.style} style, with a ${styleConfig.pace} pace, ${styleConfig.tone} tone, and ${styleConfig.accent} accent.]`;
        await this.safeSendText(styleInstruction, "ws voice style directive");
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.VOICE_TOGGLE_CUSTOM,
      async (useCustom: boolean, respond?: (r: any) => void) => {
        try {
          this.customVoiceExplicitOptIn = useCustom;
          this.useCustomVoice = useCustom;
          if (this.geminiLiveClient.connected) {
            await this.geminiLiveClient.disconnect();
            await new Promise((resolve) => setTimeout(resolve, 500));
            const sessionSummaries = await this.getRecentSummaries(3);
            const knowledgeContext =
              await this.knowledgeStore.getSystemContext();
            await this.geminiLiveClient.connect({
              sessionSummaries,
              knowledgeContext,
              enableInputTranscription: this.useCustomVoice,
            });
          }
          respond?.({ success: true });
        } catch (error: any) {
          respond?.({ success: false, error: error.message });
        }
      },
    );

    // ===== Audio Controls =====
    this.wsServer.on(
      IPC_CHANNELS.TOGGLE_MUTE,
      async (arg1?: any, arg2?: any) => {
        const muted = typeof arg1 === "boolean" ? arg1 : undefined;
        const respond =
          typeof arg1 === "function"
            ? arg1
            : typeof arg2 === "function"
              ? arg2
              : undefined;
        if (typeof muted === "boolean") {
          if (muted !== this.audioManager.isMuted())
            this.audioManager.toggleMute();
        } else {
          this.audioManager.toggleMute();
        }
        this.nativeAudioManager.setOutputMuted(this.audioManager.isMuted());
        respond?.({ success: true, muted: this.audioManager.isMuted() });
      },
    );

    this.wsServer.on(IPC_CHANNELS.MIC_TOGGLE, async (muted: boolean) => {
      const isMuted = Boolean(muted);
      this.audioManager.setInputMuted(isMuted);
      this.nativeAudioManager.setInputMuted(isMuted);
    });

    this.wsServer.on(IPC_CHANNELS.SET_VOLUME, async (volumeRaw: number) => {
      this.audioManager.setOutputVolume(volumeRaw);
      this.nativeAudioManager.setOutputVolume(volumeRaw);
    });

    // ===== Brain Controls =====
    this.wsServer.on(
      IPC_CHANNELS.BRAIN_THINKING_MODE,
      async (enabled: boolean) => {
        if (enabled) {
          await this.safeSendText(
            "[DIRECTIVE] Take time to think through your response before speaking. Consider multiple perspectives and implications.",
            "ws thinking mode directive",
          );
        } else {
          await this.safeSendText(
            "[DIRECTIVE] Respond quickly and naturally without overthinking. Be spontaneous.",
            "ws fast response directive",
          );
        }
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.BRAIN_THINKING_BUDGET,
      async (budget: number) => {
        await this.safeSendText(
          `[DIRECTIVE] Aim for responses of approximately ${budget} tokens or ${Math.floor(budget / 2)} words.`,
          "ws thinking budget directive",
        );
      },
    );

    this.wsServer.on(IPC_CHANNELS.VOICE_EMOTION, async (value: number) => {
      let emotionLevel: string;
      if (value < EMOTION_LEVEL_THRESHOLDS.LOW)
        emotionLevel = EMOTION_DESCRIPTORS.LOW;
      else if (value >= EMOTION_LEVEL_THRESHOLDS.MEDIUM)
        emotionLevel = EMOTION_DESCRIPTORS.HIGH;
      else emotionLevel = EMOTION_DESCRIPTORS.MEDIUM;
      await this.safeSendText(
        `[Voice Direction] Speak with ${emotionLevel} emotional range. ${value > 50 ? "Use varied intonation and enthusiasm." : "Maintain professional composure."}`,
        "ws emotion directive",
      );
    });

    this.wsServer.on(
      IPC_CHANNELS.AUDIO_CAN_INTERRUPT,
      async (canInterrupt: boolean) => {
        this.geminiLiveClient.setInterruptionsEnabled(Boolean(canInterrupt));
        if (canInterrupt) {
          await this.safeSendText(
            "[DIRECTIVE] Allow natural conversation flow. If interrupted, stop speaking immediately and listen.",
            "ws can-interrupt directive",
          );
        } else {
          await this.safeSendText(
            "[DIRECTIVE] Complete your thoughts fully before yielding the floor. Finish your responses.",
            "ws no-interrupt directive",
          );
        }
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.AUDIO_VAD_SENSITIVITY,
      async (sensitivity: string) => {
        const config =
          VAD_SENSITIVITY_CONFIG[
            sensitivity as keyof typeof VAD_SENSITIVITY_CONFIG
          ] || VAD_SENSITIVITY_CONFIG.Medium;
        this.geminiLiveClient.updateVADConfig(config);
      },
    );

    this.wsServer.on("brain:load-profile", async (config: any) => {
      if (!config) return;
      await this.safeSendText(
        `[DIRECTIVE] Apply brain profile: thinking=${Boolean(config.thinking)}, budget=${Number(config.budget) || 0}, emotional=${Boolean(config.emotional)}, interrupt=${Boolean(config.interrupt)}, sensitivity=${config.sensitivity || "Medium"}.`,
        "ws brain profile directive",
      );
      const vadConfig =
        VAD_SENSITIVITY_CONFIG[
          (config.sensitivity ||
            "Medium") as keyof typeof VAD_SENSITIVITY_CONFIG
        ] || VAD_SENSITIVITY_CONFIG.Medium;
      this.geminiLiveClient.updateVADConfig(vadConfig);
    });

    // ===== Context + Prompt =====
    this.wsServer.on(IPC_CHANNELS.CONTEXT_INJECT, async (text: string) => {
      await this.safeSendText(text, "ws context injection");
    });

    this.wsServer.on(
      IPC_CHANNELS.SYSTEM_UPDATE_PROMPT,
      async (prompt: string) => {
        this.brain.updateSystemInstruction(prompt);
        if (this.geminiLiveClient.connected) {
          await this.geminiLiveClient.disconnect();
          await new Promise((resolve) => setTimeout(resolve, 500));
          const sessionSummaries = await this.getRecentSummaries(3);
          const knowledgeContext = await this.knowledgeStore.getSystemContext();
          await this.geminiLiveClient.connect({
            sessionSummaries,
            knowledgeContext,
            enableInputTranscription: this.useCustomVoice,
          });
        }
      },
    );

    // ===== Traces (prevent hanging invokes in browser mode) =====
    this.wsServer.on(
      IPC_CHANNELS.TRACE_GET,
      async (_interactionId: string, respond?: (r: any) => void) => {
        respond?.(null);
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.TRACE_GET_ALL,
      async (arg1?: any, arg2?: any) => {
        const respond =
          typeof arg1 === "function"
            ? arg1
            : typeof arg2 === "function"
              ? arg2
              : undefined;
        respond?.([]);
      },
    );

    this.wsServer.on(IPC_CHANNELS.TRACE_EVENT, async () => {
      // Reserved for future trace ingestion over WS.
    });

    // ===== Misc =====
    this.wsServer.on(
      IPC_CHANNELS.LOG_MESSAGE,
      async ({ level, args }: { level: string; args: any[] }) => {
        console.log(
          `[Renderer][WS][${String(level || "info").toUpperCase()}]`,
          ...(args || []),
        );
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.GET_STATUS,
      async (respond?: (r: any) => void) => {
        const status = {
          connected: this.geminiLiveClient.connected,
          muted: this.audioManager.isMuted(),
          devices: await this.audioManager.getDevices(),
        };
        respond?.(status);
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.RESET_AGENT,
      async (respond?: (r: any) => void) => {
        try {
          await this.geminiLiveClient.disconnect();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const sessionSummaries = await this.getRecentSummaries(3);
          const knowledgeContext = await this.knowledgeStore.getSystemContext();
          await this.geminiLiveClient.connect({
            sessionSummaries,
            knowledgeContext,
          });
          respond?.(true);
        } catch (error) {
          console.error("[Main] ❌ WS reset failed:", error);
          respond?.(false);
        }
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.SEARCH_KNOWLEDGE,
      async (query: string, respond?: (r: any) => void) => {
        try {
          respond?.(this.knowledgeStore.search(query));
        } catch {
          respond?.([]);
        }
      },
    );

    this.wsServer.on(
      IPC_CHANNELS.LOAD_KNOWLEDGE,
      async (respond?: (r: any) => void) => {
        try {
          const knowledgeDir = path.join(__dirname, "../../../knowledge");
          await this.knowledgeStore.loadDocuments(knowledgeDir);
          respond?.({
            success: true,
            count: await this.knowledgeStore.getDocumentCount(),
          });
        } catch (error: any) {
          respond?.({ success: false, count: 0, error: error.message });
        }
      },
    );
  }

  /**
   * Retrieves recent session summaries.
   *
   * @param {number} count - The number of summaries to retrieve.
   * @returns {Promise<string[]>} A promise resolving to an array of summaries.
   */
  private async getRecentSummaries(count: number): Promise<string[]> {
    try {
      return await this.sessionMemory.getRecentSummaries(count);
    } catch (error) {
      console.error("[Main] Failed to retrieve summaries:", error);
      return [];
    }
  }

  /**
   * Loads the knowledge base from the knowledge/ directory.
   */
  private async loadKnowledgeBase(): Promise<void> {
    let knowledgeDir = path.join(__dirname, "../../../knowledge");
    if (!fs.existsSync(knowledgeDir)) {
      const altKnowledgeDir = path.join(process.cwd(), "knowledge");
      console.log(
        `[Main] ⚠️ Knowledge dir not found at ${knowledgeDir}, trying ${altKnowledgeDir}`,
      );
      knowledgeDir = altKnowledgeDir;
    }

    try {
      if (fs.existsSync(knowledgeDir)) {
        await this.knowledgeStore.loadDocuments(knowledgeDir);
        console.log("[Main] ✅ Knowledge base loaded from:", knowledgeDir);
      } else {
        console.warn(
          `[Main] ⚠️ Knowledge directory not found at: ${knowledgeDir}`,
        );
      }
    } catch (error) {
      console.error("[Main] ⚠️ Knowledge base load failed:", error);
    }
  }

  /**
   * Initializes the application.
   *
   * Waits for the app to be ready, creates the window, and sets up global app event listeners.
   *
   * @returns {Promise<void>}
   */
  async initialize(): Promise<void> {
    await app.whenReady();

    // Headless mode: create a hidden off-screen window to keep Electron alive.
    // Without at least one BrowserWindow, Electron's native layer exits immediately.
    new BrowserWindow({ show: false, width: 1, height: 1 });

    // Initialize logging after app is ready
    LOG_FILE = path.join(app.getPath("userData"), "snuggles_debug.log");
    logStream = fs.createWriteStream(LOG_FILE, { flags: "w" });
    console.log(`[Main] 📝 Logging to: ${LOG_FILE}`);

    // Initialize brain memory after app is ready
    console.log("🧠 Initializing brain memory...");
    await this.brain.initializeMemory();
    console.log("✅ Brain memory initialized");

    // Config loading removed — no IPC handlers need it

    // Start native audio I/O (microphone capture + speaker output)
    this.nativeAudioManager.start();

    // Start WebSocket Bridge for browser UI
    this.wsServer.start();

    // Wire native mic input -> Gemini (raw 16kHz s16le Buffer, zero resampling)
    let audioForwardCount = 0;
    let audioDroppedCount = 0;
    this.nativeAudioManager.on("data", (rawBuffer: Buffer) => {
      const now = Date.now();
      if (now - this.lastAudioLevelEmitAt >= 100) {
        this.lastAudioLevelEmitAt = now;
        const level = this.calculateInputLevelPercent(rawBuffer);
        this.broadcastToUi(IPC_CHANNELS.AUDIO_LEVEL, { level });
        this.broadcastToUi(IPC_CHANNELS.VOLUME_UPDATE, {
          input: Math.round(level),
          output: 0,
        });
      }

      if (
        this.geminiLiveClient.connected &&
        !this.audioManager.isInputMuted()
      ) {
        audioForwardCount++;
        if (audioForwardCount <= 3 || audioForwardCount === 50) {
          console.log(
            `[Main] 🎤→🤖 Audio chunk #${audioForwardCount} forwarded to Gemini (${rawBuffer.length} bytes)`,
          );
        }
        this.geminiLiveClient.sendAudio(rawBuffer);
      } else {
        audioDroppedCount++;
        if (audioDroppedCount <= 3 || audioDroppedCount % 200 === 0) {
          console.log(
            `[Main] 🎤❌ Audio chunk dropped (#${audioDroppedCount}): connected=${this.geminiLiveClient.connected}, inputMuted=${this.audioManager.isInputMuted()}`,
          );
        }
      }
    });

    // Set up WebSocket handlers and Gemini event handlers (no IPC — headless)
    this.setupWSHandlers();
    this.setupGeminiEventHandlers();

    // Forward volume updates to browser
    this.audioManager.on("volumeUpdate", (data: any) => {
      this.broadcastToUi(IPC_CHANNELS.VOLUME_UPDATE, data);
    });

    console.log("=".repeat(60));
    console.log("🚀 ECHOSPHERE AI - DECEMBER 2025 EDITION");
    console.log("=".repeat(60));
    console.log("✅ New @google/genai SDK v1.30.0+");
    console.log("✅ Native-audio model: gemini-2.5-flash-native-audio-preview");
    console.log("✅ Audio: 16kHz upstream, 24kHz downstream");
    console.log("✅ Voice Activity Detection enabled");
    console.log("✅ Exponential backoff reconnection");
    console.log("✅ Latency tracking active");
    console.log("🧠 AI Brain: ACTIVE (RAG + Personality + Memory)");
    console.log("=".repeat(60));

    // Load knowledge base (was previously in createWindow)
    await this.loadKnowledgeBase();

    console.log(
      "[Main] Running headless — open http://127.0.0.1:5174 in browser",
    );

    app.on("before-quit", () => {
      // Stop native audio processes
      this.nativeAudioManager.stop();
      if (this.assistantSpeakingTimer) {
        clearTimeout(this.assistantSpeakingTimer);
        this.assistantSpeakingTimer = null;
      }
      // Clean up any pending timeouts
      if (this.voiceTestTimeout) {
        clearTimeout(this.voiceTestTimeout);
        this.voiceTestTimeout = null;
      }
    });

    // No window to recreate — headless mode
  }
}

// Bootstrap
// Add safety check to ensure Electron modules are loaded
if (typeof app === "undefined" || !app || !app.whenReady) {
  console.error("❌ FATAL: Electron app module failed to load!");
  console.error(
    "   This usually means Electron is not properly installed or the require() failed",
  );
  console.error("   Try: npm install --save-dev electron");
  process.exit(1);
}

// Headless mode: prevent Electron from quitting when the hidden window closes
app.on("window-all-closed", () => {
  /* headless — don't quit */
});

const snugglesApp = new SnugglesApp2025();
snugglesApp.initialize().catch(console.error);
