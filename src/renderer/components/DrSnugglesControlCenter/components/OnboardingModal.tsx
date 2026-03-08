/**
 * OnboardingModal - First-launch welcome flow
 * Shows 3 steps: pick voice, test audio, start session
 */

import React, { useState } from 'react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    title: 'Welcome to Dr. Snuggles',
    description: 'Pick a voice from the Voice panel in the left sidebar. Charon (deep & authoritative) is the default.',
    icon: '🐻',
  },
  {
    title: 'Check Your Audio',
    description: 'Click the TEST button in the header to verify your speakers work. Make sure your microphone is connected.',
    icon: '🔊',
  },
  {
    title: 'Ready to Go',
    description: 'Click START SESSION in the header to begin a live voice conversation with Dr. Snuggles.',
    icon: '🚀',
  },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(0);

  if (!isOpen) return null;

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  const handleDone = () => {
    localStorage.setItem('onboardingComplete', 'true');
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={handleDone}>
      <div
        className="settings-panel onboarding-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-panel-header">
          <h2 className="settings-title">GETTING STARTED</h2>
          <button className="settings-close-btn" onClick={handleDone}>&times;</button>
        </div>

        <div className="onboarding-content">
          <div className="onboarding-icon">{currentStep.icon}</div>
          <h3 className="onboarding-title">
            {currentStep.title}
          </h3>
          <p className="onboarding-description">
            {currentStep.description}
          </p>

          <div className="step-indicators">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`step-dot ${i === step ? 'active' : ''}`}
              />
            ))}
          </div>

          <div className="onboarding-buttons">
            {!isFirst && (
              <button
                onClick={() => setStep(step - 1)}
                className="btn-back"
              >
                Back
              </button>
            )}
            <button
              onClick={isLast ? handleDone : () => setStep(step + 1)}
              className="btn-next"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

OnboardingModal.displayName = 'OnboardingModal';
export default OnboardingModal;
