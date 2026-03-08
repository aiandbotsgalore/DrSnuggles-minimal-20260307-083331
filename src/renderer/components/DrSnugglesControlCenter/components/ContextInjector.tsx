/**
 * ContextInjector - Context injection panel
 * Extracted from DrSnugglesControlCenter during audit refactoring
 */

import React, { useState, useCallback } from 'react';
import { ipc } from '../../../ipc';
import type { ContextInjection } from '../types';
import { PRESET_TEXTS, DEFAULT_FAVORITE_PRESETS } from '../types';

export interface ContextInjectorProps {
  onAddPreset: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const ContextInjector: React.FC<ContextInjectorProps> = React.memo(({
  onAddPreset,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [contextInput, setContextInput] = useState('');
  const [contextHistory, setContextHistory] = useState<ContextInjection[]>([]);
  const [favoritePresets] = useState(DEFAULT_FAVORITE_PRESETS);

  const handleSendContext = useCallback(() => {
    if (contextInput.trim()) {
      const injection: ContextInjection = { text: contextInput, timestamp: Date.now() };
      setContextHistory(prev => [injection, ...prev].slice(0, 10));
      ipc.send('context:inject', contextInput);
      setContextInput('');
    }
  }, [contextInput]);

  const handleQuickPreset = useCallback((preset: string) => {
    const text = PRESET_TEXTS[preset] || preset;
    setContextHistory(prev => [{ text, timestamp: Date.now() }, ...prev].slice(0, 10));
    ipc.send('context:inject', text);
  }, []);

  const handleClearContextHistory = useCallback(() => {
    setContextHistory([]);
  }, []);

  const handleContextInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContextInput(e.target.value);
  }, []);

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendContext();
    }
  }, [handleSendContext]);

  return (
    <div className="section">
      <div className="section-header-row">
        <div className="section-header">💉 CONTEXT</div>
        <button className="collapse-btn" onClick={onToggleCollapse}>
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="char-counter">
            {contextInput.length} characters
          </div>
          <textarea
            className="context-input"
            placeholder="Instructions to Dr. Snuggles... (Ctrl+Enter to send)"
            value={contextInput}
            onChange={handleContextInputChange}
            onKeyPress={handleKeyPress}
            aria-label="Context input"
          />
          <div className="preset-buttons">
            {favoritePresets.map(preset => (
              <button
                key={preset}
                className="preset-btn"
                onClick={() => handleQuickPreset(preset)}
              >
                {preset}
              </button>
            ))}
            <button
              className="add-preset-btn"
              onClick={onAddPreset}
              title="Add preset"
              aria-label="Add preset"
            >
              ➕
            </button>
          </div>
          <button className="send-button" onClick={handleSendContext}>
            📤 SEND
          </button>

          {contextHistory.length > 0 && (
            <>
              <div className="history-header">
                <span>HISTORY</span>
                <button
                  className="clear-history-btn"
                  onClick={handleClearContextHistory}
                  aria-label="Clear history"
                >
                  🗑️
                </button>
              </div>
              <div className="context-history">
                {contextHistory.map((item, idx) => (
                  <div key={idx} className="context-history-item">
                    <div className="context-history-text">{item.text}</div>
                    <div className="context-history-time">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
});

ContextInjector.displayName = 'ContextInjector';

export default ContextInjector;
