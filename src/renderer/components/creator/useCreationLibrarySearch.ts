import { useEffect, useRef, useState } from 'react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  active: boolean;
  collapsed: boolean;
  selectionKey: string;
}

/** Search visibility is independent of the persisted sidebar layout. */
export function useCreationLibrarySearch({ active, collapsed, selectionKey }: Options) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const restorePopoverFocus = useRef(true);

  function onPopoverOpenChange(open: boolean) {
    restorePopoverFocus.current = true;
    setPopoverOpen(open);
    if (!open) {
      setQuery('');
      setSearchOpen(false);
    }
  }

  const dismissPopover = useStableCallback((clearQuery: boolean) => {
    if (!popoverOpen) return;
    // Navigation or a layout change owns focus; dismissing must not steal it back.
    restorePopoverFocus.current = false;
    setPopoverOpen(false);
    if (clearQuery) {
      setQuery('');
      setSearchOpen(false);
    }
  });

  useEffect(() => {
    dismissPopover(false);
  }, [active, collapsed, dismissPopover]);

  useEffect(() => {
    dismissPopover(true);
  }, [selectionKey, dismissPopover]);

  return {
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    popoverOpen: active && collapsed && popoverOpen,
    onPopoverOpenChange,
    restorePopoverFocus,
  };
}
