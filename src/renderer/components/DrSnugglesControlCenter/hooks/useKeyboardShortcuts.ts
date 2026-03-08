/**
 * Custom hook for keyboard shortcuts
 * Extracted from DrSnugglesControlCenter during audit refactoring
 *
 * FIXED: Uses refs to avoid re-registering listeners on every state change
 */

import { useEffect, useRef } from 'react';
import { ipc } from '../../../ipc';

export interface KeyboardShortcutHandlers {
  onSendContext: () => void;
  onFocusSearch: () => void;
  onToggleMute: () => void;
  onInterrupt: () => void;
  onToggleShortcuts?: () => void;
  isLive?: boolean;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  // Use refs to avoid stale closures - handlers can change without re-registering listener
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Escape key (no modifier) — interrupt when live
      if (e.key === 'Escape' && handlersRef.current.isLive) {
        e.preventDefault();
        handlersRef.current.onInterrupt();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'Enter':
            handlersRef.current.onSendContext();
            break;
          case 'k':
            e.preventDefault();
            handlersRef.current.onFocusSearch();
            break;
          case 'm':
            e.preventDefault();
            handlersRef.current.onToggleMute();
            break;
          case 'i':
            e.preventDefault();
            handlersRef.current.onInterrupt();
            break;
          case '/':
          case '?':
            e.preventDefault();
            handlersRef.current.onToggleShortcuts?.();
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []); // Empty deps - handlers accessed via ref
}

/**
 * Hook for managing console log forwarding to main process
 */
export function useConsoleForwarding(): void {
  useEffect(() => {
    if (!(window as any).electron) return;

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      originalLog(...args);
      try { ipc.send('log:message', { level: 'info', args }); } catch (e) { }
    };

    console.error = (...args) => {
      originalError(...args);
      try { ipc.send('log:message', { level: 'error', args }); } catch (e) { }
    };

    console.warn = (...args) => {
      originalWarn(...args);
      try { ipc.send('log:message', { level: 'warn', args }); } catch (e) { }
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);
}
