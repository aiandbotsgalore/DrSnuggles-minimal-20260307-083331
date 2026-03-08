/**
 * DrSnugglesControlCenter - Refactored Module Index
 *
 * This module was refactored during an audit to address:
 * - Monolithic component (2,152 lines → modular components)
 * - Missing TypeScript types (any → proper interfaces)
 * - Missing React optimizations (useMemo, useCallback)
 * - Effect dependency issues (keyboard shortcuts)
 *
 * Usage:
 *   // For backwards compatibility, import from parent:
 *   import DrSnugglesControlCenter from '../components/DrSnugglesControlCenter';
 *
 *   // For individual components:
 *   import { TranscriptPanel, VoiceControls } from '../components/DrSnugglesControlCenter/components';
 *
 *   // For custom hooks:
 *   import { useAudioServices, useIPCListeners } from '../components/DrSnugglesControlCenter/hooks';
 *
 *   // For types:
 *   import type { TranscriptMessage, FactCheck } from '../components/DrSnugglesControlCenter/types';
 */

// Re-export the main component
export { default } from '../DrSnugglesControlCenter';

// Export types
export * from './types';

// Export hooks
export * from './hooks';

// Export individual components
export * from './components';
