/**
 * TelemetryService.ts - The Central Nervous System
 * 
 * Zero-allocation, high-frequency telemetry singleton for Dr. Snuggles.
 * Provides real-time observability into audio, AI, transport, and system health.
 * 
 * DESIGN CONSTRAINTS:
 * - Zero object allocation in hot path (primitive math only)
 * - Non-blocking updates (fire-and-forget)
 * - 4Hz broadcast to renderer (250ms intervals)
 * - Environment-gated (dev/debug only)
 */

import { BrowserWindow, ipcMain } from 'electron';

// ============================================================================
// TELEMETRY SCHEMA (The Source of Truth)
// ============================================================================

export interface TelemetryState {
    audio: {
        queueMs: number;      // Buffered audio ahead of playhead
        jitterMs: number;     // Variance in queue depth (stability indicator)
    };
    ai: {
        rttMs: number;        // Round-trip time to Gemini (Time to First Token)
        streamVelocity: number; // Tokens/chunks per second
    };
    transport: {
        ipcLatencyMs: number; // Main<->Renderer round-trip
        wsStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
    };
    system: {
        mainRssMb: number;    // Main process RSS memory
        renderHeapMb: number; // Renderer JS heap (reported back)
    };
}

// ============================================================================
// SLIDING WINDOW AVERAGER (GC-Free)
// ============================================================================

/**
 * Fixed-size circular buffer for computing sliding window averages.
 * Pre-allocates array to avoid GC during updates.
 */
class SlidingWindow {
    private readonly buffer: Float64Array;
    private readonly size: number;
    private index: number = 0;
    private count: number = 0;
    private sum: number = 0;

    constructor(size: number) {
        this.size = size;
        this.buffer = new Float64Array(size);
    }

    /** Push a sample and return the new average */
    push(value: number): number {
        // Subtract old value from sum
        this.sum -= this.buffer[this.index];
        // Add new value
        this.buffer[this.index] = value;
        this.sum += value;
        // Advance circular index
        this.index = (this.index + 1) % this.size;
        // Track actual count for initial fill
        if (this.count < this.size) this.count++;
        // Return average
        return this.sum / this.count;
    }

    /** Get current average without adding a sample */
    get average(): number {
        return this.count > 0 ? this.sum / this.count : 0;
    }

    /** Reset the window */
    reset(): void {
        this.buffer.fill(0);
        this.index = 0;
        this.count = 0;
        this.sum = 0;
    }
}

// ============================================================================
// TELEMETRY SERVICE SINGLETON
// ============================================================================

export class TelemetryService {
    private static instance: TelemetryService | null = null;

    // The global telemetry state (mutated in-place, never reallocated)
    private readonly state: TelemetryState = {
        audio: { queueMs: 0, jitterMs: 0 },
        ai: { rttMs: 0, streamVelocity: 0 },
        transport: { ipcLatencyMs: 0, wsStatus: 'disconnected' },
        system: { mainRssMb: 0, renderHeapMb: 0 }
    };

    // Sliding windows for smoothed metrics (5 samples = ~1.25s at 4Hz)
    private readonly audioQueueWindow = new SlidingWindow(5);
    private readonly audioJitterWindow = new SlidingWindow(5);
    private readonly rttWindow = new SlidingWindow(5);
    private readonly ipcLatencyWindow = new SlidingWindow(5);

    // Timing state for velocity calculation
    private chunkCount: number = 0;
    private velocityResetTime: number = 0;

    // Broadcast state
    private broadcastInterval: NodeJS.Timeout | null = null;
    private mainWindow: BrowserWindow | null = null;
    private isEnabled: boolean = false;

    // IPC ping state
    private pendingPings: Map<string, number> = new Map();

    private constructor() {
        // Private constructor for singleton
    }

    /** Get the singleton instance */
    static getInstance(): TelemetryService {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService();
        }
        return TelemetryService.instance;
    }

    // ==========================================================================
    // LIFECYCLE
    // ==========================================================================

    /**
     * Initialize the telemetry system.
     * @param mainWindow - BrowserWindow to broadcast to
     * @param enabled - Whether telemetry is active (env-gated)
     */
    initialize(mainWindow: BrowserWindow, enabled: boolean = true): void {
        this.mainWindow = mainWindow;
        this.isEnabled = enabled;

        if (!enabled) {
            console.log('[Telemetry] Disabled (production mode)');
            return;
        }

        console.log('[Telemetry] Initializing Central Nervous System...');

        // Setup IPC handlers for ping/pong
        this.setupIPCHandlers();

        // Start the 4Hz broadcast loop
        this.startBroadcast();

        // Start memory polling (1Hz)
        this.startMemoryPolling();

        console.log('[Telemetry] ✅ Central Nervous System online');
    }

    /** Shutdown telemetry gracefully */
    shutdown(): void {
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
            this.broadcastInterval = null;
        }
        this.isEnabled = false;
        console.log('[Telemetry] Shutdown complete');
    }

    // ==========================================================================
    // PROBE UPDATES (Hot Path - Zero Allocation)
    // ==========================================================================

    /**
     * Update audio queue metrics.
     * Called from AudioScheduler when buffer is pushed.
     * 
     * @param scheduledTimeS - When the buffer is scheduled to play (seconds)
     * @param currentTimeS - Current audio context time (seconds)
     */
    updateAudioQueue(scheduledTimeS: number, currentTimeS: number): void {
        if (!this.isEnabled) return;

        const deltaMs = (scheduledTimeS - currentTimeS) * 1000;
        const previousQueue = this.state.audio.queueMs;

        // Update smoothed queue depth
        this.state.audio.queueMs = this.audioQueueWindow.push(deltaMs);

        // Jitter is the variance from previous measurement
        const jitter = Math.abs(deltaMs - previousQueue);
        this.state.audio.jitterMs = this.audioJitterWindow.push(jitter);
    }

    /**
     * Mark the start of a Gemini request.
     * @returns Request ID for matching with response
     */
    markGeminiRequestStart(): number {
        return performance.now();
    }

    /**
     * Mark receipt of first response chunk from Gemini.
     * @param startTime - The timestamp from markGeminiRequestStart()
     */
    markGeminiFirstChunk(startTime: number): void {
        if (!this.isEnabled) return;

        const rtt = performance.now() - startTime;
        this.state.ai.rttMs = this.rttWindow.push(rtt);

        // Update stream velocity
        const now = performance.now();
        this.chunkCount++;

        // Reset velocity counter every second
        if (now - this.velocityResetTime > 1000) {
            this.state.ai.streamVelocity = this.chunkCount;
            this.chunkCount = 0;
            this.velocityResetTime = now;
        }
    }

    /**
     * Update WebSocket connection status.
     */
    updateWSStatus(status: TelemetryState['transport']['wsStatus']): void {
        if (!this.isEnabled) return;
        this.state.transport.wsStatus = status;
    }

    /**
     * Record IPC pong response from renderer.
     * @param pingId - The ping ID that was echoed back
     */
    recordIPCPong(pingId: string, rendererHeapMb: number): void {
        if (!this.isEnabled) return;

        const startTime = this.pendingPings.get(pingId);
        if (startTime !== undefined) {
            const latency = performance.now() - startTime;
            this.state.transport.ipcLatencyMs = this.ipcLatencyWindow.push(latency);
            this.pendingPings.delete(pingId);
        }

        // Update renderer heap from pong payload
        this.state.system.renderHeapMb = rendererHeapMb;
    }

    // ==========================================================================
    // BROADCAST LOOP (4Hz)
    // ==========================================================================

    private startBroadcast(): void {
        // 250ms interval = 4Hz
        this.broadcastInterval = setInterval(() => {
            this.broadcast();
        }, 250);
    }

    private broadcast(): void {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

        // Shallow clone to prevent mutation side-effects
        // This is the ONLY allocation in the broadcast path
        const snapshot: TelemetryState = {
            audio: { ...this.state.audio },
            ai: { ...this.state.ai },
            transport: { ...this.state.transport },
            system: { ...this.state.system }
        };

        this.mainWindow.webContents.send('vitals:update', snapshot);

        // Send ping for IPC latency measurement
        this.sendIPCPing();
    }

    // ==========================================================================
    // IPC PING/PONG
    // ==========================================================================

    private setupIPCHandlers(): void {
        ipcMain.on('vitals:pong', (_event, pingId: string, rendererHeapMb: number) => {
            this.recordIPCPong(pingId, rendererHeapMb);
        });

        ipcMain.on('vitals:toggle', () => {
            // Toggle visibility in renderer (handled by renderer)
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('vitals:toggle');
            }
        });
    }

    private sendIPCPing(): void {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

        // Simple incrementing ID (no crypto overhead)
        const pingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.pendingPings.set(pingId, performance.now());

        // Cleanup old pings (shouldn't happen, but prevents memory leak)
        if (this.pendingPings.size > 10) {
            const oldest = this.pendingPings.keys().next().value;
            if (oldest) this.pendingPings.delete(oldest);
        }

        this.mainWindow.webContents.send('vitals:ping', pingId);
    }

    // ==========================================================================
    // MEMORY POLLING (1Hz)
    // ==========================================================================

    private startMemoryPolling(): void {
        setInterval(() => {
            this.pollMemory();
        }, 1000);
    }

    private pollMemory(): void {
        if (!this.isEnabled) return;

        const usage = process.memoryUsage();
        this.state.system.mainRssMb = Math.round(usage.rss / 1024 / 1024);
    }

    // ==========================================================================
    // DEBUG ACCESS
    // ==========================================================================

    /** Get current state snapshot (for debugging only) */
    getSnapshot(): Readonly<TelemetryState> {
        return this.state;
    }
}

// Export singleton accessor
export const telemetry = TelemetryService.getInstance();
