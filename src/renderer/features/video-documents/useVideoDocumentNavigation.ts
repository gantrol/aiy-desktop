import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  VideoDocumentNavigationEntry,
  VideoDocumentNavigationReorderInput,
} from '@/shared/contracts/video-document';

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
  const rootRef = useRef(root);
  const childrenRef = useRef(children);
  rootRef.current = root;
  childrenRef.current = children;

  const load = useCallback(
    async (parentAlbumId: string | null, append: boolean) => {
      const current = parentAlbumId ? (childrenRef.current[parentAlbumId] ?? emptyPage) : rootRef.current;
      if (current.loading || current.loadingMore || (append && !current.nextCursor)) return;
      const request = requestGeneration.current;
      const update = (producer: (page: NavigationPageState) => NavigationPageState) => {
        if (parentAlbumId) {
          setChildren((all) => {
            const next = { ...all, [parentAlbumId]: producer(all[parentAlbumId] ?? emptyPage) };
            childrenRef.current = next;
            return next;
          });
        } else {
          setRoot((page) => {
            const next = producer(page);
            rootRef.current = next;
            return next;
          });
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
        update((page) => ({ ...page, loaded: true, loading: false, loadingMore: false }));
        notify(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [notify],
  );

  useEffect(() => {
    if (!active) return;
    requestGeneration.current += 1;
    rootRef.current = emptyPage;
    childrenRef.current = {};
    setRoot(emptyPage);
    setChildren({});
    void load(null, false);
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
      await window.desktopApi.videoDocumentNavigationReorder(input);
      if (input.parentAlbumId) {
        childrenRef.current = { ...childrenRef.current, [input.parentAlbumId]: emptyPage };
        setChildren((all) => ({ ...all, [input.parentAlbumId!]: emptyPage }));
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
