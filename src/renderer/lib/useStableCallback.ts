import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns a callback with a stable identity that always invokes the latest
 * implementation. Lets memoized list rows survive a parent re-render without
 * the stale-closure risk of hand-written dependency arrays.
 *
 * Event handlers only — the current implementation is not readable during
 * render.
 */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
