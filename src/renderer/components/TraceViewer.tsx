/**
 * TraceViewer.tsx
 * 
 * Developer tool for viewing interaction traces.
 * Provides observability into the complete execution path of each interaction.
 * 
 * Features:
 * - List all recent traces
 * - View individual trace details as structured JSON
 * - Color-coded status indicators
 * - Refresh capability
 */

import React, { useState, useEffect, useCallback } from 'react';

interface TraceEvent {
    interactionId: string;
    stage: string;
    timestamp: number;
    success: boolean;
    reason?: string;
    data?: Record<string, unknown>;
}

interface InteractionTrace {
    interactionId: string;
    startedAt: number;
    completedAt?: number;
    status: 'in_progress' | 'completed' | 'failed' | 'aborted';
    events: TraceEvent[];
    errorStage?: string;
    errorReason?: string;
}

const styles = {
    container: {
        fontFamily: 'monospace',
        fontSize: '12px',
        backgroundColor: '#1a1a2e',
        color: '#eee',
        padding: '16px',
        borderRadius: '8px',
        maxHeight: '600px',
        overflow: 'auto',
    } as React.CSSProperties,
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        borderBottom: '1px solid #333',
        paddingBottom: '8px',
    } as React.CSSProperties,
    title: {
        fontSize: '16px',
        fontWeight: 'bold',
        color: '#4fc3f7',
    } as React.CSSProperties,
    refreshButton: {
        backgroundColor: '#4fc3f7',
        color: '#1a1a2e',
        border: 'none',
        padding: '6px 12px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '12px',
    } as React.CSSProperties,
    traceList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginBottom: '16px',
    } as React.CSSProperties,
    traceItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px',
        backgroundColor: '#16213e',
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
    } as React.CSSProperties,
    traceItemSelected: {
        backgroundColor: '#0f3460',
        border: '1px solid #4fc3f7',
    } as React.CSSProperties,
    statusBadge: {
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '10px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
    } as React.CSSProperties,
    statusCompleted: {
        backgroundColor: '#2e7d32',
        color: '#fff',
    } as React.CSSProperties,
    statusFailed: {
        backgroundColor: '#c62828',
        color: '#fff',
    } as React.CSSProperties,
    statusAborted: {
        backgroundColor: '#ef6c00',
        color: '#fff',
    } as React.CSSProperties,
    statusInProgress: {
        backgroundColor: '#1565c0',
        color: '#fff',
    } as React.CSSProperties,
    traceId: {
        fontFamily: 'monospace',
        color: '#aaa',
    } as React.CSSProperties,
    timestamp: {
        color: '#666',
        fontSize: '10px',
    } as React.CSSProperties,
    detailPanel: {
        backgroundColor: '#0d1117',
        padding: '12px',
        borderRadius: '4px',
        overflow: 'auto',
        maxHeight: '400px',
    } as React.CSSProperties,
    eventRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 0',
        borderBottom: '1px solid #222',
    } as React.CSSProperties,
    successIcon: {
        color: '#4caf50',
    } as React.CSSProperties,
    failureIcon: {
        color: '#f44336',
    } as React.CSSProperties,
    stageName: {
        color: '#ffb74d',
        minWidth: '200px',
    } as React.CSSProperties,
    eventData: {
        color: '#81c784',
        fontSize: '10px',
    } as React.CSSProperties,
    errorReason: {
        color: '#ef5350',
        fontStyle: 'italic',
    } as React.CSSProperties,
    noTraces: {
        textAlign: 'center',
        color: '#666',
        padding: '32px',
    } as React.CSSProperties,
};

export function TraceViewer() {
    const [traces, setTraces] = useState<InteractionTrace[]>([]);
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchTraces = useCallback(async () => {
        setLoading(true);
        try {
            const api = (window as any).snugglesAPI;
            if (api?.getAllTraces) {
                const allTraces = await api.getAllTraces();
                setTraces(allTraces || []);
            }
        } catch (error) {
            console.error('[TraceViewer] Failed to fetch traces:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTraces();
    }, [fetchTraces]);

    const selectedTrace = traces.find(t => t.interactionId === selectedTraceId);

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'completed': return styles.statusCompleted;
            case 'failed': return styles.statusFailed;
            case 'aborted': return styles.statusAborted;
            case 'in_progress': return styles.statusInProgress;
            default: return {};
        }
    };

    const formatTimestamp = (ts: number) => {
        return new Date(ts).toLocaleTimeString();
    };

    const formatDuration = (trace: InteractionTrace) => {
        if (!trace.completedAt) return 'ongoing';
        return `${trace.completedAt - trace.startedAt}ms`;
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <span style={styles.title}>🔍 Interaction Traces</span>
                <button
                    style={styles.refreshButton}
                    onClick={fetchTraces}
                    disabled={loading}
                >
                    {loading ? 'Loading...' : '↻ Refresh'}
                </button>
            </div>

            {traces.length === 0 ? (
                <div style={styles.noTraces as React.CSSProperties}>
                    No interaction traces recorded yet.
                    <br />
                    Start a voice interaction to see traces.
                </div>
            ) : (
                <>
                    <div style={styles.traceList as React.CSSProperties}>
                        {traces.slice(0, 20).map((trace) => (
                            <div
                                key={trace.interactionId}
                                style={{
                                    ...styles.traceItem,
                                    ...(selectedTraceId === trace.interactionId ? styles.traceItemSelected : {}),
                                }}
                                onClick={() => setSelectedTraceId(trace.interactionId)}
                            >
                                <span style={{ ...styles.statusBadge, ...getStatusStyle(trace.status) }}>
                                    {trace.status}
                                </span>
                                <span style={styles.traceId}>
                                    {trace.interactionId.slice(0, 8)}...
                                </span>
                                <span style={styles.timestamp}>
                                    {formatTimestamp(trace.startedAt)} | {formatDuration(trace)} | {trace.events.length} events
                                </span>
                                {trace.errorStage && (
                                    <span style={styles.errorReason}>
                                        ❌ {trace.errorStage}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>

                    {selectedTrace && (
                        <div style={styles.detailPanel}>
                            <h4 style={{ margin: '0 0 12px 0', color: '#4fc3f7' }}>
                                Trace: {selectedTrace.interactionId}
                            </h4>

                            {selectedTrace.errorReason && (
                                <div style={{ ...styles.errorReason, marginBottom: '12px', padding: '8px', backgroundColor: '#2c1b1b', borderRadius: '4px' }}>
                                    ❌ Error: {selectedTrace.errorReason}
                                </div>
                            )}

                            <div>
                                {selectedTrace.events.map((event, idx) => (
                                    <div key={idx} style={styles.eventRow}>
                                        <span style={event.success ? styles.successIcon : styles.failureIcon}>
                                            {event.success ? '✓' : '✗'}
                                        </span>
                                        <span style={styles.stageName}>{event.stage}</span>
                                        <span style={styles.timestamp}>
                                            +{event.timestamp - selectedTrace.startedAt}ms
                                        </span>
                                        {event.data && (
                                            <span style={styles.eventData}>
                                                {JSON.stringify(event.data)}
                                            </span>
                                        )}
                                        {event.reason && (
                                            <span style={styles.errorReason}>
                                                ({event.reason})
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <details style={{ marginTop: '16px' }}>
                                <summary style={{ cursor: 'pointer', color: '#666' }}>Raw JSON</summary>
                                <pre style={{ fontSize: '10px', overflow: 'auto', maxHeight: '200px' }}>
                                    {JSON.stringify(selectedTrace, null, 2)}
                                </pre>
                            </details>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default TraceViewer;
