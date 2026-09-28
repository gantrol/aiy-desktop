import { useLayoutEffect, useState } from 'react';

/** Keep the departing page painted for the fade, but never extend its interaction lifetime. */
export function useWorkspaceGroupPresentation(collapsed: boolean) {
  const [retained, setRetained] = useState(!collapsed);

  useLayoutEffect(() => {
    if (!collapsed) {
      setRetained(true);
      return;
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => setRetained(false);
    if (motion.matches) {
      finish();
      return;
    }
    // Matches the outgoing opacity transition and the split layout's movement delay.
    const timer = window.setTimeout(finish, 60);
    const onMotionChange = () => {
      if (motion.matches) finish();
    };
    motion.addEventListener('change', onMotionChange);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener('change', onMotionChange);
    };
  }, [collapsed]);

  return !collapsed || retained;
}
