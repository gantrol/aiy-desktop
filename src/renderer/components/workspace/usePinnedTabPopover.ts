import { useEffect, useRef, useState } from 'react';
import { useHoverIntent } from '@/renderer/components/ui/use-hover-intent';

/** A hover preview never takes editor focus; click/keyboard keeps the list open. */
export function usePinnedTabPopover(enabled: boolean, activeId: string, layout: string) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hoverOnly = useRef(false);
  const contextMenuOpen = useRef(false);
  const intent = useHoverIntent();

  useEffect(() => {
    intent.cancel();
    setOpen(false);
  }, [enabled, activeId, layout, intent]);

  function changeOpen(next: boolean) {
    intent.cancel();
    if (!next) contextMenuOpen.current = false;
    setOpen(next && enabled);
  }
  function enter() {
    intent.cancel();
    if (open || !enabled) return;
    intent.schedule(() => {
      hoverOnly.current = true;
      contextMenuOpen.current = false;
      setOpen(true);
    });
  }
  function leave() {
    intent.cancel();
    if (!hoverOnly.current) return;
    intent.schedule(() => {
      if (hoverOnly.current && !contextMenuOpen.current && !content.current?.contains(document.activeElement))
        setOpen(false);
    });
  }
  function focusCurrent() {
    const current = content.current?.querySelector<HTMLButtonElement>('button[aria-current="page"]');
    const first = content.current?.querySelector<HTMLButtonElement>('button[data-pinned-tab]');
    (current ?? first)?.focus({ preventScroll: true });
    current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function takeFocus() {
    intent.cancel();
    hoverOnly.current = false;
    if (open) focusCurrent();
    else changeOpen(true);
  }

  return {
    open: open && enabled,
    trigger,
    content,
    hoverOnly,
    contextMenuOpen,
    intent,
    changeOpen,
    enter,
    leave,
    focusCurrent,
    takeFocus,
  };
}
