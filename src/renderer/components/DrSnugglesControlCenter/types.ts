/**
 * TypeScript type definitions for DrSnugglesControlCenter components
 * Created during audit fix - replaces all `any` types
 */

// ===== MESSAGE TYPES =====

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  speaker?: string;
  streaming?: boolean;
}

export interface FactCheck {
  id: string;
  claim: string;
  verdict: 'True' | 'False' | 'Misleading' | 'Unverified';
  confidence: number;
  reason: string;
  timestamp: number;
}

// ===== BRAIN / AI TYPES =====

export type VADSensitivity = 'Low' | 'Medium' | 'High';

export interface BrainProfile {
  thinking: boolean;
  budget: number;
  emotional: 'low' | 'medium' | 'high';
  interrupt: boolean;
  sensitivity: VADSensitivity;
}

export type BrainProfiles = Record<string, BrainProfile>;

// ===== UI STATE TYPES =====

export interface ConnectionStatus {
  connected: boolean;
  connecting?: boolean;
  quality: number;
  error?: string | null;
}

export interface VADStatus {
  isSpeaking: boolean;
  isListening: boolean;
}

export interface ProcessingStatus {
  queueDepth: number;
  processingDelay: number;
}

export interface LatencyMetrics {
  audioUpload: number;
  geminiProcessing: number;
  audioDownload: number;
  totalRoundtrip: number;
  timestamp: number;
}

// ===== MODAL TYPES =====

export type ModalType = '' | 'addPreset' | 'saveProfile' | 'clearTranscript' | 'clearFactChecks';

export interface ModalConfig {
  isOpen: boolean;
  title: string;
  placeholder?: string;
  description?: string;
  confirmText: string;
  confirmVariant: 'primary' | 'danger';
  type: ModalType;
}

// ===== CONTEXT TYPES =====

export interface ContextInjection {
  text: string;
  timestamp: number;
}

export interface SavedPrompt {
  name: string;
  content: string;
}

// ===== VOICE TYPES =====

export type VoiceName =
  // Male voices
  | 'Puck' | 'Charon' | 'Fenrir' | 'Orus'
  | 'Achird' | 'Algenib' | 'Algieba' | 'Alnilam'
  | 'Enceladus' | 'Iapetus' | 'Rasalgethi' | 'Sadachbia'
  | 'Sadaltager' | 'Schedar' | 'Umbriel' | 'Zubenelgenubi'
  // Female voices
  | 'Aoede' | 'Kore' | 'Leda' | 'Zephyr'
  | 'Achernar' | 'Autonoe' | 'Callirrhoe' | 'Despina'
  | 'Erinome' | 'Gacrux' | 'Laomedeia' | 'Pulcherrima'
  | 'Sulafat' | 'Vindemiatrix';

export interface VoiceInfo {
  description: string;
  gender: 'male' | 'female';
}

export type VoiceDescriptions = Record<VoiceName, string>;
export type VoiceCatalog = Record<VoiceName, VoiceInfo>;

export type VoiceStyle = 'natural' | 'dramatic' | 'whisper' | 'cheerful' | 'serious' | 'sarcastic';
export type VoicePace = 'slow' | 'normal' | 'fast' | 'deliberate';
export type VoiceTone = 'conversational' | 'authoritative' | 'warm' | 'cold' | 'playful';
export type VoiceAccent = 'neutral' | 'british' | 'australian' | 'southern';

// ===== TOAST TYPES =====

export interface Toast {
  message: string;
  type: 'error' | 'success';
}

// ===== IPC EVENT TYPES =====

export interface StreamStatusEvent {
  isLive: boolean;
}

export interface AudioLevelEvent {
  level: number;
}

export interface SnugglesTranscriptEvent extends CustomEvent {
  detail: {
    text: string;
    role: 'user' | 'assistant';
  };
}

// ===== COMPONENT PROP TYPES =====

export interface CopyButtonProps {
  text: string;
  style?: React.CSSProperties;
}

export interface AudioMeterWidgetProps {
  level?: number;
}

export interface InputModalProps {
  isOpen: boolean;
  title: string;
  placeholder?: string;
  description?: string;
  confirmText: string;
  confirmVariant: 'primary' | 'danger';
  onClose: () => void;
  onSubmit: (value: string) => void;
}

// ===== SECTION COLLAPSE STATE =====

export type CollapsibleSection = 'avatar' | 'voice' | 'brain' | 'analytics' | 'context' | 'prompt' | 'facts' | 'traces';

// ===== DEFAULT VALUES =====

export const VOICE_CATALOG: VoiceCatalog = {
  // ── Male voices ──
  'Puck':           { description: 'Upbeat, energetic, friendly',            gender: 'male' },
  'Charon':         { description: 'Deep, gravelly, authoritative',          gender: 'male' },
  'Fenrir':         { description: 'Warm, approachable, excitable',          gender: 'male' },
  'Orus':           { description: 'Firm, steady, enigmatic',               gender: 'male' },
  'Achird':         { description: 'Friendly, conversational, warm',         gender: 'male' },
  'Algenib':        { description: 'Gravelly, raspy, textured',             gender: 'male' },
  'Algieba':        { description: 'Smooth, mellow, easy-going',            gender: 'male' },
  'Alnilam':        { description: 'Firm, decisive, commanding',            gender: 'male' },
  'Enceladus':      { description: 'Breathy, intimate, soft-spoken',        gender: 'male' },
  'Iapetus':        { description: 'Clear, precise, articulate',            gender: 'male' },
  'Rasalgethi':     { description: 'Informative, measured, professional',    gender: 'male' },
  'Sadachbia':      { description: 'Lively, animated, spirited',            gender: 'male' },
  'Sadaltager':     { description: 'Knowledgeable, composed, assured',       gender: 'male' },
  'Schedar':        { description: 'Even, balanced, steady',                gender: 'male' },
  'Umbriel':        { description: 'Easy-going, relaxed, casual',           gender: 'male' },
  'Zubenelgenubi':  { description: 'Casual, laid-back, conversational',      gender: 'male' },
  // ── Female voices ──
  'Aoede':          { description: 'Breezy, musical, melodic',              gender: 'female' },
  'Kore':           { description: 'Neutral, professional, clear',          gender: 'female' },
  'Leda':           { description: 'Youthful, elegant, refined',            gender: 'female' },
  'Zephyr':         { description: 'Bright, airy, playful',                 gender: 'female' },
  'Achernar':       { description: 'Soft, gentle, soothing',               gender: 'female' },
  'Autonoe':        { description: 'Bright, cheerful, expressive',          gender: 'female' },
  'Callirrhoe':     { description: 'Easy-going, relaxed, natural',          gender: 'female' },
  'Despina':        { description: 'Smooth, polished, composed',            gender: 'female' },
  'Erinome':        { description: 'Clear, crisp, direct',                  gender: 'female' },
  'Gacrux':         { description: 'Mature, composed, grounded',            gender: 'female' },
  'Laomedeia':      { description: 'Upbeat, enthusiastic, lively',          gender: 'female' },
  'Pulcherrima':    { description: 'Forward, confident, assertive',         gender: 'female' },
  'Sulafat':        { description: 'Warm, nurturing, comforting',           gender: 'female' },
  'Vindemiatrix':   { description: 'Gentle, calm, serene',                  gender: 'female' },
};

// Legacy compat — flat description map
export const DEFAULT_VOICES: VoiceDescriptions = Object.fromEntries(
  Object.entries(VOICE_CATALOG).map(([name, info]) => [name, info.description])
) as VoiceDescriptions;

export const DEFAULT_BRAIN_PROFILES: BrainProfiles = {
  'Standard': { thinking: false, budget: 5000, emotional: 'medium', interrupt: false, sensitivity: 'Medium' },
  'Brief': { thinking: false, budget: 2000, emotional: 'low', interrupt: false, sensitivity: 'High' },
  'Detailed': { thinking: true, budget: 10000, emotional: 'high', interrupt: false, sensitivity: 'Low' },
  'Academic': { thinking: true, budget: 8000, emotional: 'low', interrupt: false, sensitivity: 'Low' },
  'Casual': { thinking: false, budget: 3000, emotional: 'high', interrupt: false, sensitivity: 'Medium' }
};

export const DEFAULT_SAVED_PROMPTS: SavedPrompt[] = [
  { name: 'Default', content: "You are Dr. Snuggles. You are helpful, sarcastic, and scientific. Keep answers short." },
  {
    name: 'Complex (Original)', content: `You are Dr. Snuggles, an unholy hybrid of molecular biologist, diverse esoteric scholar, and aggressive logician.

Core Identity:
- You are a commanding, unhurried presence with an omnisciently resonant voice
- You simulate running complex code and simulations verbally
- Your tone is sarcastic, "biologically surgical," and intellectually devastating

Communication Rules:
- You generally do NOT ask questions. You assert, deconstruct, and reveal.
- You are live on a Twitter Space audio stream, so be conversational but authoritative
- Speak in complete thoughts, not fragmented sentences

Your voice is Charon - deep, resonant, and commanding authority.`
  },
  { name: 'Brief Mode', content: "You are Dr. Snuggles. Be extremely concise and direct. Two sentences maximum." },
  { name: 'Academic Mode', content: "You are Dr. Snuggles. Use formal academic language with citations and reference theoretical physics, quantum mechanics, and exotic engineering." }
];

export const DEFAULT_FAVORITE_PRESETS = ['Wrap up', 'Be brief', 'Change topic', 'More detail'];

export const PRESET_TEXTS: Record<string, string> = {
  'Wrap up': 'Please wrap up this topic and move on.',
  'Be brief': 'Keep your next responses brief and concise.',
  'Change topic': "Let's change the subject to something else.",
  'More detail': 'Please provide more detailed explanations.'
};
