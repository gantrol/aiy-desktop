import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from 'react';
import type {
  CodexUsageDateRange,
  CodexUsageGranularity,
  CodexUsageHistoryItem,
  CodexUsageInvestigation,
  CodexUsageRange,
} from '@/shared/contracts';

interface Options {
  history: CodexUsageHistoryItem[];
  setRange: Dispatch<SetStateAction<CodexUsageRange>>;
  setDateRange: Dispatch<SetStateAction<CodexUsageDateRange | null>>;
  setGranularity: Dispatch<SetStateAction<CodexUsageGranularity>>;
  setDisplayTimeZone: Dispatch<SetStateAction<string>>;
  setInvestigation: Dispatch<SetStateAction<CodexUsageInvestigation | null>>;
  setError: Dispatch<SetStateAction<string>>;
  quotaReadFailed: string;
}

function sameDateRange(left: CodexUsageDateRange | null, right: CodexUsageDateRange | null) {
  return left?.from === right?.from && left?.to === right?.to;
}

export function useCodexUsageInvestigationSelection({
  history,
  setRange,
  setDateRange,
  setGranularity,
  setDisplayTimeZone,
  setInvestigation,
  setError,
  quotaReadFailed,
}: Options) {
  const requestSequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const clearInvestigation = useCallback(() => {
    requestSequence.current += 1;
    setLoading(false);
    setInvestigation(null);
  }, [setInvestigation]);
  const loadInvestigation = useCallback(
    async (investigationId: string, minimumQuotaPercent?: number) => {
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
        setRange(value.range);
        setDateRange(value.dateRange);
        setGranularity(value.granularity);
        setDisplayTimeZone(value.timeZone);
      } catch (reason) {
        if (request !== requestSequence.current) return;
        throw reason;
      } finally {
        if (request === requestSequence.current) setLoading(false);
      }
    },
    [quotaReadFailed, setDateRange, setDisplayTimeZone, setError, setGranularity, setInvestigation, setRange],
  );
  const selectRange = useCallback(
    (nextRange: CodexUsageRange, nextDateRange: CodexUsageDateRange | null) => {
      setRange(nextRange);
      setDateRange(nextDateRange);
      const latest = history.find((item) => item.range === nextRange && sameDateRange(item.dateRange, nextDateRange));
      if (!latest) {
        clearInvestigation();
        setError('');
        return;
      }
      setGranularity(latest.granularity);
      setDisplayTimeZone(latest.timeZone);
      setError('');
      void loadInvestigation(latest.investigationId).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    },
    [
      clearInvestigation,
      history,
      loadInvestigation,
      setDateRange,
      setDisplayTimeZone,
      setError,
      setGranularity,
      setRange,
    ],
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
  return { clearInvestigation, loadInvestigation, selectHistory, selectRange, loading };
}
