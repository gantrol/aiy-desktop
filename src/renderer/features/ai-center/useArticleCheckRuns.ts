import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArticleCheckRunDto } from '@/shared/contracts';

function pageSignature(items: readonly ArticleCheckRunDto[]) {
  return JSON.stringify(items);
}

const LIVE_REFRESH_INTERVAL_MS = 2_500;
const IDLE_REFRESH_INTERVAL_MS = 30_000;

export function useArticleCheckRuns(active: boolean, notify: (message: string) => void) {
  const [items, setItems] = useState<ArticleCheckRunDto[]>([]);
  const requestRevisionRef = useRef(0);
  const loadingRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const headSignatureRef = useRef('');
  const reportFailure = useCallback(
    (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (lastErrorRef.current === message) return;
      lastErrorRef.current = message;
      notify(message);
    },
    [notify],
  );

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const requestRevision = ++requestRevisionRef.current;
    try {
      const next: ArticleCheckRunDto[] = [];
      let cursor: string | null = null;
      do {
        const page = await window.desktopApi.articleCheckRunsList({ cursor, limit: 200 });
        next.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      if (requestRevisionRef.current === requestRevision) {
        lastErrorRef.current = null;
        headSignatureRef.current = pageSignature(next.slice(0, 200));
        setItems(next);
      }
    } catch (reason) {
      if (requestRevisionRef.current === requestRevision) reportFailure(reason);
    } finally {
      loadingRef.current = false;
    }
  }, [reportFailure]);

  const refreshHead = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await window.desktopApi.articleCheckRunsList({ cursor: null, limit: 200 });
      lastErrorRef.current = null;
      const nextSignature = pageSignature(page.items);
      if (headSignatureRef.current === nextSignature) return;
      headSignatureRef.current = nextSignature;
      const headIds = new Set(page.items.map((item) => item.id));
      setItems((current) =>
        [...page.items, ...current.filter((item) => !headIds.has(item.id))].sort(
          (left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id),
        ),
      );
    } catch (reason) {
      reportFailure(reason);
    } finally {
      loadingRef.current = false;
    }
  }, [reportFailure]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    if (!active) return undefined;
    const refreshInterval = items.some((item) => item.status === 'RUNNING')
      ? LIVE_REFRESH_INTERVAL_MS
      : IDLE_REFRESH_INTERVAL_MS;
    const timer = window.setInterval(() => void refreshHead(), refreshInterval);
    return () => window.clearInterval(timer);
  }, [active, items, refreshHead]);

  return { items, reload: load };
}
