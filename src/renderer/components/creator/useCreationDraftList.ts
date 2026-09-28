import { useEffect, useRef, useState } from 'react';
import type { CreationDraftListResult } from '@/shared/contracts/creation-draft-list';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  active: boolean;
  spaceId: string;
  query: string;
  refreshKey: unknown;
  notify(message: string): void;
}

const emptyPage: CreationDraftListResult = { items: [], nextCursor: null };

export function useCreationDraftList({ active, spaceId, query, refreshKey, notify }: Options) {
  const key = JSON.stringify([spaceId, query.trim()]);
  const [state, setState] = useState({ key, page: emptyPage });
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const reportError = useStableCallback(notify);
  const refresh = useStableCallback(() => setRevision((value) => value + 1));
  const page = active && state.key === key ? state.page : emptyPage;
  const remove = useStableCallback((ids: string[]) => {
    const removed = new Set(ids);
    generation.current += 1;
    pending.current = false;
    setState((current) => ({
      ...current,
      page: { ...current.page, items: current.page.items.filter((item) => !removed.has(item.id)) },
    }));
    refresh();
  });

  useEffect(() => {
    if (!active) return;
    return window.desktopApi.onCreationDraftsChanged((event) => {
      if (event.spaceId === spaceId) refresh();
    });
  }, [active, refresh, spaceId]);

  useEffect(() => {
    const request = ++generation.current;
    pending.current = active;
    setLoading(active);
    setFailed(false);
    if (!active) return;
    const timer = window.setTimeout(() => {
      void window.desktopApi
        .creationDraftList({ spaceId, query: query.trim(), cursor: null, limit: 30 })
        .then((result) => {
          if (request === generation.current) setState({ key, page: result });
        })
        .catch((reason) => {
          if (request !== generation.current) return;
          setFailed(true);
          reportError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (request !== generation.current) return;
          pending.current = false;
          setLoading(false);
        });
    }, 100);
    return () => {
      generation.current += 1;
      window.clearTimeout(timer);
    };
  }, [active, key, query, refreshKey, reportError, revision, spaceId]);

  const loadMore = useStableCallback(async () => {
    if (!active || pending.current || !page.nextCursor) return;
    const request = generation.current;
    pending.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const result = await window.desktopApi.creationDraftList({
        spaceId,
        query: query.trim(),
        cursor: page.nextCursor,
        limit: 30,
      });
      if (request !== generation.current) return;
      setState((current) => {
        const ids = new Set(current.page.items.map((item) => item.id));
        return {
          key,
          page: {
            items: [...current.page.items, ...result.items.filter((item) => !ids.has(item.id))],
            nextCursor: result.nextCursor,
          },
        };
      });
    } catch (reason) {
      if (request !== generation.current) return;
      setFailed(true);
      reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === generation.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  });

  return { ...page, loading: active && loading, failed: active && failed, loadMore, refresh, remove };
}
