/**
 * VitalsOverlay.tsx - The "Ghost" Overlay
 * 
 * High-fidelity telemetry display for Dr. Snuggles vital signs.
 * Renders as a transparent, non-interactive overlay in the corner.
 * 
 * DESIGN CONSTRAINTS:
 * - Pointer-events: none (click-through)
 * - Max 4 re-renders per second (250ms throttle via main process)
 * - JetBrains Mono / Monaco font at 10px
 * - Dynamic coloring based on health thresholds
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// TYPES
// ============================================================================

interface TelemetryState {
    audio: {
        queueMs: number;
        jitterMs: number;
    };
    ai: {
        rttMs: number;
        streamVelocity: number;
    };
    transport: {
        ipcLatencyMs: number;
        wsStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
    };
    system: {
        mainRssMb: number;
        renderHeapMb: number;
    };
}

// ============================================================================
// HEALTH THRESHOLDS
// ============================================================================

const THRESHOLDS = {
    AUDIO_QUEUE_CRITICAL: 200,    // < 200ms ahead = buffer underrun risk
    AUDIO_QUEUE_WARNING: 500,     // < 500ms = getting thin
    AUDIO_JITTER_WARNING: 50,     // > 50ms jitter = unstable
    IPC_WARNING: 50,              // > 50ms = frame drops likely
    IPC_CRITICAL: 100,            // > 100ms = event loop choked
    RTT_WARNING: 1000,            // > 1s = noticeable delay
    RTT_CRITICAL: 3000,           // > 3s = conversation breaking
    MEMORY_WARNING: 500,          // > 500MB = getting heavy
    MEMORY_CRITICAL: 1000,        // > 1GB = leak likely
} as const;

// ============================================================================
// STYLES
// ============================================================================

const containerStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 10,
    right: 10,
    zIndex: 99999,
    pointerEvents: 'none',
    fontFamily: "'JetBrains Mono', 'Monaco', 'Consolas', monospace",
    fontSize: '10px',
    lineHeight: 1.4,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    borderRadius: '4px',
    padding: '8px 10px',
    color: '#e0e0e0',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    minWidth: '180px',
};

const headerStyle: React.CSSProperties = {
    fontSize: '9px',
    color: '#888',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '2px',
};

const labelStyle: React.CSSProperties = {
    color: '#aaa',
};

const dividerStyle: React.CSSProperties = {
    height: '1px',
    backgroundColor: '#333',
    margin: '4px 0',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

type HealthStatus = 'healthy' | 'warning' | 'critical';

function getHealthColor(status: HealthStatus): string {
    switch (status) {
        case 'critical': return '#ff4444';
        case 'warning': return '#ffaa00';
        case 'healthy': return '#44ff44';
    }
}

function getAudioQueueHealth(queueMs: number): HealthStatus {
    if (queueMs < THRESHOLDS.AUDIO_QUEUE_CRITICAL) return 'critical';
    if (queueMs < THRESHOLDS.AUDIO_QUEUE_WARNING) return 'warning';
    return 'healthy';
}

function getIPCHealth(latencyMs: number): HealthStatus {
    if (latencyMs > THRESHOLDS.IPC_CRITICAL) return 'critical';
    if (latencyMs > THRESHOLDS.IPC_WARNING) return 'warning';
    return 'healthy';
}

function getRTTHealth(rttMs: number): HealthStatus {
    if (rttMs > THRESHOLDS.RTT_CRITICAL) return 'critical';
    if (rttMs > THRESHOLDS.RTT_WARNING) return 'warning';
    return 'healthy';
}

function getWSStatusHealth(status: TelemetryState['transport']['wsStatus']): HealthStatus {
    switch (status) {
        case 'connected': return 'healthy';
        case 'connecting': return 'warning';
        case 'disconnected':
        case 'error': return 'critical';
    }
}

function getMemoryHealth(mb: number): HealthStatus {
    if (mb > THRESHOLDS.MEMORY_CRITICAL) return 'critical';
    if (mb > THRESHOLDS.MEMORY_WARNING) return 'warning';
    return 'healthy';
}

function formatMs(ms: number): string {
    return `${ms.toFixed(0)}ms`;
}

function formatMb(mb: number): string {
    return `${mb.toFixed(0)}MB`;
}

// ============================================================================
// COMPONENT
// ============================================================================

const VitalsOverlay: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [vitals, setVitals] = useState<TelemetryState | null>(null);
    const cleanupRefs = useRef<Array<() => void>>([]);

    // Respond to ping with pong (IPC latency measurement)
    const handlePing = useCallback((pingId: string) => {
        if (!window.snugglesAPI?.sendVitalsPong) return;

        // Get renderer heap size if available
        const perf = (performance as any);
        const heapMb = perf.memory?.usedJSHeapSize
            ? Math.round(perf.memory.usedJSHeapSize / 1024 / 1024)
            : 0;

        window.snugglesAPI.sendVitalsPong(pingId, heapMb);
    }, []);

    // Subscribe to IPC events
    useEffect(() => {
        if (!window.snugglesAPI) return;

        // Subscribe to vitals updates
        if (window.snugglesAPI.onVitalsUpdate) {
            const cleanup = window.snugglesAPI.onVitalsUpdate((data: TelemetryState) => {
                setVitals(data);
            });
            cleanupRefs.current.push(cleanup);
        }

        // Subscribe to ping for IPC latency
        if (window.snugglesAPI.onVitalsPing) {
            const cleanup = window.snugglesAPI.onVitalsPing(handlePing);
            cleanupRefs.current.push(cleanup);
        }

        // Subscribe to toggle event
        if (window.snugglesAPI.onVitalsToggle) {
            const cleanup = window.snugglesAPI.onVitalsToggle(() => {
                setIsVisible(prev => !prev);
            });
            cleanupRefs.current.push(cleanup);
        }

        return () => {
            cleanupRefs.current.forEach(fn => fn());
            cleanupRefs.current = [];
        };
    }, [handlePing]);

    // Keyboard shortcut: Cmd/Ctrl + Shift + D
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                setIsVisible(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Early return if not visible
    if (!isVisible || !vitals) return null;

    // Pre-calculate health statuses
    const audioHealth = getAudioQueueHealth(vitals.audio.queueMs);
    const ipcHealth = getIPCHealth(vitals.transport.ipcLatencyMs);
    const rttHealth = getRTTHealth(vitals.ai.rttMs);
    const wsHealth = getWSStatusHealth(vitals.transport.wsStatus);
    const mainMemHealth = getMemoryHealth(vitals.system.mainRssMb);
    const renderMemHealth = getMemoryHealth(vitals.system.renderHeapMb);

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>⚡ Vital Signs</div>

            {/* Audio Section */}
            <div style={rowStyle}>
                <span style={labelStyle}>Audio Queue</span>
                <span style={{ color: getHealthColor(audioHealth) }}>
                    {formatMs(vitals.audio.queueMs)}
                </span>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle}>Jitter</span>
                <span style={{ color: vitals.audio.jitterMs > THRESHOLDS.AUDIO_JITTER_WARNING ? '#ffaa00' : '#aaa' }}>
                    ±{formatMs(vitals.audio.jitterMs)}
                </span>
            </div>

            <div style={dividerStyle} />

            {/* AI Section */}
            <div style={rowStyle}>
                <span style={labelStyle}>Gemini RTT</span>
                <span style={{ color: getHealthColor(rttHealth) }}>
                    {formatMs(vitals.ai.rttMs)}
                </span>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle}>Stream</span>
                <span style={{ color: '#aaa' }}>
                    {vitals.ai.streamVelocity}/s
                </span>
            </div>

            <div style={dividerStyle} />

            {/* Transport Section */}
            <div style={rowStyle}>
                <span style={labelStyle}>IPC</span>
                <span style={{ color: getHealthColor(ipcHealth) }}>
                    {formatMs(vitals.transport.ipcLatencyMs)}
                </span>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle}>WS</span>
                <span style={{ color: getHealthColor(wsHealth) }}>
                    {vitals.transport.wsStatus}
                </span>
            </div>

            <div style={dividerStyle} />

            {/* Memory Section */}
            <div style={rowStyle}>
                <span style={labelStyle}>Main RSS</span>
                <span style={{ color: getHealthColor(mainMemHealth) }}>
                    {formatMb(vitals.system.mainRssMb)}
                </span>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle}>Render Heap</span>
                <span style={{ color: getHealthColor(renderMemHealth) }}>
                    {formatMb(vitals.system.renderHeapMb)}
                </span>
            </div>
        </div>
    );
};

export default VitalsOverlay;
