import React from 'react';
import type { CostMetrics } from '../../shared/types';

interface CostDisplayProps {
    metrics: CostMetrics | null;
}

/**
 * Displays real-time cost tracking for the current Gemini Live session.
 */
export const CostDisplay: React.FC<CostDisplayProps> = ({ metrics }) => {
    if (!metrics || metrics.sessionDurationSeconds === 0) {
        return null; // Don't show until session starts
    }

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}m ${secs}s`;
    };

    const formatCost = (cost: number): string => {
        return `$${cost.toFixed(4)}`;
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <span style={styles.icon}>💰</span>
                <span style={styles.title}>Session Cost</span>
            </div>

            <div style={styles.mainCost}>
                {formatCost(metrics.estimatedCostUSD)}
            </div>

            <div style={styles.details}>
                <div style={styles.row}>
                    <span style={styles.label}>⏱️ Duration:</span>
                    <span style={styles.value}>{formatDuration(metrics.sessionDurationSeconds)}</span>
                </div>

                <div style={styles.row}>
                    <span style={styles.label}>🎤 Audio In:</span>
                    <span style={styles.value}>{formatDuration(metrics.audioInputSeconds)}</span>
                </div>

                <div style={styles.row}>
                    <span style={styles.label}>🔊 Audio Out:</span>
                    <span style={styles.value}>{formatDuration(metrics.audioOutputSeconds)}</span>
                </div>

                {(metrics.textInputTokens > 0 || metrics.textOutputTokens > 0) && (
                    <div style={styles.row}>
                        <span style={styles.label}>📝 Text:</span>
                        <span style={styles.value}>
                            {(metrics.textInputTokens + metrics.textOutputTokens).toLocaleString()} tokens
                        </span>
                    </div>
                )}
            </div>

            <div style={styles.breakdown}>
                {metrics.breakdown.audioInput > 0.0001 && (
                    <div style={styles.breakdownRow}>
                        <span>Input Audio</span>
                        <span>{formatCost(metrics.breakdown.audioInput)}</span>
                    </div>
                )}
                {metrics.breakdown.audioOutput > 0.0001 && (
                    <div style={styles.breakdownRow}>
                        <span>Output Audio</span>
                        <span>{formatCost(metrics.breakdown.audioOutput)}</span>
                    </div>
                )}
                {metrics.breakdown.textInput > 0.0001 && (
                    <div style={styles.breakdownRow}>
                        <span>Input Text</span>
                        <span>{formatCost(metrics.breakdown.textInput)}</span>
                    </div>
                )}
                {metrics.breakdown.textOutput > 0.0001 && (
                    <div style={styles.breakdownRow}>
                        <span>Output Text</span>
                        <span>{formatCost(metrics.breakdown.textOutput)}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    container: {
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '12px',
        padding: '16px',
        backdropFilter: 'blur(10px)',
        minWidth: '200px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px',
    },
    icon: {
        fontSize: '18px',
    },
    title: {
        fontSize: '14px',
        fontWeight: 600,
        color: 'rgba(255, 255, 255, 0.9)',
    },
    mainCost: {
        fontSize: '28px',
        fontWeight: 700,
        color: '#4CAF50',
        marginBottom: '12px',
        fontFamily: 'monospace',
    },
    details: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginBottom: '12px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    },
    row: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '12px',
    },
    label: {
        color: 'rgba(255, 255, 255, 0.6)',
    },
    value: {
        color: 'rgba(255, 255, 255, 0.9)',
        fontFamily: 'monospace',
        fontWeight: 500,
    },
    breakdown: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    breakdownRow: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: 'rgba(255, 255, 255, 0.5)',
    },
};
