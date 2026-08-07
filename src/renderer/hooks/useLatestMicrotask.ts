import { useEffect, useRef } from 'react';

/** Runs lifecycle-triggered integration work after React finishes the current
 * commit. A newer revision or StrictMode cleanup invalidates the queued task. */
export function useLatestMicrotask<T>(target: T | null, revision: unknown, task: (target: T) => void) {
  const taskRef = useRef(task);
  const epochRef = useRef(0);
  taskRef.current = task;

  useEffect(() => {
    if (target === null) return;
    const epoch = ++epochRef.current;
    queueMicrotask(() => {
      if (epochRef.current === epoch) taskRef.current(target);
    });
    return () => {
      if (epochRef.current === epoch) epochRef.current += 1;
    };
  }, [revision, target]);
}
