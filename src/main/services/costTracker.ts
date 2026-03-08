/**
 * COST TRACKER SERVICE
 * 
 * Tracks Gemini Live API usage costs in real-time.
 * Calculates costs based on:
 * - Audio input duration (16kHz)
 * - Audio output duration (24kHz)
 * - Text input tokens
 * - Text output tokens
 * 
 * Pricing based on Gemini 2.5 Flash (as of Jan 2026):
 * NOTE: Using Gemini 2.0 Flash pricing as placeholder - Update with actual 2.5 pricing when available
 * - Audio input: $0.06/hour ($0.001/min, $0.00003125/sec)
 * - Audio output: $0.45/hour ($0.0075/min, $0.000125/sec)
 * - Text input: $0.075/1M tokens
 * - Text output: $0.30/1M tokens
 */

import EventEmitter from 'eventemitter3';
import type { CostMetrics } from '../../shared/types';

// Pricing constants (USD) - GEMINI 2.5 FLASH
// TODO: Update when official Gemini 2.5 Flash pricing is published
const PRICING = {
    AUDIO_INPUT_PER_SECOND: 0.00003125,   // $0.06/hour (estimated)
    AUDIO_OUTPUT_PER_SECOND: 0.000125,    // $0.45/hour (estimated)
    TEXT_INPUT_PER_1M_TOKENS: 0.075,      // Estimated
    TEXT_OUTPUT_PER_1M_TOKENS: 0.30,      // Estimated
} as const;

interface CostTrackerEvents {
    costUpdate: (metrics: CostMetrics) => void;
}

export class CostTracker extends EventEmitter<CostTrackerEvents> {
    private audioInputSeconds: number = 0;
    private audioOutputSeconds: number = 0;
    private textInputTokens: number = 0;
    private textOutputTokens: number = 0;
    private sessionStartTime: number = 0;
    private updateInterval: NodeJS.Timeout | null = null;

    constructor() {
        super();
        console.log('[CostTracker] Initialized');
    }

    /**
     * Start tracking a new session.
     */
    public startSession(): void {
        this.reset();
        this.sessionStartTime = Date.now();

        // Emit cost updates every 5 seconds
        this.updateInterval = setInterval(() => {
            this.emitCostUpdate();
        }, 5000);

        console.log('[CostTracker] Session started');
    }

    /**
     * Stop tracking and clear interval.
     */
    public stopSession(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Emit final cost update
        this.emitCostUpdate();
        console.log('[CostTracker] Session stopped');
    }

    /**
     * Track audio input (user speaking to Gemini).
     * @param durationSeconds Duration of audio chunk in seconds
     */
    public trackAudioInput(durationSeconds: number): void {
        this.audioInputSeconds += durationSeconds;
    }

    /**
     * Track audio output (Gemini speaking to user).
     * @param durationSeconds Duration of audio chunk in seconds
     */
    public trackAudioOutput(durationSeconds: number): void {
        this.audioOutputSeconds += durationSeconds;
    }

    /**
     * Track text input tokens.
     * @param tokens Number of input tokens
     */
    public trackTextInput(tokens: number): void {
        this.textInputTokens += tokens;
    }

    /**
     * Track text output tokens.
     * @param tokens Number of output tokens
     */
    public trackTextOutput(tokens: number): void {
        this.textOutputTokens += tokens;
    }

    /**
     * Get current cost metrics.
     */
    public getMetrics(): CostMetrics {
        const audioInputCost = this.audioInputSeconds * PRICING.AUDIO_INPUT_PER_SECOND;
        const audioOutputCost = this.audioOutputSeconds * PRICING.AUDIO_OUTPUT_PER_SECOND;
        const textInputCost = (this.textInputTokens / 1_000_000) * PRICING.TEXT_INPUT_PER_1M_TOKENS;
        const textOutputCost = (this.textOutputTokens / 1_000_000) * PRICING.TEXT_OUTPUT_PER_1M_TOKENS;

        const totalCost = audioInputCost + audioOutputCost + textInputCost + textOutputCost;
        const sessionDuration = this.sessionStartTime > 0
            ? (Date.now() - this.sessionStartTime) / 1000
            : 0;

        return {
            audioInputSeconds: this.audioInputSeconds,
            audioOutputSeconds: this.audioOutputSeconds,
            textInputTokens: this.textInputTokens,
            textOutputTokens: this.textOutputTokens,
            sessionStartTime: this.sessionStartTime,
            sessionDurationSeconds: sessionDuration,
            estimatedCostUSD: totalCost,
            breakdown: {
                audioInput: audioInputCost,
                audioOutput: audioOutputCost,
                textInput: textInputCost,
                textOutput: textOutputCost,
            },
        };
    }

    /**
     * Reset all counters.
     */
    public reset(): void {
        this.audioInputSeconds = 0;
        this.audioOutputSeconds = 0;
        this.textInputTokens = 0;
        this.textOutputTokens = 0;
        this.sessionStartTime = 0;
        console.log('[CostTracker] Metrics reset');
    }

    /**
     * Emit cost update event.
     */
    private emitCostUpdate(): void {
        const metrics = this.getMetrics();
        this.emit('costUpdate', metrics);
    }
}
