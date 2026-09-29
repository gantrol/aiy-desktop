import { useEffect, useRef, useState } from 'react';
import type { KeywordResult } from '@/shared/contracts/me';

export function useKeywords(spaceId: string, dataRevision: number, term: string) {
  const [page, setPage] = useState({ term, offset: 0, dataRevision });
  const [refresh, setRefresh] = useState(0);
  const offset = page.term === term && page.dataRevision === dataRevision ? page.offset : 0;
  const scopeKey = JSON.stringify([spaceId, dataRevision, refresh]);
  const key = JSON.stringify([scopeKey, term, offset]);
  const [data, setData] = useState<{ key: string; scopeKey: string; value: KeywordResult } | null>(null);
  const retried = useRef(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let retry = refresh !== retried.current;
    const run = async () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(() => void run(), 500);
        return;
      }
      try {
        const value = await window.desktopApi.me.keywords({ spaceId, term, offset, retry });
        retry = false;
        if (cancelled) return;
        retried.current = refresh;
        setError(null);
        setData({ key, scopeKey, value });
        if (value.coverage.pending) timer = setTimeout(() => void run(), 100);
      } catch {
        if (!cancelled) setError(key);
      }
    };
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spaceId, key, scopeKey, term, offset, refresh]);
  return {
    result: data?.key === key ? data.value : null,
    overview: data?.scopeKey === scopeKey ? data.value : null,
    failed: error === key,
    offset,
    refresh: () => {
      setPage({ term, offset: 0, dataRevision });
      setRefresh((value) => value + 1);
    },
    next: () => {
      if (data?.value.nextOffset != null) setPage({ term, offset: data.value.nextOffset, dataRevision });
    },
    previous: () => setPage({ term, offset: Math.max(0, offset - 20), dataRevision }),
  };
}
