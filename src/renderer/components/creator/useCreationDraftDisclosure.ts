import { useLayoutEffect, useRef, useState } from 'react';

/** Animate the capped list height, retaining its scroll position when collapsed. */
export function useCreationDraftDisclosure() {
  const [open, setOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousHeight = useRef<number | null>(null);

  useLayoutEffect(() => {
    const from = previousHeight.current;
    previousHeight.current = null;
    const content = contentRef.current;
    if (from === null || !content || !content.animate) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;
    const to = content.getBoundingClientRect().height;
    if (from === to) return;

    const styles = getComputedStyle(content);
    const durationToken = styles.getPropertyValue('--motion-base').trim();
    const duration = Number.parseFloat(durationToken) * (durationToken.endsWith('ms') ? 1 : 1000);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const animation = content.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration,
      easing: styles.getPropertyValue('--ease-standard').trim() || 'ease-out',
    });
    const stopForReducedMotion = () => {
      if (reducedMotion.matches) animation.cancel();
    };
    reducedMotion.addEventListener('change', stopForReducedMotion);
    return () => {
      animation.cancel();
      reducedMotion.removeEventListener('change', stopForReducedMotion);
    };
  }, [open]);

  function onOpenChange(nextOpen: boolean) {
    if (nextOpen === open) return;
    const content = contentRef.current;
    // Capture the current interpolated height before the previous animation is cancelled.
    previousHeight.current = content?.getBoundingClientRect().height ?? null;
    if (!nextOpen && content?.contains(document.activeElement)) {
      triggerRef.current?.focus({ preventScroll: true });
    }
    setOpen(nextOpen);
  }

  return { open, onOpenChange, contentRef, triggerRef };
}
