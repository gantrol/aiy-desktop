import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodexUsageState } from '@/shared/contracts';

export function useCodexUsageHistory(onError: (message: string) => void) {
  const [page, setPage] = useState<Pick<CodexUsageState, 'history' | 'historyCursor'>>({
    history: [],
    historyCursor: null,
  });
  const [loadingHistory, setLoading] = useState(false);
  const sequence = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const setHistoryState = useCallback((state: Pick<CodexUsageState, 'history' | 'historyCursor'>) => {
    sequence.current++;
    pending.current = false;
    setLoading(false);
    setPage({ history: state.history, historyCursor: state.historyCursor });
  }, []);
  const loadMore = useCallback(async () => {
    if (!page.historyCursor || pending.current) return;
    pending.current = true;
    setLoading(true);
    const request = ++sequence.current;
    try {
      const state = await window.desktopApi.codexUsageState({ beforeInvestigationId: page.historyCursor });
      if (request !== sequence.current) return;
      setPage((current) => {
        const ids = new Set(current.history.map((item) => item.investigationId));
        return {
          history: [...current.history, ...state.history.filter((item) => !ids.has(item.investigationId))],
          historyCursor: state.historyCursor,
        };
      });
    } catch (reason) {
      if (request === sequence.current) onError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === sequence.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, [onError, page.historyCursor]);
  return { ...page, loadingHistory, loadMore, setHistoryState };
}
