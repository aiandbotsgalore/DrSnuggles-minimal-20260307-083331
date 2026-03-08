// Shared types between Main and Renderer processes

/**
 * Represents an audio input or output device.
 */
export interface AudioDevice {
  /** Unique identifier for the device. */
  id: string;
  /** Human-readable label for the device. */
  label: string;
  /** Type of device (input or output). */
  kind: 'audioinput' | 'audiooutput';
}

/**
 * Represents the current connection status to the AI service.
 */
export interface ConnectionStatus {
  /** Whether currently connected. */
  connected: boolean;
  /** Whether currently attempting to connect. */
  connecting: boolean;
  /** Error message if connection failed. */
  error: string | null;
  /** Quality of the connection (0-100). */
  quality: number;
}

/**
 * Represents volume levels for input and output.
 */
export interface VolumeData {
  /** Input volume level (0-100). */
  input: number;
  /** Output volume level (0-100). */
  output: number;
}

/**
 * Application configuration settings.
 */
export interface AppConfig {
  /** ID of the selected input device. */
  inputDeviceId: string | null;
  /** ID of the selected output device. */
  outputDeviceId: string | null;
  /** API key for the service. */
  apiKey: string;
  /** Timestamp of last usage. */
  lastUsed: number;
}

/**
 * Represents a single turn in the conversation history.
 */
export interface ConversationTurn {
  /** Unique ID for the turn. */
  id: string;
  /** Timestamp of the turn. */
  timestamp: number;
  /** Role of the speaker ('user' or 'assistant'). */
  role: 'user' | 'assistant';
  /** Text content of the turn. */
  text: string;
  /** Optional URL to the audio recording. */
  audioUrl?: string;
}

/**
 * Summary of a completed session.
 */
export interface SessionSummary {
  /** Unique ID for the session. */
  id: string;
  /** Timestamp of the session. */
  timestamp: number;
  /** Text summary of the session content. */
  summary: string;
  /** Number of turns in the session. */
  turnCount: number;
}

/**
 * Represents a document in the knowledge base.
 */
export interface KnowledgeDocument {
  /** Unique ID for the document. */
  id: string;
  /** Title of the document. */
  title: string;
  /** Content of the document. */
  content: string;
  /** Optional vector embedding for semantic search. */
  embedding?: number[];
  /** Metadata associated with the document. */
  metadata: {
    source: string;
    type: 'pdf' | 'txt';
    addedAt: number;
  };
}

/**
 * Result from a Retrieval-Augmented Generation (RAG) search.
 */
export interface RAGResult {
  /** The retrieved document. */
  document: KnowledgeDocument;
  /** Raw search score. */
  score: number;
  /** Normalized relevance score (0-100). */
  relevance: number;
}

// === Enhanced Analytics Types ===

/**
 * Real-time analytics for the current session.
 */
export interface LiveAnalytics {
  /** Distribution of speaking time. */
  speakingTime: {
    ai: number;      // percentage
    user: number;    // percentage
  };
  /** Total number of AI responses. */
  totalResponses: number;
  /** Average response time in seconds. */
  avgResponseTime: number; // seconds
  /** Number of times speakers interrupted each other. */
  interrupts: number;
  /** Success rate of jokes (percentage). */
  jokeSuccessRate: number; // percentage
  /** List of automatically detected clip-worthy moments. */
  clipWorthyMoments: ClipMoment[];
}

/**
 * Represents a moment in the session deemed worthy of creating a clip.
 */
export interface ClipMoment {
  /** Unique ID for the moment. */
  id: string;
  /** Timestamp of the moment. */
  timestamp: number;
  /** Title or description of the moment. */
  title: string;
  /** Formatted timestamp string "HH:MM:SS". */
  timeInSession: string;
  /** Text snippet of the moment. */
  snippet: string;
}

/**
 * Represents a key topic discussed in the session.
 */
export interface KeyTopic {
  /** The topic name. */
  topic: string;
  /** Number of times mentioned. */
  mentions: number;
  /** Who mentioned the topic. */
  speaker: 'user' | 'assistant' | 'both';
}

/**
 * Note about a specific speaker.
 */
export interface SpeakerNote {
  /** The speaker name or identifier. */
  speaker: string;
  /** The note content. */
  note: string;
  /** Timestamp of the note. */
  timestamp: number;
}

/**
 * Aggregated memory of the session context.
 */
export interface SessionMemory {
  /** List of key topics discussed. */
  keyTopics: KeyTopic[];
  /** Notes about speakers. */
  speakerNotes: SpeakerNote[];
  /** List of running jokes or callbacks. */
  runningJokes: string[];
}

/**
 * Configuration for the AI's personality.
 */
export interface PersonalityMix {
  /** Comedy level (0-100). */
  comedy: number;
  /** Research/Information focus level (0-100). */
  research: number;
  /** Energy level (0-100). */
  energy: number;
}

/**
 * Status of the AI Co-host.
 */
export interface AICohostStatus {
  /** Current state of the AI. */
  status: 'idle' | 'listening' | 'thinking' | 'speaking';
  /** Last response time in seconds. */
  responseTime: number;
  /** Confidence level of the last response (0-100). */
  confidence: number;
}

/**
 * Definition of a quick command.
 */
export interface QuickCommand {
  /** Unique ID. */
  id: string;
  /** Display label. */
  label: string;
  /** Keyboard shortcut. */
  shortcut: string;
  /** Action function to execute. */
  action: () => void;
}

// === December 2025 Audio Streaming Types ===

/**
 * Metrics related to latency in the audio pipeline.
 */
export interface LatencyMetrics {
  /** Time to upload audio chunk (ms). */
  audioUpload: number;
  /** Time for Gemini to process and generate response (ms). */
  geminiProcessing: number;
  /** Time to download audio response (ms). */
  audioDownload: number;
  /** Total roundtrip time (ms). */
  totalRoundtrip: number;
  /** Timestamp of the measurement. */
  timestamp: number;
}

/**
 * State of the Voice Activity Detector.
 */
export interface VADState {
  /** Whether user is speaking. */
  isSpeaking: boolean;
  /** Whether Gemini is speaking. */
  isGeminiSpeaking: boolean;
  /** Consecutive frames with speech. */
  speechFrameCount: number;
  /** Consecutive frames of silence. */
  silenceFrameCount: number;
}

/**
 * Real-time cost tracking for Gemini Live API usage.
 * Based on Gemini 2.0 Flash pricing (as of Jan 2026):
 * - Audio input: ~$0.00003125/second ($0.001/min or $0.06/hour)
 * - Audio output: ~$0.000125/second ($0.0075/min or $0.45/hour)
 * - Text tokens: $0.075/1M input, $0.30/1M output
 */
export interface CostMetrics {
  /** Total audio input duration in seconds. */
  audioInputSeconds: number;
  /** Total audio output duration in seconds. */
  audioOutputSeconds: number;
  /** Total text input tokens. */
  textInputTokens: number;
  /** Total text output tokens. */
  textOutputTokens: number;
  /** Session start timestamp. */
  sessionStartTime: number;
  /** Session duration in seconds. */
  sessionDurationSeconds: number;
  /** Estimated total cost in USD. */
  estimatedCostUSD: number;
  /** Cost breakdown by type. */
  breakdown: {
    audioInput: number;
    audioOutput: number;
    textInput: number;
    textOutput: number;
  };
}

/**
 * Configuration for the audio stream.
 */
export interface AudioStreamConfig {
  /** Input sample rate (e.g., 48000). */
  inputSampleRate: number;
  /** Output sample rate (e.g., 48000). */
  outputSampleRate: number;
  /** Sample rate expected by Gemini input (e.g., 16000). */
  geminiInputRate: number;
  /** Sample rate provided by Gemini output (e.g., 24000). */
  geminiOutputRate: number;
  /** Whether VAD is enabled. */
  enableVAD: boolean;
}

/**
 * IPC Channel names for communication between Main and Renderer processes.
 * CENTRALIZED DEFINITION - Phase 2 Update
 */
export const IPC_CHANNELS = {
  // Audio & Hardware
  GET_AUDIO_DEVICES: 'get-audio-devices',
  SET_AUDIO_DEVICES: 'set-audio-devices',

  // Session & Connection
  CONNECTION_STATUS: 'connection-status',
  STREAM_STATUS: 'stream-status', // Renamed from stream:toggle in some places, unifying

  // Messaging
  SEND_MESSAGE: 'send-message',
  MESSAGE_RECEIVED: 'message-received',

  // Audio Control
  TOGGLE_MUTE: 'toggle-mute', // System mute
  MIC_TOGGLE: 'audio:mic-mute', // Mic mute
  SET_VOLUME: 'audio:set-volume',
  AUDIO_LEVEL: 'audio-level',
  AUDIO_INTERRUPT: 'audio:interrupt',

  // Voice & Personality
  VOICE_SELECT: 'voice:select',
  VOICE_TEST: 'voice:test',
  VOICE_STYLE: 'voice:style',
  VOICE_EMOTION: 'voice:emotion',
  SET_VOICE_MODE: 'set-voice-mode',
  GET_VOICE_MODE: 'get-voice-mode',

  // Brain & Directives
  BRAIN_THINKING_MODE: 'brain:thinking-mode',
  BRAIN_THINKING_BUDGET: 'brain:thinking-budget',
  AUDIO_CAN_INTERRUPT: 'audio:can-interrupt',
  AUDIO_VAD_SENSITIVITY: 'audio:vad-sensitivity',
  CONTEXT_INJECT: 'context:inject',
  SYSTEM_UPDATE_PROMPT: 'system:update-prompt',

  // Knowledge
  SEARCH_KNOWLEDGE: 'search-knowledge',
  LOAD_KNOWLEDGE: 'load-knowledge',

  // December 2025 Audio Streaming Channels
  GENAI_START_SESSION: 'genai:startSession',
  GENAI_SEND_AUDIO_CHUNK: 'genai:sendAudioChunk',
  GENAI_AUDIO_RECEIVED: 'genai:audioReceived',
  GENAI_LATENCY_UPDATE: 'genai:latencyUpdate',
  GENAI_VAD_STATE: 'genai:vadState',
  GENAI_INTERRUPTION: 'genai:interruption',
  CONNECT_GEMINI: 'connect-gemini',
  DISCONNECT_GEMINI: 'disconnect-gemini',

  // Legacy / Misc
  GET_STATUS: 'get-status',
  RESET_AGENT: 'reset-agent',
  LOG_MESSAGE: 'log:message',
  AVATAR_ACTION: 'avatar:action',
  VOLUME_UPDATE: 'volume-update', // Audio manager volume monitoring

  // Feature Toggles
  VOICE_TOGGLE_CUSTOM: 'voice:toggle-custom',

  // Interaction Tracing
  TRACE_GET: 'trace:get',
  TRACE_GET_ALL: 'trace:getAll',
  TRACE_EVENT: 'trace:event',

  // Vital Signs Telemetry
  VITALS_UPDATE: 'vitals:update',
  VITALS_PING: 'vitals:ping',
  VITALS_PONG: 'vitals:pong',
  VITALS_TOGGLE: 'vitals:toggle',
  VITALS_AUDIO_STATS: 'vitals:audio-stats',

  // UI Notifications
  UI_TOAST: 'ui:toast',
} as const;

/**
 * Voice generation mode for AI responses
 */
export type VoiceMode = 'gemini-native' | 'elevenlabs-custom';

/**
 * Configuration for the Agent's "Brain".
 */
export interface BrainConfig {
  /** Token limit for thinking process (e.g., 100-1000). */
  thinkingBudget: number;
  /** Whether thinking mode is enabled. */
  thinkingEnabled: boolean;
  /** Emotional range of the agent (low/medium/high). */
  emotionalRange: 'low' | 'medium' | 'high';
  /** Whether proactive audio (spontaneity) is enabled. */
  spontaneity: boolean;
  /** VAD sensitivity level. */
  listeningSensitivity: 'low' | 'medium' | 'high';
  /** Current voice ID. */
  voice: string;
  /** Voice generation mode. */
  voiceMode?: VoiceMode;
}
