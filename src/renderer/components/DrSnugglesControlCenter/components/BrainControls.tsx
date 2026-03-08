/**
 * BrainControls - AI/Brain configuration panel
 * Extracted from DrSnugglesControlCenter during audit refactoring
 */

import React, { useCallback } from 'react';
import { ipc } from '../../../ipc';
import type { BrainProfiles, VADSensitivity } from '../types';

export interface BrainControlsProps {
  brainProfile: string;
  brainProfiles: BrainProfiles;
  onProfileChange: (profile: string) => void;
  onSaveProfile: () => void;
  thinkingMode: boolean;
  onThinkingModeToggle: () => void;
  thinkingBudget: number;
  onThinkingBudgetChange: (budget: number) => void;
  emotionalRange: 'low' | 'medium' | 'high';
  onEmotionalRangeChange: (range: 'low' | 'medium' | 'high') => void;
  canInterrupt: boolean;
  onCanInterruptChange: (enabled: boolean) => void;
  listeningSensitivity: VADSensitivity;
  onListeningSensitivityChange: (sensitivity: VADSensitivity) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const BrainControls: React.FC<BrainControlsProps> = React.memo(({
  brainProfile,
  brainProfiles,
  onProfileChange,
  onSaveProfile,
  thinkingMode,
  onThinkingModeToggle,
  thinkingBudget,
  onThinkingBudgetChange,
  emotionalRange,
  onEmotionalRangeChange,
  canInterrupt,
  onCanInterruptChange,
  listeningSensitivity,
  onListeningSensitivityChange,
  isCollapsed,
  onToggleCollapse,
}) => {
  const handleProfileSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const profile = e.target.value;
    onProfileChange(profile);
    const config = brainProfiles[profile];
    if (config) {
      ipc.send('brain:load-profile', config);
    }
  }, [onProfileChange, brainProfiles]);

  const handleThinkingBudgetSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const budget = parseInt(e.target.value);
    onThinkingBudgetChange(budget);
    ipc.send('brain:thinking-budget', budget);
  }, [onThinkingBudgetChange]);

  const handleEmotionalRangeSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const range = e.target.value as 'low' | 'medium' | 'high';
    onEmotionalRangeChange(range);
    ipc.send('voice:emotion', range);
  }, [onEmotionalRangeChange]);

  const handleCanInterruptCheckChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    onCanInterruptChange(enabled);
    ipc.send('audio:can-interrupt', enabled);
  }, [onCanInterruptChange]);

  const handleSensitivitySelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const sensitivity = e.target.value as VADSensitivity;
    onListeningSensitivityChange(sensitivity);
    ipc.send('audio:vad-sensitivity', sensitivity);
  }, [onListeningSensitivityChange]);

  const handleThinkingModeCheckChange = useCallback(() => {
    onThinkingModeToggle();
    ipc.send('brain:thinking-mode', !thinkingMode);
  }, [onThinkingModeToggle, thinkingMode]);

  return (
    <div className="section">
      <div className="section-header-row">
        <div className="section-header">🧠 BRAIN</div>
        <button className="collapse-btn" onClick={onToggleCollapse}>
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Profile Selector */}
          <div className="profile-select">
            <label className="profile-label">Profile:</label>
            <select
              className="profile-dropdown"
              value={brainProfile}
              onChange={handleProfileSelectChange}
              aria-label="Brain profile"
            >
              {Object.keys(brainProfiles).map(profile => (
                <option key={profile} value={profile}>{profile}</option>
              ))}
            </select>
            <button className="save-profile-btn" onClick={onSaveProfile} aria-label="Save profile">
              💾
            </button>
          </div>

          <div className="control-item">
            <label className="control-label">
              <input
                type="checkbox"
                checked={thinkingMode}
                onChange={handleThinkingModeCheckChange}
                className="checkbox"
                aria-label="Thinking mode"
              />
              <span title="Extended reasoning — slower but more thorough">Thinking Mode</span>
              {thinkingMode && <span className="active-badge">ACTIVE</span>}
            </label>
            {thinkingMode && (
              <div className="budget-control">
                <input
                  type="range"
                  min="0"
                  max="10000"
                  step="100"
                  value={thinkingBudget}
                  onChange={handleThinkingBudgetSliderChange}
                  className="budget-slider"
                  aria-label="Thinking budget"
                />
                <span className="budget-value">{thinkingBudget} tokens (~{Math.round(thinkingBudget * 0.75)} words)</span>
              </div>
            )}
          </div>

          <div className="control-item">
            <div className="control-label">Emotional Range</div>
            <select
              className="sensitivity-select"
              value={emotionalRange}
              onChange={handleEmotionalRangeSelectChange}
              aria-label="Emotional range"
            >
              <option value="low">Low — neutral, factual</option>
              <option value="medium">Medium — conversational</option>
              <option value="high">High — expressive, engaged</option>
            </select>
          </div>

          <div className="control-item">
            <label className="control-label">
              <input
                type="checkbox"
                checked={canInterrupt}
                onChange={handleCanInterruptCheckChange}
                className="checkbox"
                aria-label="Can interrupt"
              />
              Can Interrupt
              {canInterrupt && <span className="active-badge">ON</span>}
            </label>
          </div>

          <div className="control-item">
            <div className="control-label">Mic Sensitivity</div>
            <select
              className="sensitivity-select"
              value={listeningSensitivity}
              onChange={handleSensitivitySelectChange}
              aria-label="Mic sensitivity"
            >
              <option value="Low">Low — only loud, clear speech</option>
              <option value="Medium">Medium — normal conversation</option>
              <option value="High">High — picks up quiet voice</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
});

BrainControls.displayName = 'BrainControls';

export default BrainControls;
