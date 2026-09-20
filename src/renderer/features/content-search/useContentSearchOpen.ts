import { useCallback, useEffect, useRef, useState } from 'react';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import type { ContentSource } from '@/shared/contracts/content-source';

export function useContentSearchOpen(
  active: boolean,
  selectionKey: string,
  unavailable: string,
  onOpen: (source: ContentSource) => void,
) {
  const request = useRef(0);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invalidate = useCallback(() => {
    request.current++;
    pending.current = false;
  }, []);
  useEffect(() => {
    setBusy(false);
    setError('');
    return invalidate;
  }, [active, selectionKey, invalidate]);
  const open = async (source: ContentSource) => {
    if (!active || pending.current) return;
    pending.current = true;
    const current = ++request.current;
    setBusy(true);
    setError('');
    try {
      const document = await contentLibraryApi().readCurrent(source);
      if (current === request.current) onOpen(document.source);
    } catch {
      if (current === request.current) setError(unavailable);
    } finally {
      if (current === request.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return { open, busy, error };
}
