import { useCallback, useEffect, useRef, useState } from 'react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface HistorySource<T> {
  page(cursor: string | null): Promise<{ items: T[]; nextCursor: string | null }>;
  key(item: T): string;
  compare(left: T, right: T): number;
  live(item: T): boolean;
}

/** A hidden consumer invalidates its request and cannot enqueue another page. */
export function useActivityHistory<T>(
  active: boolean,
  source: HistorySource<T>,
  notify: (message: string) => void,
  all = false,
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const lifetime = useRef(0);
  const enabled = useRef(false);
  const busy = useRef(false);
  const initialized = useRef(false);
  const lastError = useRef('');
  const report = useStableCallback(notify);
  const request = useCallback(
    async (nextCursor: string | null) => {
      if (!enabled.current || busy.current) return;
      busy.current = true;
      const generation = lifetime.current;
      setLoading(true);
      setFailed(false);
      try {
        const page = await source.page(nextCursor);
        if (generation !== lifetime.current) return;
        const ids = new Set(page.items.map(source.key));
        setItems((previous) =>
          [...page.items, ...previous.filter((item) => !ids.has(source.key(item)))].sort(source.compare),
        );
        if (nextCursor !== null || !initialized.current) setCursor(page.nextCursor);
        initialized.current = true;
        setLoaded(true);
        lastError.current = '';
      } catch (reason) {
        if (generation !== lifetime.current) return;
        setFailed(true);
        const message = reason instanceof Error ? reason.message : String(reason);
        if (lastError.current !== message) {
          lastError.current = message;
          report(message);
        }
      } finally {
        if (generation === lifetime.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [source, report],
  );
  useEffect(() => {
    const generation = lifetime.current;
    enabled.current = active;
    setLoading(false);
    if (active) void request(null);
    return () => {
      enabled.current = false;
      lifetime.current = generation + 1;
      busy.current = false;
    };
  }, [active, request]);
  const hasLive = items.some(source.live);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void request(null), hasLive ? 2_500 : 30_000);
    return () => window.clearInterval(timer);
  }, [active, hasLive, request]);
  const loadMore = useCallback(() => (cursor ? request(cursor) : Promise.resolve()), [cursor, request]);
  useEffect(() => {
    if (active && all && loaded && cursor && !loading && !failed) void loadMore();
  }, [active, all, loaded, cursor, loading, failed, loadMore]);
  return { items, loaded, loading, failed, hasMore: cursor !== null, loadMore, reload: () => request(null) };
}
