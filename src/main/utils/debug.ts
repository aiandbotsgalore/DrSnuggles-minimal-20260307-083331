const FEATURE_FLAGS = {
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV !== 'production' && process.env.SNUGGLES_DEBUG === '1',
};

/**
 * Debug logger — no-op in production, avoids conditional checks at every call site.
 *
 * Usage:
 *   debug('[GeminiLiveClient] 🔊 Received raw audio packet...');
 *
 * Enable by setting environment variable: SNUGGLES_DEBUG=1
 */
export const debug: (...args: any[]) => void = FEATURE_FLAGS.ENABLE_DEBUG_LOGS
  ? (...args: any[]) => console.log(...args)
  : () => {};
