/**
 * InteractionTrace.ts
 * 
 * Shared type definitions for interaction tracing.
 * Every user-initiated interaction generates a unique trace that records
 * all stages of processing from audio input through playback.
 */

/**
 * All possible trace stages for an interaction.
 * Each stage must be recorded explicitly, even if skipped.
 */
export type TraceStage =
    // INPUT - Audio capture
    | 'MIC_REQUESTED'
    | 'MIC_GRANTED'
    | 'MIC_DENIED'
    | 'AUDIO_BUFFER_RECEIVED'
    | 'AUDIO_BUFFER_EMPTY'
    // STT - Speech to Text
    | 'STT_STARTED'
    | 'STT_COMPLETED'
    | 'STT_EMPTY'
    | 'STT_ERROR'
    // PROMPT - Context preparation
    | 'PROMPT_LOADED'
    | 'CONTEXT_SIZE'
    | 'FACT_CHECK_REQUESTED'
    | 'FACT_CHECK_SKIPPED'
    | 'FACT_CHECK_COMPLETED'
    // MODEL - LLM processing
    | 'LLM_REQUEST_SENT'
    | 'LLM_RESPONSE_RECEIVED'
    | 'LLM_ERROR'
    | 'LLM_TIMEOUT'
    // VOICE - Text to Speech
    | 'VOICE_CONFIG_APPLIED'
    | 'TTS_STARTED'
    | 'TTS_COMPLETED'
    | 'TTS_ERROR'
    // PLAYBACK - Audio output
    | 'AUDIO_PLAYBACK_STARTED'
    | 'AUDIO_PLAYBACK_FINISHED'
    | 'AUDIO_PLAYBACK_FAILED';

/**
 * A single event in an interaction trace.
 * Every stage records success/failure, timestamp, and optional data.
 */
export interface TraceEvent {
    /** The interaction this event belongs to */
    interactionId: string;
    /** The stage being recorded */
    stage: TraceStage;
    /** When this event occurred (Unix timestamp ms) */
    timestamp: number;
    /** Whether this stage succeeded */
    success: boolean;
    /** Required if success === false - explains what went wrong */
    reason?: string;
    /** Stage-specific data (byte length, token count, voice ID, etc.) */
    data?: Record<string, unknown>;
}

/**
 * Complete trace for a single user-initiated interaction.
 * One trace per interaction, viewable as structured JSON.
 */
export interface InteractionTrace {
    /** Unique identifier for this interaction */
    interactionId: string;
    /** When the interaction started (Unix timestamp ms) */
    startedAt: number;
    /** When the interaction completed (Unix timestamp ms) */
    completedAt?: number;
    /** Current status of the interaction */
    status: 'in_progress' | 'completed' | 'failed' | 'aborted';
    /** All events recorded during this interaction, in order */
    events: TraceEvent[];
    /** If failed/aborted, which stage caused it */
    errorStage?: TraceStage;
    /** If failed/aborted, why it failed */
    errorReason?: string;
}

/**
 * Voice configuration locked at interaction start.
 * Immutable for the duration of the interaction.
 */
export interface LockedVoiceConfig {
    /** Voice ID in use (e.g., 'Charon', 'GuzPQFD9JSeGAgP09DOb') */
    voiceId: string;
    /** Voice mode: 'gemini-native' or 'elevenlabs-custom' */
    mode: 'gemini-native' | 'elevenlabs-custom';
}
