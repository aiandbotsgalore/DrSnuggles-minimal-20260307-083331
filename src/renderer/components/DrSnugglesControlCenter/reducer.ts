import { CostMetrics } from '../../../shared/types';
import { 
  ConnectionStatus, 
  VoiceName, 
  VoiceStyle, 
  VoicePace, 
  VoiceTone, 
  VoiceAccent, 
  BrainProfiles, 
  VADStatus, 
  TranscriptMessage, 
  FactCheck, 
  ProcessingStatus, 
  Toast, 
  ModalConfig,
  CollapsibleSection,
  VADSensitivity,
  DEFAULT_BRAIN_PROFILES,
  DEFAULT_SAVED_PROMPTS
} from './types';

// State Interface
export interface ControlCenterState {
  // Connection
  isLive: boolean;
  isConnecting: boolean;
  connectionStatus: ConnectionStatus;

  // Voice
  selectedVoice: VoiceName;
  useCustomVoice: boolean;
  outputVolume: number;
  isMuted: boolean;
  micMuted: boolean;
  voiceStyle: VoiceStyle;
  voicePace: VoicePace;
  voiceTone: VoiceTone;
  voiceAccent: VoiceAccent;

  // Brain
  thinkingMode: boolean;
  thinkingBudget: number;
  emotionalRange: 'low' | 'medium' | 'high';
  canInterrupt: boolean;
  listeningSensitivity: VADSensitivity;
  brainProfile: string;
  brainProfiles: BrainProfiles;

  // VAD
  vadStatus: VADStatus;

  // Messages & Data
  messages: TranscriptMessage[];
  factChecks: FactCheck[];
  
  // Prompt
  systemPrompt: string;
  promptApplied: boolean;

  // Metrics
  latency: number;
  latencyHistory: number[];
  processingStatus: ProcessingStatus;
  sessionStart: number;
  messageCount: number;
  speakingTime: number;
  costMetrics: CostMetrics | null;

  // UI
  showSettings: boolean;
  highContrastMode: boolean;
  fontSize: number;
  collapsedSections: Set<CollapsibleSection>;
  toast: Toast | null;
  settingsLoaded: boolean;
  modalConfig: ModalConfig;
  
  // Computed/Derived
  sessionDuration: number;
  displayAudioLevel: number;
}

// Initial State
export const INITIAL_STATE: ControlCenterState = {
  isLive: false,
  isConnecting: false,
  connectionStatus: { connected: false, quality: 0, connecting: false, error: null },
  selectedVoice: 'Charon',
  useCustomVoice: false,
  outputVolume: 80,
  isMuted: false,
  micMuted: false,
  voiceStyle: 'natural',
  voicePace: 'normal',
  voiceTone: 'conversational',
  voiceAccent: 'neutral',
  thinkingMode: false,
  thinkingBudget: 5000,
  emotionalRange: 'medium',
  canInterrupt: false,
  listeningSensitivity: 'Medium',
  brainProfile: 'Standard',
  brainProfiles: DEFAULT_BRAIN_PROFILES,
  vadStatus: { isSpeaking: false, isListening: false },
  messages: [],
  factChecks: [],
  systemPrompt: DEFAULT_SAVED_PROMPTS[0].content,
  promptApplied: false,
  latency: 0,
  latencyHistory: [],
  processingStatus: { queueDepth: 0, processingDelay: 0 },
  sessionStart: Date.now(),
  messageCount: 0,
  speakingTime: 0,
  costMetrics: null,
  showSettings: false,
  highContrastMode: false,
  fontSize: 100,
  collapsedSections: new Set(['voice', 'brain', 'analytics', 'facts', 'context', 'traces']),
  toast: null,
  settingsLoaded: false,
  modalConfig: {
    isOpen: false,
    title: '',
    confirmText: 'Confirm',
    confirmVariant: 'primary',
    type: '',
  },
  sessionDuration: 0,
  displayAudioLevel: 0,
};

// Actions
export type Action =
  | { type: 'SET_CONNECTION_STATUS'; payload: ConnectionStatus }
  | { type: 'SET_IS_LIVE'; payload: boolean }
  | { type: 'SET_IS_CONNECTING'; payload: boolean }
  | { type: 'SET_VOICE_SETTINGS'; payload: Partial<Pick<ControlCenterState, 'selectedVoice' | 'useCustomVoice' | 'outputVolume' | 'isMuted' | 'micMuted' | 'voiceStyle' | 'voicePace' | 'voiceTone' | 'voiceAccent'>> }
  | { type: 'SET_BRAIN_SETTINGS'; payload: Partial<Pick<ControlCenterState, 'thinkingMode' | 'thinkingBudget' | 'emotionalRange' | 'canInterrupt' | 'listeningSensitivity' | 'brainProfile' | 'brainProfiles'>> }
  | { type: 'SET_VAD_STATUS'; payload: VADStatus }
  | { type: 'ADD_MESSAGE'; payload: TranscriptMessage }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; updates: Partial<TranscriptMessage> } }
  | { type: 'SET_MESSAGES'; payload: TranscriptMessage[] } // For bulk update
  | { type: 'ADD_FACT_CHECK'; payload: FactCheck }
  | { type: 'SET_FACT_CHECKS'; payload: FactCheck[] }
  | { type: 'SET_SYSTEM_PROMPT'; payload: string }
  | { type: 'SET_PROMPT_APPLIED'; payload: boolean }
  | { type: 'UPDATE_METRICS'; payload: Partial<Pick<ControlCenterState, 'latency' | 'processingStatus' | 'messageCount' | 'speakingTime' | 'costMetrics' | 'sessionDuration' | 'displayAudioLevel'>> }
  | { type: 'ADD_LATENCY_SAMPLE'; payload: number }
  | { type: 'SET_UI_STATE'; payload: Partial<Pick<ControlCenterState, 'showSettings' | 'highContrastMode' | 'fontSize' | 'settingsLoaded'>> }
  | { type: 'TOGGLE_SECTION'; payload: CollapsibleSection }
  | { type: 'SHOW_TOAST'; payload: Toast }
  | { type: 'HIDE_TOAST' }
  | { type: 'OPEN_MODAL'; payload: ModalConfig }
  | { type: 'CLOSE_MODAL' }
  | { type: 'SET_DISPLAY_AUDIO_LEVEL'; payload: number }
  | { type: 'RESET_SESSION' };

// Reducer Function
export function controlCenterReducer(state: ControlCenterState, action: Action): ControlCenterState {
  const appendStreamingText = (existingText: string, chunk: string): string => {
    if (!existingText) return chunk.trimStart();
    if (!chunk) return existingText;

    const existingEndsWhitespace = /\s$/.test(existingText);
    const chunkStartsWhitespace = /^\s/.test(chunk);
    const merged = existingEndsWhitespace || chunkStartsWhitespace
      ? `${existingText}${chunk}`
      : `${existingText} ${chunk}`;

    return merged.replace(/\n{3,}/g, '\n\n');
  };

  switch (action.type) {
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };
    case 'SET_IS_LIVE':
      return { ...state, isLive: action.payload };
    case 'SET_IS_CONNECTING':
      return { ...state, isConnecting: action.payload };
    case 'SET_VOICE_SETTINGS':
      return { ...state, ...action.payload };
    case 'SET_BRAIN_SETTINGS':
      return { ...state, ...action.payload };
    case 'SET_VAD_STATUS':
      return { ...state, vadStatus: action.payload };
    case 'ADD_MESSAGE':
      if (action.payload.streaming && state.messages.length > 0) {
        const last = state.messages[state.messages.length - 1];
        if (last.role === action.payload.role) {
          const mergedLast = {
            ...last,
            text: appendStreamingText(last.text, action.payload.text),
            timestamp: action.payload.timestamp,
            streaming: true
          };
          return {
            ...state,
            messages: [...state.messages.slice(0, -1), mergedLast]
          };
        }
      }
      return { ...state, messages: [...state.messages, action.payload], messageCount: state.messageCount + 1 };
    case 'UPDATE_MESSAGE':
      return { 
        ...state, 
        messages: state.messages.map(m => m.id === action.payload.id ? { ...m, ...action.payload.updates } : m) 
      };
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };
    case 'ADD_FACT_CHECK':
      return { ...state, factChecks: [...state.factChecks, action.payload] };
    case 'SET_FACT_CHECKS': // Added SET_FACT_CHECKS reducer case
      return { ...state, factChecks: action.payload };
    case 'SET_SYSTEM_PROMPT':
      return { ...state, systemPrompt: action.payload, promptApplied: false };
    case 'SET_PROMPT_APPLIED':
      return { ...state, promptApplied: action.payload };
    case 'UPDATE_METRICS':
      return { ...state, ...action.payload };
    case 'ADD_LATENCY_SAMPLE':
      return { ...state, latency: action.payload, latencyHistory: [...state.latencyHistory, action.payload].slice(-50) };
    case 'SET_UI_STATE':
      return { ...state, ...action.payload };
    case 'TOGGLE_SECTION': {
      const next = new Set(state.collapsedSections);
      if (next.has(action.payload)) next.delete(action.payload);
      else next.add(action.payload);
      return { ...state, collapsedSections: next };
    }
    case 'SHOW_TOAST':
      return { ...state, toast: action.payload };
    case 'HIDE_TOAST':
      return { ...state, toast: null };
    case 'OPEN_MODAL':
      return { ...state, modalConfig: action.payload };
    case 'CLOSE_MODAL':
      return { ...state, modalConfig: { ...state.modalConfig, isOpen: false } };
    case 'SET_DISPLAY_AUDIO_LEVEL':
      return { ...state, displayAudioLevel: action.payload };
    case 'RESET_SESSION':
      return {
        ...state,
        messages: [],
        factChecks: [],
        latencyHistory: [],
        messageCount: 0,
        speakingTime: 0,
        sessionStart: Date.now(),
        connectionStatus: { connected: false, quality: 0, connecting: false, error: null },
        isLive: false
      };
    default:
      return state;
  }
}
