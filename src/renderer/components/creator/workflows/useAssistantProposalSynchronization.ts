import { useEffect, useMemo } from 'react';
import type { AssistantRunDto } from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  currentContextKey: string;
  enabled: boolean;
  onRunsUpdated(runs: readonly AssistantRunDto[]): void;
  refresh(): Promise<void>;
  runs: readonly AssistantRunDto[];
}

export function useAssistantProposalSynchronization(options: Options) {
  const onRunsUpdated = useStableCallback(options.onRunsUpdated);
  const refresh = useStableCallback(options.refresh);
  const expirableRunIds = useMemo(
    () =>
      options.runs
        .filter(
          (run) =>
            run.proposal &&
            !run.input.sourceExperimentSlotId &&
            ['READY', 'ADOPTED'].includes(run.proposal.status) &&
            run.contextKey !== options.currentContextKey &&
            run.proposal.adoptedContextKey !== options.currentContextKey,
        )
        .map((run) => run.id),
    [options.currentContextKey, options.runs],
  );
  const revalidatableRunIds = useMemo(
    () =>
      options.runs
        .filter((run) => {
          if (!run.proposal || run.input.sourceExperimentSlotId || run.proposal.status !== 'EXPIRED') return false;
          return run.proposal.adoptedContextKey
            ? run.proposal.adoptedContextKey === options.currentContextKey
            : run.contextKey === options.currentContextKey;
        })
        .map((run) => run.id),
    [options.currentContextKey, options.runs],
  );
  const synchronizationKey = JSON.stringify({
    contextKey: options.currentContextKey,
    expirableRunIds,
    revalidatableRunIds,
  });

  useEffect(() => {
    if (!options.enabled || (!expirableRunIds.length && !revalidatableRunIds.length)) return undefined;
    let requestActive = true;
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        ...expirableRunIds.map((runId) => window.desktopApi.assistantProposalExpire(runId, options.currentContextKey)),
        ...revalidatableRunIds.map((runId) =>
          window.desktopApi.assistantProposalRevalidate(runId, options.currentContextKey),
        ),
      ]).then((results) => {
        if (!requestActive) return;
        const updatedRuns = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        onRunsUpdated(updatedRuns);
        if (updatedRuns.length) void refresh().catch(() => undefined);
      });
    }, 150);
    return () => {
      requestActive = false;
      window.clearTimeout(timer);
    };
  }, [
    expirableRunIds,
    onRunsUpdated,
    options.currentContextKey,
    options.enabled,
    refresh,
    revalidatableRunIds,
    synchronizationKey,
  ]);
}
