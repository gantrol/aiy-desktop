import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';

interface ImageVisibility {
  hiddenIds: ReadonlySet<string>;
  ready: boolean;
  busy: boolean;
  loadFailed: boolean;
  retry(): void;
  setHidden(ids: readonly string[], hidden: boolean): Promise<void>;
}

const ImageVisibilityContext = createContext<ImageVisibility | null>(null);

export function ImageVisibilityProvider({ children, notify }: { children: ReactNode; notify(message: string): void }) {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const retry = useCallback(() => setRetryVersion((current) => current + 1), []);
  const pending = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const copy = useI18n().messages.assetFile;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (pending.current) return;
      const requestedRevision = ++revision.current;
      setLoadFailed(false);
      void window.desktopApi.imageVisibility
        .list()
        .then((ids) => {
          if (!active || requestedRevision !== revision.current) return;
          setHiddenIds(new Set(ids));
          setReady(true);
        })
        .catch(() => {
          if (!active || requestedRevision !== revision.current) return;
          setLoadFailed(true);
          notify(copy.visibilityFailed);
        });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [copy.visibilityFailed, notify, retryVersion]);

  const setHidden = useCallback(
    async (ids: readonly string[], hidden: boolean) => {
      if (pending.current || !ready || !ids.length) return;
      pending.current = true;
      setBusy(true);
      ++revision.current;
      try {
        const uniqueIds = [...new Set(ids)];
        // Each committed chunk updates the screen, including when a later chunk fails.
        for (let offset = 0; offset < uniqueIds.length; offset += 500) {
          if (!mounted.current) return;
          const assetIds = uniqueIds.slice(offset, offset + 500);
          await window.desktopApi.imageVisibility.set({ assetIds, hidden });
          if (!mounted.current) return;
          ++revision.current;
          setHiddenIds((current) => {
            const next = new Set(current);
            for (const id of assetIds) {
              if (hidden) next.add(id);
              else next.delete(id);
            }
            return next;
          });
        }
      } catch {
        if (mounted.current) notify(copy.visibilityFailed);
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [ready, notify, copy.visibilityFailed],
  );

  const value = useMemo(
    () => ({ hiddenIds, ready, busy, setHidden, loadFailed, retry }),
    [hiddenIds, ready, busy, setHidden, loadFailed, retry],
  );
  return <ImageVisibilityContext.Provider value={value}>{children}</ImageVisibilityContext.Provider>;
}

export function useImageVisibility() {
  return useContext(ImageVisibilityContext);
}

export function imageAssetIdFromUrl(src?: string): string | null {
  if (!src?.startsWith('aiy-media://')) return null;
  try {
    const url = new URL(src);
    return ['asset', 'asset-thumbnail'].includes(url.hostname) ? decodeURIComponent(url.pathname.slice(1)) : null;
  } catch {
    return null;
  }
}

export function useImageHidden(assetId: string | null) {
  const visibility = useImageVisibility();
  return Boolean(assetId && visibility && (!visibility.ready || visibility.hiddenIds.has(assetId)));
}
