/**
 * TranscriptPanel - Live conversation transcript display
 * Extracted from DrSnugglesControlCenter during audit refactoring
 */

import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import type { TranscriptMessage, ConnectionStatus } from '../types';

// ===== COPY BUTTON COMPONENT =====

interface CopyButtonProps {
  text: string;
  style?: React.CSSProperties;
}

const CopyButton: React.FC<CopyButtonProps> = React.memo(({ text, style }) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }, [text]);

  return (
    <button
      className={`copy-btn ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy message'}
      aria-label={copied ? 'Copied' : 'Copy message'}
    >
      {copied ? '✓' : '📋'}
    </button>
  );
});

CopyButton.displayName = 'CopyButton';

// ===== TRANSCRIPT PANEL COMPONENT =====

export interface TranscriptPanelProps {
  messages: TranscriptMessage[];
  connectionStatus: ConnectionStatus;
  onExport: () => void;
  onClear: () => void;
  onSendMessage: (text: string) => void;
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = React.memo(({
  messages,
  connectionStatus,
  onExport,
  onClear,
  onSendMessage,
}) => {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [messageInput, setMessageInput] = useState('');

  // Track scroll position to determine if user is near bottom
  const handleScroll = useCallback(() => {
    if (transcriptRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = transcriptRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  }, []);

  // Auto-scroll only when near bottom
  useEffect(() => {
    if (isNearBottomRef.current && scrollSentinelRef.current) {
      scrollSentinelRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Memoized filtered messages - AUDIT FIX: was recalculated every render
  const filteredMessages = useMemo(() =>
    messages.filter(msg =>
      !transcriptSearch ||
      (msg.text && msg.text.toLowerCase().includes(transcriptSearch.toLowerCase())) ||
      (msg.role && msg.role.toLowerCase().includes(transcriptSearch.toLowerCase()))
    ), [messages, transcriptSearch]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    onSendMessage(messageInput.trim());
    setMessageInput('');
  }, [messageInput, onSendMessage]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTranscriptSearch(e.target.value);
  }, []);

  const handleMessageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
  }, []);

  return (
    <div className="center-panel">
      <div className="section-header-row">
        <div className="section-header">💬 TRANSCRIPT</div>
        <div className="transcript-tools">
          <input
            type="text"
            placeholder="Search... (Ctrl+K)"
            value={transcriptSearch}
            onChange={handleSearchChange}
            className="search-input"
            data-search
            aria-label="Search transcript"
          />
          <button
            className="tool-btn"
            onClick={onExport}
            title="Export transcript"
            aria-label="Export transcript"
          >
            📥
          </button>
          <button
            className="tool-btn"
            onClick={onClear}
            title="Clear transcript"
            aria-label="Clear transcript"
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="transcript" ref={transcriptRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-text">No transcript yet.</div>
            <div className="empty-state-subtext">Start voice mode or send a message to begin.</div>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔎</div>
            <div className="empty-state-text">No messages match your search.</div>
            <div className="empty-state-subtext">Try a different keyword or clear the search.</div>
          </div>
        ) : (
          <>
            {filteredMessages.map((msg, idx) => {
              const isSequence = idx > 0 && filteredMessages[idx - 1].role === msg.role;
              return (
                <div
                  key={msg.id || idx}
                  className={`transcript-message role-${msg.role} ${isSequence ? 'sequence' : ''}`}
                >
                  {/* Speaker avatar */}
                  {!isSequence && (
                    <div className={`speaker-avatar avatar-${msg.role}`}>
                      {msg.role === 'user' ? '👤' : '🐻'}
                    </div>
                  )}
                  {isSequence && <div className="avatar-placeholder" />}

                  <div className="message-content">
                    {!isSequence && (
                      <div className="transcript-header">
                        <span className={`transcript-speaker speaker-${msg.role}`}>
                          {msg.role === 'user' ? 'YOU' : 'DR. SNUGGLES'}
                        </span>
                        <div className="transcript-actions">
                          <CopyButton text={msg.text} />
                          <span className="transcript-time">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className={`transcript-text ${isSequence ? 'sequence' : ''}`}>
                      {msg.text}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={scrollSentinelRef} />
          </>
        )}
      </div>

      {/* Text Input Area */}
      <div className="transcript-input-area">
        {!connectionStatus.connected && (
          <div className="connection-warning">
            <span>⚠️</span>
            <span>Connect to send messages (click START SESSION)</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="message-form">
          <input
            type="text"
            value={messageInput}
            onChange={handleMessageInputChange}
            placeholder={connectionStatus.connected ? "Speak or type a message... (voice active)" : "Start a session to enable voice"}
            className="message-input"
            aria-label="Message text"
          />
          <button
            type="submit"
            disabled={!connectionStatus.connected}
            title={!connectionStatus.connected ? 'Connect to start chatting' : 'Send message'}
            className={`message-send-btn ${connectionStatus.connected ? 'connected' : 'disabled'}`}
          >
            {!connectionStatus.connected ? 'OFFLINE' : 'SEND'}
          </button>
        </form>
      </div>
    </div>
  );
});

TranscriptPanel.displayName = 'TranscriptPanel';

export default TranscriptPanel;
