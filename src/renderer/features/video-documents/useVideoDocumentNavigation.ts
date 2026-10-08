import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  VideoDocumentNavigationEntry,
  VideoDocumentNavigationReorderInput,
} from '@/shared/contracts/video-document';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface NavigationPageState {
  items: VideoDocumentNavigationEntry[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
}

const emptyPage: NavigationPageState = {
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  loaded: false,
};

interface Options {
  active: boolean;
  refreshKey?: number;
  notify(message: string): void;
}

function mergeEntries(current: VideoDocumentNavigationEntry[], incoming: VideoDocumentNavigationEntry[]) {
  const next = [...current];
  const indexById = new Map(next.map((entry, index) => [entry.nodeId, index]));
  for (const entry of incoming) {
    const index = indexById.get(entry.nodeId);
    if (index === undefined) {
      indexById.set(entry.nodeId, next.length);
      next.push(entry);
    } else {
      next[index] = entry;
    }
  }
  return next;
}

export function useVideoDocumentNavigation({ active, refreshKey = 0, notify }: Options) {
  const [root, setRoot] = useState<NavigationPageState>(emptyPage);
  const [children, setChildren] = useState<Record<string, NavigationPageState>>({});
  const [revision, setRevision] = useState(0);
  const requestGeneration = useRef(0);
  const loadedScope = useRef<{ refreshKey: number; revision: number } | null>(null);
  const reportError = useStableCallback(notify);
  const activeRef = useRef(active);
  const rootRef = useRef(root);
  const childrenRef = useRef(children);
  activeRef.current = active;

  const load = useCallback(
    async (parentAlbumId: string | null, append: boolean) => {
      if (!activeRef.current) return;
      const current = parentAlbumId ? (childrenRef.current[parentAlbumId] ?? emptyPage) : rootRef.current;
      if (current.loading || current.loadingMore || (append && !current.nextCursor)) return;
      const request = requestGeneration.current;
      const update = (producer: (page: NavigationPageState) => NavigationPageState) => {
        if (parentAlbumId) {
          const all = childrenRef.current;
          const next = { ...all, [parentAlbumId]: producer(all[parentAlbumId] ?? emptyPage) };
          childrenRef.current = next;
          setChildren(next);
        } else {
          const next = producer(rootRef.current);
          rootRef.current = next;
          setRoot(next);
        }
      };
      update((page) => ({ ...page, loading: !append, loadingMore: append }));
      try {
        const page = await window.desktopApi.videoDocumentNavigationList({
          parentAlbumId,
          cursor: append ? current.nextCursor : null,
          limit: 50,
        });
        if (request !== requestGeneration.current) return;
        update((state) => ({
          items: append ? mergeEntries(state.items, page.items) : page.items,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          loaded: true,
        }));
      } catch (reason) {
        if (request !== requestGeneration.current) return;
        loadedScope.current = null;
        update((page) => ({ ...page, loaded: true, loading: false, loadingMore: false }));
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [reportError],
  );

  useEffect(() => {
    if (!active) return;
    requestGeneration.current += 1;
    if (loadedScope.current?.refreshKey !== refreshKey || loadedScope.current.revision !== revision) {
      loadedScope.current = { refreshKey, revision };
      rootRef.current = { ...emptyPage, items: rootRef.current.items };
      childrenRef.current = {};
      setRoot(rootRef.current);
      setChildren(childrenRef.current);
    }
    if (!rootRef.current.loaded) void load(null, false);
    return () => {
      requestGeneration.current += 1;
      if (rootRef.current.loading || rootRef.current.loadingMore) {
        rootRef.current = { ...rootRef.current, loading: false, loadingMore: false };
        setRoot(rootRef.current);
      }
      if (Object.values(childrenRef.current).some((page) => page.loading || page.loadingMore)) {
        childrenRef.current = Object.fromEntries(
          Object.entries(childrenRef.current).map(([id, page]) => [
            id,
            { ...page, loading: false, loadingMore: false },
          ]),
        );
        setChildren(childrenRef.current);
      }
    };
  }, [active, load, refreshKey, revision]);

  const ensureChildren = useCallback(
    (albumId: string) => {
      if (childrenRef.current[albumId]?.loaded || childrenRef.current[albumId]?.loading) return;
      void load(albumId, false);
    },
    [load],
  );

  const reorder = useCallback(
    async (input: VideoDocumentNavigationReorderInput) => {
      const request = requestGeneration.current;
      await window.desktopApi.videoDocumentNavigationReorder(input);
      if (!activeRef.current || request !== requestGeneration.current) return;
      if (input.parentAlbumId) {
        childrenRef.current = { ...childrenRef.current, [input.parentAlbumId]: emptyPage };
        setChildren(childrenRef.current);
        await load(input.parentAlbumId, false);
      } else {
        rootRef.current = emptyPage;
        setRoot(emptyPage);
        await load(null, false);
      }
    },
    [load],
  );

  const loadRootMore = useCallback(() => load(null, true), [load]);
  const loadChildrenMore = useCallback((albumId: string) => load(albumId, true), [load]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  return {
    root,
    children,
    ensureChildren,
    loadRootMore,
    loadChildrenMore,
    reorder,
    refresh,
  };
}
