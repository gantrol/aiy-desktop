import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import type { CodexUsageDateRange, CodexUsageInvestigation, CodexUsageRange } from '@/shared/contracts';

interface Options {
  setRange: Dispatch<SetStateAction<CodexUsageRange>>;
  setDateRange: Dispatch<SetStateAction<CodexUsageDateRange | null>>;
  setDisplayTimeZone: Dispatch<SetStateAction<string>>;
  setInvestigation: Dispatch<SetStateAction<CodexUsageInvestigation | null>>;
  setError: Dispatch<SetStateAction<string>>;
  quotaReadFailed: string;
}

export function useCodexUsageInvestigationSelection({
  setRange,
  setDateRange,
  setDisplayTimeZone,
  setInvestigation,
  setError,
  quotaReadFailed,
}: Options) {
  const requestSequence = useRef(0);
  const selectionClaimed = useRef(false);
  const followingCompletion = useRef(false);
  useEffect(
    () => () => {
      requestSequence.current++;
    },
    [],
  );
  const expectCompletedInvestigation = useCallback(() => {
    followingCompletion.current = true;
  }, []);
  const cancelExpectedInvestigation = useCallback(() => {
    followingCompletion.current = false;
  }, []);
  const [loading, setLoading] = useState(false);
  const clearInvestigation = useCallback(() => {
    selectionClaimed.current = true;
    followingCompletion.current = false;
    requestSequence.current += 1;
    setLoading(false);
    setInvestigation(null);
  }, [setInvestigation]);
  const loadInvestigation = useCallback(
    async (investigationId: string, minimumQuotaPercent?: number) => {
      selectionClaimed.current = true;
      followingCompletion.current = false;
      const request = ++requestSequence.current;
      setLoading(true);
      try {
        const value = await window.desktopApi.codexUsageInvestigation({ investigationId, minimumQuotaPercent });
        if (request !== requestSequence.current) return;
        if (minimumQuotaPercent !== undefined && value.quotaPurityIssue === 'READ_FAILED') {
          setError(quotaReadFailed);
          return;
        }
        setInvestigation(value);
        setDisplayTimeZone(value.timeZone);
      } catch (reason) {
        if (request !== requestSequence.current) return;
        throw reason;
      } finally {
        if (request === requestSequence.current) setLoading(false);
      }
    },
    [quotaReadFailed, setDisplayTimeZone, setError, setInvestigation],
  );
  const loadInitialInvestigation = useCallback(
    async (id: string) => {
      if (!selectionClaimed.current) await loadInvestigation(id);
    },
    [loadInvestigation],
  );
  const loadCompletedInvestigation = useCallback(
    async (id: string) => {
      if (followingCompletion.current) await loadInvestigation(id);
      else await loadInitialInvestigation(id);
    },
    [loadInvestigation, loadInitialInvestigation],
  );
  const selectRange = useCallback(
    (nextRange: CodexUsageRange, nextDateRange: CodexUsageDateRange | null) => {
      setRange(nextRange);
      setDateRange(nextDateRange);
      clearInvestigation();
      setError('');
    },
    [clearInvestigation, setDateRange, setError, setRange],
  );
  const selectHistory = useCallback(
    (investigationId: string) => {
      setError('');
      void loadInvestigation(investigationId).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    },
    [loadInvestigation, setError],
  );
  return {
    clearInvestigation,
    loadInvestigation,
    loadInitialInvestigation,
    loadCompletedInvestigation,
    expectCompletedInvestigation,
    cancelExpectedInvestigation,
    selectHistory,
    selectRange,
    loading,
  };
}
