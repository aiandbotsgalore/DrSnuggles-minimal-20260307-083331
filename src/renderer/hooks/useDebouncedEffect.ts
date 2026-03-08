import { useEffect, useRef } from 'react';

/**
 * useDebouncedEffect — Like useEffect, but debounces the callback.
 *
 * Useful for settings persistence and other effects that fire on
 * high-frequency state changes but only need to execute once the
 * user stops interacting.
 *
 * @param callback - Effect function to run after debounce period
 * @param deps - Dependency array (same as useEffect)
 * @param delayMs - Debounce delay in milliseconds
 */
export function useDebouncedEffect(
  callback: () => void,
  deps: React.DependencyList,
  delayMs: number,
): void {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);

  // Always keep the latest callback
  callbackRef.current = callback;

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callbackRef.current(), delayMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delayMs]);
}
