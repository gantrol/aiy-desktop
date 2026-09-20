import { useEffect } from 'react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export function useContentSearchShortcut({ active, onOpen }: { active: boolean; onOpen(): void }) {
  const open = useStableCallback(onOpen);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.repeat ||
        event.altKey ||
        !event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'f' ||
        document.querySelector('[role="dialog"][data-state="open"]')
      )
        return;
      event.preventDefault();
      open();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, open]);
}
