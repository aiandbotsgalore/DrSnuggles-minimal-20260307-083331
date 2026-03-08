/**
 * VoiceControls - Voice selection and audio controls
 * Extracted from DrSnugglesControlCenter during audit refactoring
 */

import React, { useCallback, useState } from 'react';
import { ipc } from '../../../ipc';
import { IPC_CHANNELS } from '../../../../shared/types';
import { AudioMeterWidget } from '../../AudioMeterWidget';
import type { VoiceName, VoiceStyle, VoicePace, VoiceTone, VoiceAccent } from '../types';
import { VOICE_CATALOG } from '../types';

export interface VoiceControlsProps {
  selectedVoice: VoiceName;
  onVoiceChange: (voice: VoiceName) => void;
  useCustomVoice: boolean;
  onToggleCustomVoice: (useCustom: boolean) => void | Promise<void>;
  outputVolume: number;
  onVolumeChange: (volume: number) => void;
  isMuted: boolean;
  onMuteToggle: () => void;
  micMuted: boolean;
  onMicToggle: () => void;
  onInterrupt: () => void;
  voiceStyle: VoiceStyle;
  voicePace: VoicePace;
  voiceTone: VoiceTone;
  voiceAccent: VoiceAccent;
  onStyleChange: (style: VoiceStyle) => void;
  onPaceChange: (pace: VoicePace) => void;
  onToneChange: (tone: VoiceTone) => void;
  onAccentChange: (accent: VoiceAccent) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

// Collapsible advanced voice settings
const AdvancedVoiceSettings: React.FC<{
  voiceStyle: VoiceStyle;
  voicePace: VoicePace;
  voiceTone: VoiceTone;
  voiceAccent: VoiceAccent;
  onStyleChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onPaceChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onToneChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onAccentChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}> = React.memo(({ voiceStyle, voicePace, voiceTone, voiceAccent, onStyleChange, onPaceChange, onToneChange, onAccentChange }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="advanced-voice-settings">
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="advanced-toggle-btn"
        aria-label="Toggle advanced voice settings"
      >
        Advanced {showAdvanced ? '▼' : '▶'}
      </button>
      {showAdvanced && (
        <div className="advanced-settings-panel">
          <div className="mod-control">
            <label className="mod-label">Style</label>
            <select className="style-select" value={voiceStyle} onChange={onStyleChange} aria-label="Voice style">
              <option value="natural">Natural</option>
              <option value="dramatic">Dramatic</option>
              <option value="whisper">Whisper</option>
              <option value="cheerful">Cheerful</option>
              <option value="serious">Serious</option>
              <option value="sarcastic">Sarcastic</option>
            </select>
          </div>
          <div className="mod-control">
            <label className="mod-label">Pace</label>
            <select className="style-select" value={voicePace} onChange={onPaceChange} aria-label="Voice pace">
              <option value="slow">Slow</option>
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
              <option value="deliberate">Deliberate</option>
            </select>
          </div>
          <div className="mod-control">
            <label className="mod-label">Tone</label>
            <select className="style-select" value={voiceTone} onChange={onToneChange} aria-label="Voice tone">
              <option value="conversational">Conversational</option>
              <option value="authoritative">Authoritative</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
              <option value="playful">Playful</option>
            </select>
          </div>
          <div className="mod-control">
            <label className="mod-label">Accent</label>
            <select className="style-select" value={voiceAccent} onChange={onAccentChange} aria-label="Voice accent">
              <option value="neutral">Neutral</option>
              <option value="british">British</option>
              <option value="australian">Australian</option>
              <option value="southern">Southern US</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
});
AdvancedVoiceSettings.displayName = 'AdvancedVoiceSettings';

export const VoiceControls: React.FC<VoiceControlsProps> = React.memo(({
  selectedVoice,
  onVoiceChange,
  useCustomVoice,
  onToggleCustomVoice,
  outputVolume,
  onVolumeChange,
  isMuted,
  onMuteToggle,
  micMuted,
  onMicToggle,
  onInterrupt,
  voiceStyle,
  voicePace,
  voiceTone,
  voiceAccent,
  onStyleChange,
  onPaceChange,
  onToneChange,
  onAccentChange,
  isCollapsed,
  onToggleCollapse,
}) => {
  const handleVoiceSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onVoiceChange(e.target.value as VoiceName);
  }, [onVoiceChange]);

  const handleVolumeSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(parseInt(e.target.value));
  }, [onVolumeChange]);

  const handleVoiceTest = useCallback(() => {
    ipc.send(IPC_CHANNELS.VOICE_TEST, selectedVoice);
  }, [selectedVoice]);

  const handleStyleSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStyle = e.target.value as VoiceStyle;
    onStyleChange(newStyle);
    ipc.send(IPC_CHANNELS.VOICE_STYLE, { style: newStyle, pace: voicePace, tone: voiceTone, accent: voiceAccent });
  }, [onStyleChange, voicePace, voiceTone, voiceAccent]);

  const handlePaceSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPace = e.target.value as VoicePace;
    onPaceChange(newPace);
    ipc.send(IPC_CHANNELS.VOICE_STYLE, { style: voiceStyle, pace: newPace, tone: voiceTone, accent: voiceAccent });
  }, [onPaceChange, voiceStyle, voiceTone, voiceAccent]);

  const handleToneSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTone = e.target.value as VoiceTone;
    onToneChange(newTone);
    ipc.send(IPC_CHANNELS.VOICE_STYLE, { style: voiceStyle, pace: voicePace, tone: newTone, accent: voiceAccent });
  }, [onToneChange, voiceStyle, voicePace, voiceAccent]);

  const handleAccentSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newAccent = e.target.value as VoiceAccent;
    onAccentChange(newAccent);
    ipc.send(IPC_CHANNELS.VOICE_STYLE, { style: voiceStyle, pace: voicePace, tone: voiceTone, accent: newAccent });
  }, [onAccentChange, voiceStyle, voicePace, voiceTone]);

  const handleVoiceModeToggle = useCallback(() => {
    const newMode = !useCustomVoice;
    void onToggleCustomVoice(newMode);
  }, [useCustomVoice, onToggleCustomVoice]);

  return (
    <div className="section">
      <div className="section-header-row">
        <div className="section-header">🎤 VOICE</div>
        <button className="collapse-btn" onClick={onToggleCollapse}>
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="voice-selector-row">
            <select
              className="voice-select"
              value={selectedVoice}
              onChange={handleVoiceSelectChange}
              aria-label="Select voice"
            >
              <optgroup label="Male Voices">
                {Object.entries(VOICE_CATALOG)
                  .filter(([, info]) => info.gender === 'male')
                  .map(([voice, info]) => (
                    <option key={voice} value={voice}>{voice} — {info.description}</option>
                  ))}
              </optgroup>
              <optgroup label="Female Voices">
                {Object.entries(VOICE_CATALOG)
                  .filter(([, info]) => info.gender === 'female')
                  .map(([voice, info]) => (
                    <option key={voice} value={voice}>{voice} — {info.description}</option>
                  ))}
              </optgroup>
            </select>
            <button
              className="voice-test-btn"
              onClick={handleVoiceTest}
              aria-label="Test voice"
            >
              🔊 TEST
            </button>
          </div>
          <div className="voice-description">{VOICE_CATALOG[selectedVoice]?.description}</div>

          {/* Voice Mode Toggle */}
          <div className={`voice-mode-toggle ${useCustomVoice ? 'custom' : 'native'}`}>
            <label className="control-label">
              <span>Voice Mode:</span>
              <button
                className={`voice-mode-btn ${useCustomVoice ? 'custom' : 'native'}`}
                onClick={handleVoiceModeToggle}
              >
                {useCustomVoice ? '🎙️ ELEVENLABS' : '⚡ GEMINI'}
              </button>
            </label>
            <div className="voice-mode-description">
              {useCustomVoice
                ? '🎙️ Using your ElevenLabs custom voice (higher quality, slower)'
                : '⚡ Using Gemini native Charon voice (fast, natural)'}
            </div>
          </div>

          {/* Advanced Voice Settings - Collapsible */}
          <AdvancedVoiceSettings
            voiceStyle={voiceStyle}
            voicePace={voicePace}
            voiceTone={voiceTone}
            voiceAccent={voiceAccent}
            onStyleChange={handleStyleSelectChange}
            onPaceChange={handlePaceSelectChange}
            onToneChange={handleToneSelectChange}
            onAccentChange={handleAccentSelectChange}
          />

          {/* Audio Level Meter */}
          <AudioMeterWidget />

          {/* Audio Controls */}
          <div className="audio-controls">
            <div className="audio-control-row">
              <span className="audio-label">OUTPUT</span>
              <button
                className={`mute-btn ${isMuted ? 'active' : ''}`}
                onClick={onMuteToggle}
                aria-label={isMuted ? 'Unmute output' : 'Mute output'}
              >
                {isMuted ? '🔇' : '🔊'}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={outputVolume}
                onChange={handleVolumeSliderChange}
                className="volume-slider"
                disabled={isMuted}
                aria-label="Output volume"
              />
              <span className="volume-value">{outputVolume}%</span>
            </div>

            <div className="audio-control-row">
              <span className="audio-label">INPUT</span>
              <button
                className={`mute-btn ${micMuted ? 'active' : ''} ${micMuted ? 'mic-muted' : ''}`}
                onClick={onMicToggle}
                aria-label={micMuted ? 'Microphone is muted - click to unmute' : 'Microphone active - click to mute'}
              >
                {micMuted ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                )}
              </button>
              <button className="interrupt-btn" onClick={onInterrupt} aria-label="Interrupt">
                ⏹ INTERRUPT
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

VoiceControls.displayName = 'VoiceControls';

export default VoiceControls;
