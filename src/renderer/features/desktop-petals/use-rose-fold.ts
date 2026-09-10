import { useCallback, useEffect, useRef, useState } from 'react';
import { FLOWER_MOTION } from '@/shared/flower-geometry';

/** A single progress value survives direction changes; only the current run can finish. */
export function useRoseFold(initial: number) {
  const [fold, setFold] = useState(initial);
  const current = useRef(initial),
    frame = useRef<number | null>(null),
    run = useRef(0);
  const stop = useCallback(() => {
    run.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const jump = useCallback(
    (value: number) => {
      stop();
      current.current = value;
      setFold(value);
    },
    [stop],
  );
  const animate = useCallback(
    (to: number, finished?: () => void) => {
      stop();
      const token = run.current,
        from = current.current,
        started = performance.now();
      const duration = Math.abs(to - from) * (to ? FLOWER_MOTION.close : FLOWER_MOTION.open);
      if (!duration || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        current.current = to;
        setFold(to);
        finished?.();
        return;
      }
      const step = (now: number) => {
        if (run.current !== token) return;
        const time = Math.min(1, (now - started) / duration),
          eased = time * time * (3 - 2 * time);
        current.current = from + (to - from) * eased;
        setFold(current.current);
        if (time < 1) frame.current = requestAnimationFrame(step);
        else {
          frame.current = null;
          finished?.();
        }
      };
      frame.current = requestAnimationFrame(step);
    },
    [stop],
  );
  useEffect(() => stop, [stop]);
  return { fold, animate, jump, stop };
}
