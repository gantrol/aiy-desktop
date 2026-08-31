import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BackgroundIssueDto } from '@/shared/contracts/background-issue';
import { backgroundIssueIdentityKey } from '@/shared/contracts/background-issue';
import {
  loadLegacyDismissedGenerationRunIds,
  removeLegacyDismissedGenerationRunIds,
} from '@/renderer/components/generation/dismissedGenerationErrors';

interface BackgroundIssueContextValue {
  isAcknowledged(issue: BackgroundIssueDto | null | undefined): boolean;
  isPending(issue: BackgroundIssueDto | null | undefined): boolean;
  acknowledge(issue: BackgroundIssueDto | null | undefined): Promise<void>;
}

interface Props {
  children: ReactNode;
  spaceId: string | null;
  refresh(): Promise<unknown>;
  notify(message: string): void;
}

const BackgroundIssueContext = createContext<BackgroundIssueContextValue | null>(null);

function scopedIssueKey(spaceId: string | null, issue: BackgroundIssueDto) {
  return JSON.stringify([spaceId, backgroundIssueIdentityKey(issue)]);
}

export function BackgroundIssueProvider({ children, spaceId, refresh, notify }: Props) {
  const [optimisticKeys, setOptimisticKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [legacyRunIds, setLegacyRunIds] = useState<ReadonlySet<string>>(loadLegacyDismissedGenerationRunIds);
  const pendingKeysRef = useRef(new Set<string>());
  const attemptedMigrationSpacesRef = useRef(new Set<string>());

  const isAcknowledged = useCallback(
    (issue: BackgroundIssueDto | null | undefined) =>
      Boolean(
        issue &&
        (issue.acknowledgedAt ||
          optimisticKeys.has(scopedIssueKey(spaceId, issue)) ||
          (issue.kind === 'GENERATION_RUN' && legacyRunIds.has(issue.subjectId))),
      ),
    [legacyRunIds, optimisticKeys, spaceId],
  );

  const isPending = useCallback(
    (issue: BackgroundIssueDto | null | undefined) => Boolean(issue && pendingKeys.has(scopedIssueKey(spaceId, issue))),
    [pendingKeys, spaceId],
  );

  const acknowledge = useCallback(
    async (issue: BackgroundIssueDto | null | undefined) => {
      if (!issue || issue.acknowledgedAt || !spaceId) return;
      const key = scopedIssueKey(spaceId, issue);
      if (pendingKeysRef.current.has(key)) return;
      pendingKeysRef.current.add(key);
      setPendingKeys(new Set(pendingKeysRef.current));
      setOptimisticKeys((current) => new Set(current).add(key));
      try {
        const result = await window.desktopApi.backgroundIssueAcknowledge({
          kind: issue.kind,
          subjectId: issue.subjectId,
          occurrenceId: issue.occurrenceId,
        });
        if (result.status === 'CONFLICT' || result.status === 'NOT_ACTIONABLE') {
          setOptimisticKeys((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }
        await refresh();
      } catch (reason) {
        setOptimisticKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        notify(reason instanceof Error ? reason.message : String(reason));
      } finally {
        pendingKeysRef.current.delete(key);
        setPendingKeys(new Set(pendingKeysRef.current));
      }
    },
    [notify, refresh, spaceId],
  );

  useEffect(() => {
    if (!spaceId || attemptedMigrationSpacesRef.current.has(spaceId)) return undefined;
    const runIds = [...legacyRunIds].slice(0, 200);
    if (!runIds.length) return undefined;
    attemptedMigrationSpacesRef.current.add(spaceId);
    let disposed = false;
    void window.desktopApi
      .backgroundIssueImportLegacyGenerationDismissals({ runIds })
      .then(async (result) => {
        removeLegacyDismissedGenerationRunIds(result.importedRunIds);
        if (!disposed && result.importedRunIds.length) {
          const refreshed = await refresh();
          if (refreshed !== false) {
            setLegacyRunIds((current) => {
              const next = new Set(current);
              result.importedRunIds.forEach((runId) => next.delete(runId));
              return next;
            });
          }
        }
      })
      .catch((reason) => {
        if (!disposed) notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [legacyRunIds, notify, refresh, spaceId]);

  const value = useMemo(() => ({ acknowledge, isAcknowledged, isPending }), [acknowledge, isAcknowledged, isPending]);
  return <BackgroundIssueContext.Provider value={value}>{children}</BackgroundIssueContext.Provider>;
}

export function useBackgroundIssues() {
  const context = useContext(BackgroundIssueContext);
  if (!context) throw new Error('Background issue workflow is unavailable');
  return context;
}
