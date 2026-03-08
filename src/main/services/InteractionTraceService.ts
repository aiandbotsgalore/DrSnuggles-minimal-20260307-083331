/**
 * InteractionTraceService.ts
 * 
 * Main process service for managing interaction traces.
 * Single source of truth for all trace state.
 * 
 * CORRECTNESS INVARIANTS:
 * 1. Every interaction MUST have a trace
 * 2. If any stage fails (*_ERROR, *_EMPTY), all downstream stages are aborted
 * 3. Stages must execute in order
 * 4. No silent continuation after failure
 * 5. All LLM/TTS calls require valid interactionId
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
    InteractionTrace,
    TraceEvent,
    TraceStage
} from '../../shared/InteractionTrace';

/**
 * Stage execution order - enforced at runtime
 */
const STAGE_ORDER: TraceStage[] = [
    'MIC_REQUESTED',
    'MIC_GRANTED',
    'MIC_DENIED',
    'AUDIO_BUFFER_RECEIVED',
    'AUDIO_BUFFER_EMPTY',
    'STT_STARTED',
    'STT_COMPLETED',
    'STT_EMPTY',
    'STT_ERROR',
    'PROMPT_LOADED',
    'CONTEXT_SIZE',
    'FACT_CHECK_REQUESTED',
    'FACT_CHECK_SKIPPED',
    'FACT_CHECK_COMPLETED',
    'LLM_REQUEST_SENT',
    'LLM_RESPONSE_RECEIVED',
    'LLM_ERROR',
    'LLM_TIMEOUT',
    'VOICE_CONFIG_APPLIED',
    'TTS_STARTED',
    'TTS_COMPLETED',
    'TTS_ERROR',
    'AUDIO_PLAYBACK_STARTED',
    'AUDIO_PLAYBACK_FINISHED',
    'AUDIO_PLAYBACK_FAILED'
];

/**
 * Stages that trigger abort of downstream stages
 */
const ABORT_TRIGGER_STAGES: Set<TraceStage> = new Set([
    'MIC_DENIED',
    'AUDIO_BUFFER_EMPTY',
    'STT_EMPTY',
    'STT_ERROR',
    'LLM_ERROR',
    'LLM_TIMEOUT',
    'TTS_ERROR',
    'AUDIO_PLAYBACK_FAILED'
]);

/**
 * Extended trace with abort tracking
 */
interface TrackedInteraction extends InteractionTrace {
    isAborted: boolean;
    abortedAtStage?: TraceStage;
    abortReason?: string;
    lastStageIndex: number;
    pendingVoiceChange?: { voiceId: string; mode: string };
}

export class InteractionTraceService {
    private traces: Map<string, TrackedInteraction> = new Map();
    private traceDir: string;
    private maxTracesInMemory: number = 100;

    constructor(userDataPath: string) {
        this.traceDir = path.join(userDataPath, 'traces');
        this.ensureTraceDir();
        console.log(`[TraceService] Initialized. Traces stored at: ${this.traceDir}`);
    }

    /**
     * Ensure the traces directory exists.
     */
    private ensureTraceDir(): void {
        if (!fs.existsSync(this.traceDir)) {
            fs.mkdirSync(this.traceDir, { recursive: true });
            console.log(`[TraceService] Created trace directory: ${this.traceDir}`);
        }
    }

    /**
     * INVARIANT: Require a valid interaction ID.
     * Throws if interactionId is missing or unknown.
     */
    requireInteractionId(interactionId: string | null | undefined, context: string): asserts interactionId is string {
        if (!interactionId) {
            const error = `[INVARIANT VIOLATION] ${context}: interactionId is required but was ${interactionId}`;
            console.error(`[TraceService] ❌❌❌ ${error}`);
            throw new Error(error);
        }
        if (!this.traces.has(interactionId)) {
            const error = `[INVARIANT VIOLATION] ${context}: unknown interactionId ${interactionId}`;
            console.error(`[TraceService] ❌❌❌ ${error}`);
            throw new Error(error);
        }
    }

    /**
     * Check if an interaction is in aborted state.
     */
    isAborted(interactionId: string): boolean {
        const trace = this.traces.get(interactionId);
        return trace?.isAborted ?? false;
    }

    /**
     * Generate a new interaction ID and initialize the trace.
     * Call this at the START of every user-initiated interaction.
     * 
     * @returns The new interaction ID (UUID v4)
     */
    startInteraction(): string {
        const interactionId = crypto.randomUUID();
        const trace: TrackedInteraction = {
            interactionId,
            startedAt: Date.now(),
            status: 'in_progress',
            events: [],
            isAborted: false,
            lastStageIndex: -1
        };

        this.traces.set(interactionId, trace);
        console.log(`[TraceService] 🆕 Started interaction: ${interactionId}`);

        // Prune old traces from memory if exceeding limit
        this.pruneOldTraces();

        return interactionId;
    }

    /**
     * Record a stage event in the interaction trace.
     * 
     * INVARIANTS:
     * - If interaction is aborted, log STAGE_ABORTED and return false
     * - If stage triggers abort, mark interaction as aborted
     * - Validate stage order (warning only, not hard fail)
     * 
     * @returns true if stage was recorded, false if aborted
     */
    recordEvent(
        interactionId: string,
        stage: TraceStage,
        success: boolean,
        options?: {
            reason?: string;
            data?: Record<string, unknown>;
        }
    ): boolean {
        const trace = this.traces.get(interactionId);
        if (!trace) {
            console.error(`[TraceService] ⚠️ Cannot record event - unknown interaction: ${interactionId}`);
            return false;
        }

        // INVARIANT: If already aborted, record STAGE_ABORTED instead
        if (trace.isAborted) {
            console.warn(`[TraceService] ⚠️ [${interactionId.slice(0, 8)}] STAGE_ABORTED: ${stage} (interaction aborted at ${trace.abortedAtStage})`);
            trace.events.push({
                interactionId,
                stage: stage,
                timestamp: Date.now(),
                success: false,
                reason: `STAGE_ABORTED: Interaction aborted at ${trace.abortedAtStage}: ${trace.abortReason}`
            });
            return false;
        }

        // Validate stage order (warning only)
        const stageIndex = STAGE_ORDER.indexOf(stage);
        if (stageIndex !== -1 && stageIndex < trace.lastStageIndex) {
            console.warn(`[TraceService] ⚠️ [${interactionId.slice(0, 8)}] OUT OF ORDER: ${stage} (index ${stageIndex}) after stage index ${trace.lastStageIndex}`);
        }
        if (stageIndex > trace.lastStageIndex) {
            trace.lastStageIndex = stageIndex;
        }

        // Enforce: failures MUST have a reason
        if (!success && !options?.reason) {
            console.error(`[TraceService] ⚠️ FAILURE WITHOUT REASON at ${stage} - this violates failure discipline!`);
        }

        const event: TraceEvent = {
            interactionId,
            stage,
            timestamp: Date.now(),
            success,
            ...(options?.reason && { reason: options.reason }),
            ...(options?.data && { data: options.data })
        };

        trace.events.push(event);

        // Log the event
        const statusIcon = success ? '✅' : '❌';
        const dataStr = options?.data ? ` | data: ${JSON.stringify(options.data)}` : '';
        const reasonStr = options?.reason ? ` | reason: ${options.reason}` : '';
        console.log(`[TraceService] ${statusIcon} [${interactionId.slice(0, 8)}] ${stage}${dataStr}${reasonStr}`);

        // HARD ABORT: If this stage triggers abort, mark interaction as aborted
        if (!success && ABORT_TRIGGER_STAGES.has(stage)) {
            trace.isAborted = true;
            trace.abortedAtStage = stage;
            trace.abortReason = options?.reason || 'Stage failed';
            console.error(`[TraceService] 🛑 [${interactionId.slice(0, 8)}] HARD ABORT triggered by ${stage}: ${trace.abortReason}`);
            console.error(`[TraceService] 🛑 All downstream stages will be aborted.`);
        }

        return true;
    }

    /**
     * Mark an interaction as complete.
     * Call this when the interaction finishes normally.
     */
    completeInteraction(
        interactionId: string,
        status: 'completed' | 'failed'
    ): void {
        const trace = this.traces.get(interactionId);
        if (!trace) {
            console.error(`[TraceService] ⚠️ Cannot complete - unknown interaction: ${interactionId}`);
            return;
        }

        // If aborted, force status to 'aborted'
        if (trace.isAborted) {
            trace.status = 'aborted';
            trace.errorStage = trace.abortedAtStage;
            trace.errorReason = trace.abortReason;
        } else {
            trace.status = status;
        }
        trace.completedAt = Date.now();

        const duration = trace.completedAt - trace.startedAt;
        const stageCount = trace.events.length;
        console.log(`[TraceService] 🏁 Interaction ${interactionId.slice(0, 8)} ${trace.status} (${duration}ms, ${stageCount} stages)`);

        // Persist to disk
        this.persistTrace(trace);
    }

    /**
     * Abort an interaction after a stage failure.
     * Logs explicitly - no silent failures allowed.
     * Downstream stages will not be executed.
     */
    abortInteraction(
        interactionId: string,
        failedStage: TraceStage,
        reason: string
    ): void {
        const trace = this.traces.get(interactionId);
        if (!trace) {
            console.error(`[TraceService] ⚠️ Cannot abort - unknown interaction: ${interactionId}`);
            return;
        }

        trace.isAborted = true;
        trace.abortedAtStage = failedStage;
        trace.abortReason = reason;
        trace.status = 'aborted';
        trace.errorStage = failedStage;
        trace.errorReason = reason;
        trace.completedAt = Date.now();

        // EXPLICIT FAILURE LOG - no silent failures
        console.error(`[TraceService] ❌❌❌ INTERACTION ABORTED ❌❌❌`);
        console.error(`[TraceService]   ID: ${interactionId}`);
        console.error(`[TraceService]   Failed Stage: ${failedStage}`);
        console.error(`[TraceService]   Reason: ${reason}`);
        console.error(`[TraceService]   Duration: ${trace.completedAt - trace.startedAt}ms`);
        console.error(`[TraceService]   Stages completed: ${trace.events.length}`);

        // Persist to disk
        this.persistTrace(trace);
    }

    /**
     * Defer a voice change to the next interaction.
     * Called when voice change requested during active interaction.
     */
    deferVoiceChange(interactionId: string, voiceId: string, mode: string): void {
        const trace = this.traces.get(interactionId);
        if (!trace) return;

        trace.pendingVoiceChange = { voiceId, mode };
        console.log(`[TraceService] 🔒 [${interactionId.slice(0, 8)}] VOICE_CHANGE_DEFERRED: voiceId=${voiceId}, mode=${mode}`);
    }

    /**
     * Get pending voice change for applying after interaction completes.
     */
    getPendingVoiceChange(interactionId: string): { voiceId: string; mode: string } | undefined {
        return this.traces.get(interactionId)?.pendingVoiceChange;
    }

    /**
     * Get a trace by its interaction ID.
     */
    getTrace(interactionId: string): InteractionTrace | undefined {
        // First check memory
        const memTrace = this.traces.get(interactionId);
        if (memTrace) return memTrace;

        // Try loading from disk
        return this.loadTraceFromDisk(interactionId);
    }

    /**
     * Get all traces currently in memory.
     */
    getAllTraces(): InteractionTrace[] {
        return Array.from(this.traces.values()).sort((a, b) => b.startedAt - a.startedAt);
    }

    /**
     * Get the most recent N traces.
     */
    getRecentTraces(count: number): InteractionTrace[] {
        return this.getAllTraces().slice(0, count);
    }

    /**
     * Persist a trace to disk as JSON.
     */
    private persistTrace(trace: TrackedInteraction): void {
        try {
            const filePath = path.join(this.traceDir, `${trace.interactionId}.json`);
            // Strip internal tracking fields before persisting
            const { isAborted, lastStageIndex, pendingVoiceChange, abortedAtStage, abortReason, ...publicTrace } = trace;
            fs.writeFileSync(filePath, JSON.stringify(publicTrace, null, 2));
            console.log(`[TraceService] 💾 Persisted trace to: ${filePath}`);
        } catch (error) {
            console.error(`[TraceService] ⚠️ Failed to persist trace:`, error);
        }
    }

    /**
     * Load a trace from disk.
     */
    private loadTraceFromDisk(interactionId: string): InteractionTrace | undefined {
        try {
            const filePath = path.join(this.traceDir, `${interactionId}.json`);
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(data) as InteractionTrace;
            }
        } catch (error) {
            console.error(`[TraceService] ⚠️ Failed to load trace from disk:`, error);
        }
        return undefined;
    }

    /**
     * Prune old traces from memory to prevent unbounded growth.
     */
    private pruneOldTraces(): void {
        if (this.traces.size <= this.maxTracesInMemory) return;

        const sortedKeys = Array.from(this.traces.entries())
            .sort((a, b) => b[1].startedAt - a[1].startedAt)
            .map(([key]) => key);

        const keysToRemove = sortedKeys.slice(this.maxTracesInMemory);
        for (const key of keysToRemove) {
            this.traces.delete(key);
        }

        console.log(`[TraceService] 🧹 Pruned ${keysToRemove.length} old traces from memory`);
    }

    /**
     * Generate a hash of the current system prompt for tracing.
     */
    static hashPrompt(prompt: string): string {
        return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 12);
    }
}

