/**
 * Custom hook for managing IPC event listeners
 * Extracted from DrSnugglesControlCenter during audit refactoring
 */

import { useEffect, useRef, useCallback } from 'react';
import { ipc } from '../../../ipc';
import type {
  ConnectionStatus,
  VADStatus,
  ProcessingStatus,
  LatencyMetrics,
  TranscriptMessage,
  FactCheck,
  Toast,
} from '../types';

export interface UseIPCListenersProps {
  onConnectionStatus: (status: ConnectionStatus) => void;
  onStreamStatus: (isLive: boolean) => void;
  onAudioLevel: (level: number) => void;
  onVADState: (state: VADStatus) => void;
  onMessage: (message: TranscriptMessage) => void;
  onFactCheck: (claim: FactCheck) => void;
  onLatencyUpdate: (metrics: LatencyMetrics) => void;
  onProcessingStatus: (status: ProcessingStatus) => void;
  showToast: (message: string, type: 'error' | 'success') => void;
}

export function useIPCListeners(props: UseIPCListenersProps): void {
  const {
    onConnectionStatus,
    onStreamStatus,
    onAudioLevel,
    onVADState,
    onMessage,
    onFactCheck,
    onLatencyUpdate,
    onProcessingStatus,
    showToast,
  } = props;

  // Use refs to avoid stale closures
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(ipc.on('connection-status', (_event, data: ConnectionStatus) => {
      onConnectionStatus(data);
      if (data.error) {
        showToastRef.current(data.error, 'error');
      }
    }));

    unsubscribers.push(ipc.on('stream-status', (_event, data: { isLive: boolean }) => {
      onStreamStatus(data.isLive);
    }));

    unsubscribers.push(ipc.on('audio-level', (_event, data: { level: number }) => {
      onAudioLevel(data.level);
    }));

    unsubscribers.push(ipc.on('genai:vadState', (_event, data: VADStatus) => {
      onVADState(data);
    }));

    unsubscribers.push(ipc.on('message-received', (_event, message: TranscriptMessage) => {
      onMessage(message);
    }));

    unsubscribers.push(ipc.on('fact-check:claim', (_event, claim: FactCheck) => {
      onFactCheck(claim);
    }));

    unsubscribers.push(ipc.on('genai:latencyUpdate', (_event, data: LatencyMetrics) => {
      onLatencyUpdate(data);
    }));

    unsubscribers.push(ipc.on('processing:status', (_event, data: ProcessingStatus) => {
      onProcessingStatus(data);
    }));

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [onConnectionStatus, onStreamStatus, onAudioLevel, onVADState, onMessage, onFactCheck, onLatencyUpdate, onProcessingStatus]);
}

/**
 * Hook for listening to transcript events from STT
 */
export function useTranscriptListener(onTranscript: (text: string, role: 'user' | 'assistant') => void): void {
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  useEffect(() => {
    const handleTranscript = (event: CustomEvent<{ text: string; role: 'user' | 'assistant' }>) => {
      const { text, role } = event.detail;
      console.log(`[useTranscriptListener] Transcript received (${role}):`, text);
      onTranscriptRef.current(text, role);
    };

    window.addEventListener('snugglesTranscript', handleTranscript as EventListener);
    return () => window.removeEventListener('snugglesTranscript', handleTranscript as EventListener);
  }, []);
}
