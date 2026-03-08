/**
 * DrSnugglesControlCenter - Main Control Panel
 *
 * Modular architecture with:
 * - Extracted reusable hooks (useAudioServices, useKeyboardShortcuts)
 * - Proper TypeScript types (see ./DrSnugglesControlCenter/types.ts)
 * - useMemo/useCallback optimizations
 * - Modular sub-components (TranscriptPanel, VoiceControls, BrainControls, etc.)
 */

import React, { useReducer, useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { controlCenterReducer, INITIAL_STATE } from './DrSnugglesControlCenter/reducer';
import { ipc } from '../ipc';
import { InputModal } from './InputModal';
import { CostDisplay } from './CostDisplay';
import './styles.css';
import { IPC_CHANNELS } from '../../shared/types';
import { PERFORMANCE_CONFIG } from '../../config/performance.config';
import { downloadAsJson } from '../utils/downloadUtils';

const CollapseIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg viewBox="0 0 24 24" className={`collapse-icon ${collapsed ? 'collapsed' : ''}`}>
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

// Import modular components
import { TranscriptPanel } from './DrSnugglesControlCenter/components/TranscriptPanel';
import { VoiceControls } from './DrSnugglesControlCenter/components/VoiceControls';
import { BrainControls } from './DrSnugglesControlCenter/components/BrainControls';
import { FactCheckerPanel } from './DrSnugglesControlCenter/components/FactCheckerPanel';
import { ContextInjector } from './DrSnugglesControlCenter/components/ContextInjector';
import { AvatarSection } from './DrSnugglesControlCenter/components/AvatarSection';
import { TraceViewer } from './TraceViewer';

// Memoize sub-components to prevent re-render storms
const MemoizedTranscriptPanel = React.memo(TranscriptPanel);
const MemoizedVoiceControls = React.memo(VoiceControls);
const MemoizedBrainControls = React.memo(BrainControls);
const MemoizedFactCheckerPanel = React.memo(FactCheckerPanel);
const MemoizedContextInjector = React.memo(ContextInjector);
const MemoizedAvatarSection = React.memo(AvatarSection);

// Import custom hooks
import { useAudioServices } from './DrSnugglesControlCenter/hooks/useAudioServices';
import { useKeyboardShortcuts, useConsoleForwarding } from './DrSnugglesControlCenter/hooks/useKeyboardShortcuts';

// Import modals
import { OnboardingModal } from './DrSnugglesControlCenter/components/OnboardingModal';
import { ShortcutsModal } from './DrSnugglesControlCenter/components/ShortcutsModal';

import type {
  TranscriptMessage,
  ConnectionStatus,
  VADStatus,
  VoiceName,
  VoiceStyle,
  VoicePace,
  VoiceTone,
  VoiceAccent,
  VADSensitivity,
  CollapsibleSection,
} from './DrSnugglesControlCenter/types';

import type { CostMetrics, LatencyMetrics, VolumeData } from '../../shared/types';

const DrSnugglesControlCenter: React.FC = () => {
  // ===== AUDIO SERVICES =====
  const { startCapture, stopCapture, setVolume, testTone } = useAudioServices();

  // ===== CONSOLE FORWARDING =====
  useConsoleForwarding();

  // ===== REDUCER STATE =====
  const [state, dispatch] = useReducer(controlCenterReducer, INITIAL_STATE);

  // ===== LOCAL UI STATE =====
  const [connectionStep, setConnectionStep] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('onboardingComplete'));
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [activeTab, setActiveTab] = useState<'left' | 'center' | 'right'>('center');
  
  // Destructure state for easier access in render and effects
  const {
    isLive, isConnecting, connectionStatus,
    selectedVoice, useCustomVoice, outputVolume, isMuted, micMuted, voiceStyle, voicePace, voiceTone, voiceAccent,
    thinkingMode, thinkingBudget, emotionalRange, canInterrupt, listeningSensitivity, brainProfile, brainProfiles,
    vadStatus,
    messages, factChecks,
    systemPrompt, promptApplied,
    latency,
    processingStatus, sessionStart, messageCount, speakingTime, costMetrics,
    showSettings, highContrastMode, fontSize, collapsedSections, toast, settingsLoaded,
    modalConfig, sessionDuration, displayAudioLevel
  } = state;

  // ===== REFS =====
  const toastTimeout = useRef<NodeJS.Timeout | null>(null);
  const settingsSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const audioLevelRef = useRef(0);
  const rafRef = useRef<number>(0);

  // Stable refs for values used inside IPC listeners (avoids re-subscription)
  const showToastRef = useRef<(message: string, type?: 'error' | 'success') => void>(() => {});
  const isLiveRef = useRef(isLive);
  const speakingTimeRef = useRef(speakingTime);

  // ===== MEMOIZED VALUES =====


  useEffect(() => {
    const interval = setInterval(() => {
        dispatch({ type: 'UPDATE_METRICS', payload: { sessionDuration: Math.floor((Date.now() - sessionStart) / 1000) } });
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStart]);

  const factCheckStats = useMemo(() => {
    const stats = { total: 0, true: 0, false: 0, misleading: 0, unverified: 0 };
    for (const check of factChecks) {
      stats.total++;
      if (check.verdict === 'True') stats.true++;
      else if (check.verdict === 'False') stats.false++;
      else if (check.verdict === 'Misleading') stats.misleading++;
      else stats.unverified++;
    }
    return stats;
  }, [factChecks]);

  // ===== CALLBACKS =====
  const showToast = useCallback((message: string, type: 'error' | 'success' = 'success') => {
    dispatch({ type: 'SHOW_TOAST', payload: { message, type } });
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    const duration = type === 'error' ? 6000 : PERFORMANCE_CONFIG.UI.TOAST_DURATION_MS;
    toastTimeout.current = setTimeout(() => dispatch({ type: 'HIDE_TOAST' }), duration);
  }, []);

  // Keep refs in sync with latest values
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
  useEffect(() => { speakingTimeRef.current = speakingTime; }, [speakingTime]);

  const toggleSection = useCallback((section: CollapsibleSection) => {
    dispatch({ type: 'TOGGLE_SECTION', payload: section });
  }, []);

  // Stable toggle handlers for React.memo
  const toggleAvatar = useCallback(() => toggleSection('avatar'), [toggleSection]);
  const toggleVoice = useCallback(() => toggleSection('voice'), [toggleSection]);
  const toggleBrain = useCallback(() => toggleSection('brain'), [toggleSection]);
  const toggleAnalytics = useCallback(() => toggleSection('analytics'), [toggleSection]);
  const toggleContext = useCallback(() => toggleSection('context'), [toggleSection]);
  const togglePrompt = useCallback(() => toggleSection('prompt'), [toggleSection]);
  const toggleFacts = useCallback(() => toggleSection('facts'), [toggleSection]);
  const toggleTraces = useCallback(() => toggleSection('traces'), [toggleSection]);

  // ===== IPC LISTENERS =====
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // Phase 2: Use IPC_CHANNELS constants
    unsubscribers.push(ipc.on(IPC_CHANNELS.CONNECTION_STATUS, (_e, data: ConnectionStatus) => {
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: data });
      dispatch({ type: 'SET_IS_CONNECTING', payload: data.connecting || false });
      
      if (data.connected && !data.connecting) {
        dispatch({ type: 'SET_IS_CONNECTING', payload: false });
      }
      
      // Auto-reconnect logic if disconnected unexpectedly
      if (!data.connected && !data.connecting && isLiveRef.current) {
         // console.log("Disconnected while live - UI should check if it needs to trigger reconnect");
         dispatch({ type: 'SET_IS_LIVE', payload: false });
      }
    }));

    unsubscribers.push(ipc.on(IPC_CHANNELS.STREAM_STATUS, (_e, data: { isLive: boolean }) => dispatch({ type: 'SET_IS_LIVE', payload: data.isLive })));
    unsubscribers.push(ipc.on(IPC_CHANNELS.AUDIO_LEVEL, (_e, data: { level: number }) => {
      // Use ref for animation loop, but store in reducer for display if needed (though ref is better for high freq)
      audioLevelRef.current = data.level;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
          dispatch({ type: 'SET_DISPLAY_AUDIO_LEVEL', payload: data.level });
      });
    }));
    unsubscribers.push(ipc.on(IPC_CHANNELS.VOLUME_UPDATE, (_e, data: VolumeData) => {
      const level = Number.isFinite(data?.input) ? data.input : 0;
      audioLevelRef.current = level;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
          dispatch({ type: 'SET_DISPLAY_AUDIO_LEVEL', payload: level });
      });
    }));
    unsubscribers.push(ipc.on(IPC_CHANNELS.GENAI_LATENCY_UPDATE, (_e, data: LatencyMetrics) => {
      const latency = Number.isFinite(data?.totalRoundtrip) ? data.totalRoundtrip : 0;
      dispatch({ type: 'UPDATE_METRICS', payload: { latency } });
    }));

    unsubscribers.push(ipc.on(IPC_CHANNELS.VITALS_AUDIO_STATS, (_e, data: CostMetrics) => {
      dispatch({ type: 'UPDATE_METRICS', payload: { costMetrics: data } });
    }));
    unsubscribers.push(ipc.on(IPC_CHANNELS.GENAI_VAD_STATE, (_e, data: VADStatus) => {
      dispatch({ type: 'SET_VAD_STATUS', payload: data });
      if (data.isSpeaking) {
         dispatch({ type: 'UPDATE_METRICS', payload: { speakingTime: speakingTimeRef.current + 0.1 } }); // Approx
      }
    }));

    unsubscribers.push(ipc.on(IPC_CHANNELS.MESSAGE_RECEIVED, (_e, data: TranscriptMessage) => {
      dispatch({ type: 'ADD_MESSAGE', payload: data });
    }));

    // Phase 2: Removed orphaned listeners (cost:update, fact-check:claim, processing:status)

    unsubscribers.push(ipc.on(IPC_CHANNELS.UI_TOAST, (_e, data: { message: string; type?: 'error' | 'success' }) => {
      if (data?.message) showToastRef.current(data.message, data.type || 'success');
    }));

    return () => {
      unsubscribers.forEach(unsub => unsub?.());
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, []); // Empty deps — stable subscription via refs

  // Always default to Gemini native voice on load.
  // ElevenLabs is opt-in per session via explicit user toggle.
  useEffect(() => {
    dispatch({ type: 'SET_VOICE_SETTINGS', payload: { useCustomVoice: false } });
    ipc.invoke(IPC_CHANNELS.VOICE_TOGGLE_CUSTOM, false).catch(() => null);
  }, []);

  // ===== TRANSCRIPT LISTENER =====
  useEffect(() => {
    const handleTranscript = (event: CustomEvent<{ text: string; role: 'user' | 'assistant' }>) => {
      const { text, role } = event.detail;
      const newMessage: TranscriptMessage = {
        id: `msg-${Date.now()}-${Math.random()}`,
        role,
        text,
        timestamp: Date.now()
      };
      dispatch({ type: 'ADD_MESSAGE', payload: newMessage });
    };
    window.addEventListener('snugglesTranscript', handleTranscript as EventListener);
    return () => window.removeEventListener('snugglesTranscript', handleTranscript as EventListener);
  }, []);

  // ===== VOLUME SYNC =====
  useEffect(() => { setVolume(outputVolume); }, [outputVolume, setVolume]);

  // ===== SETTINGS PERSISTENCE =====
  // ===== SETTINGS PERSISTENCE =====
  useEffect(() => {
    try {
      const saved = localStorage.getItem('drSnugglesSettings');
      if (saved) {
        const settings = JSON.parse(saved);
        if (settings.selectedVoice) dispatch({ type: 'SET_VOICE_SETTINGS', payload: { selectedVoice: settings.selectedVoice } });
        if (typeof settings.outputVolume === 'number') dispatch({ type: 'SET_VOICE_SETTINGS', payload: { outputVolume: settings.outputVolume } });
        
        const brainSettings: any = {};
        if (typeof settings.thinkingMode === 'boolean') brainSettings.thinkingMode = settings.thinkingMode;
        if (typeof settings.thinkingBudget === 'number') brainSettings.thinkingBudget = settings.thinkingBudget;
        if (typeof settings.emotionalRange === 'string') brainSettings.emotionalRange = settings.emotionalRange;
        if (typeof settings.canInterrupt === 'boolean') brainSettings.canInterrupt = settings.canInterrupt;
        if (settings.listeningSensitivity) brainSettings.listeningSensitivity = settings.listeningSensitivity;
        if (Object.keys(brainSettings).length > 0) dispatch({ type: 'SET_BRAIN_SETTINGS', payload: brainSettings });

        if (settings.systemPrompt) dispatch({ type: 'SET_SYSTEM_PROMPT', payload: settings.systemPrompt });
      }
    } catch (e) {
      console.error('[GUI] Failed to load settings:', e);
    } finally {
      dispatch({ type: 'SET_UI_STATE', payload: { settingsLoaded: true } });
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (settingsSaveTimeout.current) clearTimeout(settingsSaveTimeout.current);
    // Phase 2: Use config constant for debounce
    settingsSaveTimeout.current = setTimeout(() => {
      try {
        localStorage.setItem('drSnugglesSettings', JSON.stringify({
          selectedVoice, outputVolume, thinkingMode, thinkingBudget,
          emotionalRange, canInterrupt, listeningSensitivity, systemPrompt,
          lastSaved: Date.now()
        }));
      } catch (e) { console.error('[GUI] Failed to save settings:', e); }
    }, PERFORMANCE_CONFIG.UI.SETTINGS_SAVE_DEBOUNCE_MS);
    return () => { if (settingsSaveTimeout.current) clearTimeout(settingsSaveTimeout.current); };
  }, [settingsLoaded, selectedVoice, outputVolume, thinkingMode, thinkingBudget, emotionalRange, canInterrupt, listeningSensitivity, systemPrompt]);

  // ===== HANDLERS =====
  const handleGoLive = useCallback(async () => {
    if (isLive) return;
    dispatch({ type: 'SET_IS_CONNECTING', payload: true });

    try {
      setConnectionStep('Initializing...');
      await stopCapture(); // Ensure clean slate
      setConnectionStep('Activating mic...');
      await startCapture();
      setConnectionStep('Connecting to Gemini...');
      const result = await ipc.invoke(IPC_CHANNELS.GENAI_START_SESSION, {});
      if (!result || result.success !== true) {
        throw new Error(result?.error || 'No response from backend while starting session');
      }
      setConnectionStep('');
      ipc.send(IPC_CHANNELS.STREAM_STATUS, { isLive: true });
      dispatch({ type: 'SET_IS_LIVE', payload: true });
    } catch (error: any) {
      console.error("Failed to go live:", error);
      dispatch({ type: 'SET_IS_CONNECTING', payload: false });
      dispatch({ type: 'SET_IS_LIVE', payload: false });
      setConnectionStep('');
      const msg = error?.message || String(error);
      let userMessage: string;
      if (/api|key/i.test(msg)) {
        userMessage = 'API key issue — check your Gemini API key';
      } else if (/network|ENOTFOUND|fetch/i.test(msg)) {
        userMessage = 'Network error — check your internet connection';
      } else if (/rate|429/i.test(msg)) {
        userMessage = 'Rate limited — wait a moment and try again';
      } else if (/device|microphone|permission/i.test(msg)) {
        userMessage = 'No audio device found — check mic permissions';
      } else {
        userMessage = `Connection failed: ${msg}`;
      }
      showToast(userMessage, "error");
    }
  }, [isLive, startCapture, stopCapture, showToast]);

  const handleDisconnect = useCallback(async () => {
    dispatch({ type: 'SET_IS_CONNECTING', payload: false });
    dispatch({ type: 'SET_IS_LIVE', payload: false });
    await stopCapture();
    ipc.send(IPC_CHANNELS.DISCONNECT_GEMINI);
    ipc.send(IPC_CHANNELS.STREAM_STATUS, { isLive: false });
  }, [stopCapture]);

  const handleMuteToggle = useCallback(async () => {
    const newMuted = !isMuted;
    try {
      const result = await ipc.invoke(IPC_CHANNELS.TOGGLE_MUTE, newMuted);
      if (!result || result.success !== true) {
        throw new Error(result?.error || 'No response from backend while toggling mute');
      }
      const confirmedMuted = typeof result?.muted === 'boolean' ? result.muted : newMuted;
      dispatch({ type: 'SET_VOICE_SETTINGS', payload: { isMuted: confirmedMuted } });
    } catch (error) {
      console.error("Failed to toggle output mute:", error);
      dispatch({ type: 'SET_VOICE_SETTINGS', payload: { isMuted: newMuted } });
      showToast('Output mute may be out of sync with backend', 'error');
    }
  }, [isMuted, showToast]);

  const handleMicToggle = useCallback(() => {
    const newMicMuted = !micMuted;
    dispatch({ type: 'SET_VOICE_SETTINGS', payload: { micMuted: newMicMuted } });
    ipc.send(IPC_CHANNELS.MIC_TOGGLE, newMicMuted);
    if (newMicMuted) {
      stopCapture();
    } else {
      if (isLive) startCapture();
    }
  }, [micMuted, isLive, startCapture, stopCapture]);

  const handleInterrupt = useCallback(() => {
    ipc.send(IPC_CHANNELS.AUDIO_INTERRUPT);
    showToast("Interrupted");
  }, [showToast]);

  const handleToggleConnection = useCallback(() => {
    if (isLive) {
      handleDisconnect();
    } else {
      handleGoLive();
    }
  }, [isLive, handleDisconnect, handleGoLive]);

  const handleToggleCustomVoice = useCallback(async (useCustom: boolean) => {
    try {
      const result = await ipc.invoke(IPC_CHANNELS.VOICE_TOGGLE_CUSTOM, useCustom);
      if (result?.success) {
        dispatch({ type: 'SET_VOICE_SETTINGS', payload: { useCustomVoice: useCustom } });
        showToast(useCustom ? 'ElevenLabs custom voice enabled' : 'Gemini native voice enabled', 'success');
      } else {
        dispatch({ type: 'SET_VOICE_SETTINGS', payload: { useCustomVoice: false } });
        showToast(result?.error || 'ElevenLabs custom voice is unavailable', 'error');
      }
    } catch (e: any) {
      dispatch({ type: 'SET_VOICE_SETTINGS', payload: { useCustomVoice: false } });
      showToast(e?.message || 'Failed to switch voice mode', 'error');
    }
  }, [showToast]);

  const handleVoiceChange = useCallback((voice: VoiceName) => {
    dispatch({ type: 'SET_VOICE_SETTINGS', payload: { selectedVoice: voice } });
    ipc.send(IPC_CHANNELS.VOICE_SELECT, voice);
  }, []);

  const handleVolumeChange = useCallback((volume: number) => {
    dispatch({ type: 'SET_VOICE_SETTINGS', payload: { outputVolume: volume } });
    ipc.send(IPC_CHANNELS.SET_VOLUME, volume / 100);
  }, []);

  const handleThinkingModeToggle = useCallback(() => {
    const newValue = !thinkingMode;
    dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { thinkingMode: newValue } });
    ipc.send(IPC_CHANNELS.BRAIN_THINKING_MODE, newValue);
  }, [thinkingMode]);

  const handleSendMessage = useCallback((text: string) => {
    // Optimistic update? Maybe not for chat interface, let's wait for echo or just append user msg
    dispatch({ type: 'ADD_MESSAGE', payload: {
        id: crypto.randomUUID(),
        role: 'user',
        text: text,
        timestamp: Date.now()
    }});
    
    ipc.send(IPC_CHANNELS.SEND_MESSAGE, text);
    showToast("Message sent");
  }, [showToast]);

  const handleExportTranscript = useCallback(() => {
    downloadAsJson(messages, 'transcript');
    showToast('Transcript exported');
  }, [messages, showToast]);

  const handleClearTranscript = useCallback(() => {
    dispatch({ type: 'OPEN_MODAL', payload: {
      isOpen: true,
      title: 'Clear Transcript',
      description: 'Are you sure?',
      confirmText: 'Clear',
      confirmVariant: 'danger',
      type: 'clearTranscript',
    }});
  }, []);

  const handleExportFactChecks = useCallback(() => {
    downloadAsJson(factChecks, 'factchecks');
    showToast('Fact checks exported');
  }, [factChecks, showToast]);

  const handleClearFactChecks = useCallback(() => {
    dispatch({ type: 'OPEN_MODAL', payload: {
      isOpen: true,
      title: 'Clear Fact Checks',
      description: 'Are you sure?',
      confirmText: 'Clear',
      confirmVariant: 'danger',
      type: 'clearFactChecks',
    }});
  }, []);

  const handleModalSubmit = useCallback((value?: string) => {
    if (modalConfig.type === 'clearTranscript') {
      dispatch({ type: 'SET_MESSAGES', payload: [] });
      dispatch({ type: 'UPDATE_METRICS', payload: { messageCount: 0 } });
      showToast('Transcript cleared');
    } else if (modalConfig.type === 'clearFactChecks') {
       dispatch({ type: 'SET_FACT_CHECKS', payload: [] });
       showToast('Fact checks cleared');
    } else if (modalConfig.type === 'saveProfile' && value) {
       const newProfile = {
         thinking: thinkingMode,
         budget: thinkingBudget,
         emotional: emotionalRange,
         interrupt: canInterrupt,
         sensitivity: listeningSensitivity,
         spontaneity: false, // Default
         voice: selectedVoice,
       };
       const newProfiles = { ...brainProfiles, [value]: newProfile };
       dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { 
           brainProfiles: newProfiles,
           brainProfile: value
       }});
       showToast(`Profile "${value}" saved`);
    } else if (modalConfig.type === 'addPreset' && value) {
       showToast(`Preset "${value}" added`);
    }

    dispatch({ type: 'CLOSE_MODAL' });
  }, [modalConfig, thinkingMode, thinkingBudget, emotionalRange, canInterrupt, listeningSensitivity, selectedVoice, brainProfiles, showToast]);

  const handleBrainProfileChange = useCallback((profileName: string) => {
    dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { brainProfile: profileName } });
    if (brainProfiles[profileName]) {
         const p = brainProfiles[profileName];
         dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { 
             thinkingMode: p.thinking,
             thinkingBudget: p.budget,
             emotionalRange: p.emotional,
             canInterrupt: p.interrupt,
             listeningSensitivity: p.sensitivity
         }});
         
         // Sync with backend
         ipc.send(IPC_CHANNELS.BRAIN_THINKING_MODE, p.thinking);
         ipc.send(IPC_CHANNELS.BRAIN_THINKING_BUDGET, p.budget);
         ipc.send(IPC_CHANNELS.AUDIO_CAN_INTERRUPT, p.interrupt);
         // ... other syncs if needed
    }
  }, [brainProfiles]);

  const handleSystemPromptChange = useCallback((text: string) => {
    dispatch({ type: 'SET_SYSTEM_PROMPT', payload: text });
  }, []);

  const handleApplySystemPrompt = useCallback(() => {
    ipc.send(IPC_CHANNELS.SYSTEM_UPDATE_PROMPT, systemPrompt);
    dispatch({ type: 'SET_PROMPT_APPLIED', payload: true });
    showToast("System prompt applied");
  }, [systemPrompt, showToast]);

  const handleSaveBrainProfile = useCallback(() => {
      dispatch({ type: 'OPEN_MODAL', payload: {
        isOpen: true,
        title: 'Save Brain Profile',
        placeholder: 'Profile Name',
        confirmText: 'Save',
        confirmVariant: 'primary',
        type: 'saveProfile',
      }});
  }, []);
  
  const handleAddPreset = useCallback(() => {
      dispatch({ type: 'OPEN_MODAL', payload: {
        isOpen: true,
        title: 'Add Preset',
        placeholder: 'Preset Text',
        confirmText: 'Add',
        confirmVariant: 'primary',
        type: 'addPreset',
      }});
  }, []);

  // ===== VOICES HANDLERS =====
  const handleVoiceStyleChange = useCallback((style: VoiceStyle) => {
      dispatch({ type: 'SET_VOICE_SETTINGS', payload: { voiceStyle: style } });
  }, []);
  const handleVoicePaceChange = useCallback((pace: VoicePace) => {
      dispatch({ type: 'SET_VOICE_SETTINGS', payload: { voicePace: pace } });
  }, []);
  const handleVoiceToneChange = useCallback((tone: VoiceTone) => {
      dispatch({ type: 'SET_VOICE_SETTINGS', payload: { voiceTone: tone } });
  }, []);
  const handleVoiceAccentChange = useCallback((accent: VoiceAccent) => {
      dispatch({ type: 'SET_VOICE_SETTINGS', payload: { voiceAccent: accent } });
  }, []);

  // ===== BRAIN HANDLERS =====
  const handleThinkingBudgetChange = useCallback((budget: number) => {
      dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { thinkingBudget: budget } });
      ipc.send(IPC_CHANNELS.BRAIN_THINKING_BUDGET, budget);
  }, []);
  const handleEmotionalRangeChange = useCallback((range: 'low' | 'medium' | 'high') => {
      dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { emotionalRange: range } });
      // ipc.send(IPC_CHANNELS.BRAIN_EMOTIONAL_RANGE, range); // If exists
  }, []);
  const handleCanInterruptChange = useCallback((canInterrupt: boolean) => {
      dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { canInterrupt } });
      ipc.send(IPC_CHANNELS.AUDIO_CAN_INTERRUPT, canInterrupt);
  }, []);
  const handleListeningSensitivityChange = useCallback((sensitivity: VADSensitivity) => {
      dispatch({ type: 'SET_BRAIN_SETTINGS', payload: { listeningSensitivity: sensitivity } });
      ipc.send(IPC_CHANNELS.AUDIO_VAD_SENSITIVITY, sensitivity);
  }, []);

  // ===== KEYBOARD SHORTCUTS =====
  const handleFocusSearch = useCallback(() => {
    const searchInput = document.querySelector('[data-search]') as HTMLInputElement;
    if (searchInput) searchInput.focus();
  }, []);

  const handleSendContext = useCallback(() => {
    // Ctrl+Enter — handled by context injector
  }, []);

  const toggleShortcuts = useCallback(() => {
    setShowShortcuts(prev => !prev);
  }, []);

  useKeyboardShortcuts({
    onSendContext: handleSendContext,
    onFocusSearch: handleFocusSearch,
    onToggleMute: handleMuteToggle,
    onInterrupt: handleInterrupt,
    onToggleShortcuts: toggleShortcuts,
    isLive,
  });

  // ===== LATENCY HISTORY =====
  useEffect(() => {
    if (latency > 0) {
      setLatencyHistory(prev => [...prev, latency].slice(-30));
    }
  }, [latency]);

  // ===== RESPONSIVE =====
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const showLeftSidebar = windowWidth >= 1100;
  const showRightSidebar = windowWidth >= 1400;
  const showTabBar = windowWidth < 1100;

  const baseFontSize = fontSize / 100;

  // ===== RENDER =====
  return (
    <div className={`container ${highContrastMode ? 'high-contrast' : ''}`} style={{ fontSize: `${baseFontSize}rem` }}>
      {/* Header */}
      <div className="header">
        <div className="header-left">
          <div className="status-group">
            <div
              className="status-indicator"
              style={{
                backgroundColor: isLive ? '#00ff88' : '#666',
                animation: isLive ? 'pulse 2s infinite' : 'none'
              }}
            />
            <span className="status-text">{isLive ? 'LIVE' : connectionStatus.error ? 'RECOVERING' : 'OFFLINE'}</span>
          </div>
          <div className="mic-status-group">
            <span
              className={`mic-status-indicator ${micMuted ? 'muted' : ''} ${vadStatus.isListening ? 'listening' : ''} ${vadStatus.isSpeaking ? 'speaking' : ''}`}
            >
              {micMuted ? '🔇' : '🎤'}
            </span>
            <span className="mic-status-subtext" style={{ color: isConnecting ? '#ffaa00' : '#888' }}>
              {isConnecting ? connectionStep || 'CONNECTING' :
                micMuted ? 'MUTED' :
                  vadStatus.isListening ? 'AI SPEAKING' :
                    vadStatus.isSpeaking ? 'LISTENING' : 'IDLE'}
            </span>
          </div>
          <button
            className={`go-live-button ${isLive ? 'active' : ''}`}
            style={{
              opacity: isConnecting ? 0.7 : 1,
              cursor: isConnecting ? 'wait' : 'pointer'
            }}
            onClick={handleToggleConnection}
            disabled={isConnecting}
          >
            {isConnecting && <div className="spinner" />}
            {isConnecting ? (connectionStep || 'CONNECTING...') : isLive ? '⏹ END SESSION' : '▶ START SESSION'}
          </button>
          <button
            className="secondary-button"
            style={{ marginLeft: '10px' }}
            onClick={testTone}
          >
            🔊 TEST
          </button>
          {isLive && (
            <button
              className="interrupt-button"
              onClick={handleInterrupt}
              aria-label="Interrupt AI"
            >
              ⏹ INTERRUPT
            </button>
          )}
        </div>
        <div className="header-center">
          <span className="title">DR. SNUGGLES CONTROL CENTER</span>
        </div>
        <div className="header-right">
          <div className="quality-indicator">
            <div className="quality-bars">
              {[1, 2, 3, 4, 5].map(bar => (
                <div key={bar} className="quality-bar" style={{
                  backgroundColor: connectionStatus.quality >= bar * 20 ? '#00ff88' : '#333',
                  height: `${bar * 20}%`
                }} />
              ))}
            </div>
            <span className="quality-text">{connectionStatus.quality}%</span>
          </div>
          <button className="settings-button" onClick={() => dispatch({ type: 'SET_UI_STATE', payload: { showSettings: !showSettings } })}>⚙️</button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-bar-item">
          <span className="status-bar-label">LATENCY</span>
          <span className="status-bar-value" style={{ color: latency < 100 ? '#00ff88' : latency < 200 ? '#ffaa00' : '#ff4444' }}>
            {latency.toFixed(0)}ms
          </span>
          {latencyHistory.length > 1 && (
            <svg width="60" height="16" viewBox={`0 0 ${latencyHistory.length - 1} 16`} style={{ marginLeft: '4px' }}>
              <polyline
                fill="none"
                stroke="#666"
                strokeWidth="1"
                points={latencyHistory.map((v, i) => `${i},${16 - Math.min(v / 20, 16)}`).join(' ')}
              />
              <circle
                cx={latencyHistory.length - 1}
                cy={16 - Math.min(latency / 20, 16)}
                r="2"
                fill={latency < 100 ? '#00ff88' : latency < 200 ? '#ffaa00' : '#ff4444'}
              />
            </svg>
          )}
        </div>
        <div className="status-bar-item">
          <span className="status-bar-label">QUEUE</span>
          <span className="status-bar-value">{processingStatus.queueDepth}</span>
        </div>
        <div className="status-bar-item">
          <span className="status-bar-label">SESSION</span>
          <span className="status-bar-value">{Math.floor(sessionDuration / 60)}:{(sessionDuration % 60).toString().padStart(2, '0')}</span>
        </div>
      </div>

      {/* Cost Display */}
      {costMetrics && (
        <div className="cost-display-container">
          <CostDisplay metrics={costMetrics} />
        </div>
      )}

      {/* Tab Bar (narrow screens) */}
      {showTabBar && (
        <div className="tab-bar">
          {(['left', 'center', 'right'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`tab-button ${activeTab === tab ? 'active' : ''}`}
            >
              {tab === 'left' ? 'CONTROLS' : tab === 'center' ? 'TRANSCRIPT' : 'TOOLS'}
            </button>
          ))}
        </div>
      )}

      {/* Main Layout */}
      <div className="main-layout">
        {/* Left Sidebar */}
        {(showLeftSidebar || (showTabBar && activeTab === 'left')) && (
        <div className="left-sidebar" style={showTabBar ? { width: '100% ' } : {}}>
          <MemoizedAvatarSection
            vadStatus={vadStatus}
            audioLevel={displayAudioLevel}
            isCollapsed={collapsedSections.has('avatar')}
            onToggleCollapse={toggleAvatar}
            systemStatus={isLive ? (vadStatus.isListening ? 'listening' : vadStatus.isSpeaking ? 'speaking' : thinkingMode ? 'thinking' : 'idle') : 'offline'}
            isLive={isLive}
            isConnecting={isConnecting}
            onToggleConnection={handleToggleConnection}
          />

          <MemoizedVoiceControls
            selectedVoice={selectedVoice}
            onVoiceChange={handleVoiceChange}
            useCustomVoice={useCustomVoice}
            onToggleCustomVoice={handleToggleCustomVoice}
            outputVolume={outputVolume}
            onVolumeChange={handleVolumeChange}
            isMuted={isMuted}
            onMuteToggle={handleMuteToggle}
            micMuted={micMuted}
            onMicToggle={handleMicToggle}
            onInterrupt={handleInterrupt}
            voiceStyle={voiceStyle}
            voicePace={voicePace}
            voiceTone={voiceTone}
            voiceAccent={voiceAccent}
            onStyleChange={handleVoiceStyleChange}
            onPaceChange={handleVoicePaceChange}
            onToneChange={handleVoiceToneChange}
            onAccentChange={handleVoiceAccentChange}
            isCollapsed={collapsedSections.has('voice')}
            onToggleCollapse={toggleVoice}
          />

          <MemoizedBrainControls
            brainProfile={brainProfile}
            brainProfiles={brainProfiles}
            onProfileChange={handleBrainProfileChange}
            onSaveProfile={handleSaveBrainProfile}
            thinkingMode={thinkingMode}
            onThinkingModeToggle={handleThinkingModeToggle}
            thinkingBudget={thinkingBudget}
            onThinkingBudgetChange={handleThinkingBudgetChange}
            emotionalRange={emotionalRange}
            onEmotionalRangeChange={handleEmotionalRangeChange}
            canInterrupt={canInterrupt}
            onCanInterruptChange={handleCanInterruptChange}
            listeningSensitivity={listeningSensitivity}
            onListeningSensitivityChange={handleListeningSensitivityChange}
            isCollapsed={collapsedSections.has('brain')}
            onToggleCollapse={toggleBrain}
          />

          {/* Analytics */}
          <div className="section">
            <div className="section-header-row">
              <div className="section-header">📊 ANALYTICS</div>
              <button className="collapse-btn" onClick={toggleAnalytics} title="Toggle Analytics">
                <CollapseIcon collapsed={collapsedSections.has('analytics')} />
              </button>
            </div>
            {!collapsedSections.has('analytics') && (
              <div className="analytics">
                <div className="analytics-row"><span>Messages:</span><span className="analytics-value">{messageCount}</span></div>
                <div className="analytics-row"><span>Speaking:</span><span className="analytics-value">{Math.floor(speakingTime)}s</span></div>
                <div className="analytics-row"><span>Facts:</span><span className="analytics-value">{factCheckStats.total}</span></div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Center - Transcript */}
        {(!showTabBar || activeTab === 'center') && (
        <MemoizedTranscriptPanel
          messages={messages}
          connectionStatus={connectionStatus}
          onExport={handleExportTranscript}
          onClear={handleClearTranscript}
          onSendMessage={handleSendMessage}
        />
        )}

        {/* Right Sidebar */}
        {(showRightSidebar || (showTabBar && activeTab === 'right')) && (
        <div className="right-sidebar" style={showTabBar ? { width: '100%' } : {}}>
          <MemoizedContextInjector
            onAddPreset={handleAddPreset}
            isCollapsed={collapsedSections.has('context')}
            onToggleCollapse={toggleContext}
          />

          {/* System Prompt - keeping inline since it's tightly coupled */}
          <div className="section">
            <div className="section-header-row">
              <div className="section-header">📝 SYSTEM PROMPT</div>
              <button className="collapse-btn" onClick={togglePrompt} title="Toggle System Prompt">
                <CollapseIcon collapsed={collapsedSections.has('prompt')} />
              </button>
            </div>
            {!collapsedSections.has('prompt') && (
              <>
                <textarea
                  className="system-prompt-editor"
                  value={systemPrompt}
                  onChange={(e) => handleSystemPromptChange(e.target.value)}
                  aria-label="System prompt editor"
                />
                <button
                  className="apply-button"
                  style={{ background: promptApplied ? 'rgba(0, 255, 0, 0.3)' : 'rgba(76, 175, 80, 0.3)' }}
                  onClick={handleApplySystemPrompt}
                >
                  {promptApplied ? '✓ APPLIED!' : '✓ APPLY'}
                </button>
              </>
            )}
          </div>

          <MemoizedFactCheckerPanel
            factChecks={factChecks}
            onExport={handleExportFactChecks}
            onClear={handleClearFactChecks}
            isCollapsed={collapsedSections.has('facts')}
            onToggleCollapse={toggleFacts}
          />

          {/* Interaction Traces */}
          <div className="section">
            <div className="section-header-row">
              <div className="section-header">🔍 INTERACTION TRACES</div>
              <button className="collapse-btn" onClick={toggleTraces} title="Toggle Interaction Traces">
                <CollapseIcon collapsed={collapsedSections.has('traces')} />
              </button>
            </div>
            {!collapsedSections.has('traces') && <TraceViewer />}
          </div>
        </div>
        )}
      </div>

      {/* Toast */}
      {
        toast && (
          <div className="toast-container">
            <div
              className="toast"
              style={{
                background: toast.type === 'error' ? 'rgba(255, 68, 68, 0.9)' : 'rgba(0, 255, 136, 0.9)',
                color: toast.type === 'error' ? '#fff' : '#000',
              }}
            >
              {toast.type === 'error' ? '⚠️ ' : '✅ '}{toast.message}
            </div>
          </div>
        )
      }

      {/* Modal */}
      <InputModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        placeholder={modalConfig.placeholder}
        description={modalConfig.description}
        confirmText={modalConfig.confirmText}
        confirmVariant={modalConfig.confirmVariant}
        onClose={() => dispatch({ type: 'CLOSE_MODAL' })}
        onSubmit={handleModalSubmit}
      />

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
      />

      {/* Shortcuts Modal */}
      <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div >
  );
};

export default DrSnugglesControlCenter;
