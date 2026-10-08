import { useCallback, useEffect, useRef, type FocusEvent } from 'react';

/** Follow the type control when the sidebar header gives way to the compact menu. */
export function useContentSearchFilterFocus() {
  const root = useRef<HTMLDivElement | null>(null);
  const focused = useRef(false);
  const restoreFocus = useRef(false);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    root.current = node;
    if (restoreFocus.current) {
      restoreFocus.current = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const target = root.current;
        if (!target?.isConnected || target.closest('[hidden], [inert]') || !document.hasFocus()) return;
        const current = document.activeElement;
        if (current && current !== document.body && !target.contains(current)) return;
        const control = target.querySelector<HTMLElement>('button[data-state="on"]') ?? target.querySelector('button');
        control?.focus({ preventScroll: true });
      });
    }
    return () => {
      // Focus events include the menu portal, which is outside this DOM subtree.
      restoreFocus.current = focused.current;
      focused.current = false;
      if (root.current === node) root.current = null;
    };
  }, []);
  return {
    root,
    controlProps: {
      ref,
      onFocusCapture: () => {
        focused.current = true;
      },
      onBlurCapture: (event: FocusEvent<HTMLDivElement>) => {
        if (event.relatedTarget) focused.current = event.currentTarget.contains(event.relatedTarget);
      },
    },
  };
}
