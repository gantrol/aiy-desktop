import { useCallback, useEffect, useRef, useState } from 'react';

export function useElementFullscreen<T extends HTMLElement>() {
  const targetRef = useRef<T | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreenState = () => {
      if (document.fullscreenElement === targetRef.current) setFullscreen(true);
      else if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const exitFallbackFullscreen = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) setFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', exitFallbackFullscreen);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', exitFallbackFullscreen);
    };
  }, [fullscreen]);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement === targetRef.current) {
        await document.exitFullscreen().catch(() => undefined);
      }
      return;
    }

    setFullscreen(true);
    const target = targetRef.current;
    if (!target || typeof target.requestFullscreen !== 'function') return;
    await target.requestFullscreen().catch(() => undefined);
  }, [fullscreen]);

  return { fullscreen, targetRef, toggleFullscreen };
}
