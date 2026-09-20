import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

const motionQuery = '(prefers-reduced-motion: reduce)';
const motionSnapshot = () => typeof matchMedia === 'function' && matchMedia(motionQuery).matches;
const motionServerSnapshot = () => true;
function subscribeMotion(changed: () => void) {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia(motionQuery);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}
export function useMediaReducedMotion() {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, motionServerSnapshot);
}

/** Visibility is a playback condition, not a permanent "has been seen" flag. */
export function useMediaActivity(ref: RefObject<HTMLElement | null>, identity: string) {
  const [intersecting, setIntersecting] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document !== 'undefined' && document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIntersecting(true);
      return;
    }
    setIntersecting(false);
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting), {
      rootMargin: '0px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [identity, ref]);
  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  return intersecting && pageVisible;
}
