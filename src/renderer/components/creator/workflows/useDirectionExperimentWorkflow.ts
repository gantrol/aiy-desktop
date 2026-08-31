import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AssistantRunDto,
  CanvasPresetDto,
  DirectionExperimentDelegationInput,
  DirectionProposalDto,
  GenerationTargetInput,
  Locale,
  StyleExplorationSlotDto,
} from '@/shared/contracts';
import { buildDirectionExperimentDialogModel } from '@/renderer/components/creator/directionExperimentDialogModel';
import { buildStyleExplorationStartInput } from '@/renderer/components/creator/styleExploration';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  canvasPresets: readonly CanvasPresetDto[];
  currentAssistantContextKey: string;
  currentCanvasPreset: CanvasPresetDto | null;
  currentGenerationTargets: readonly GenerationTargetInput[];
  currentReferenceCount: number;
  locale: Locale;
  notify(message: string): void;
  onAssistantError(message: string): void;
  onAssistantRun(run: AssistantRunDto): void;
  onAssistantRunAdopted(run: AssistantRunDto): void;
  refresh(): Promise<void>;
  requestIdentity: string;
}

interface PendingExperiment {
  assistantRun: AssistantRunDto;
  directions: DirectionProposalDto[];
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function addPendingId(pending: Set<string>, setPending: Dispatch<SetStateAction<string[]>>, id: string) {
  if (pending.has(id)) return false;
  pending.add(id);
  setPending((current) => [...current, id]);
  return true;
}

function removePendingId(pending: Set<string>, setPending: Dispatch<SetStateAction<string[]>>, id: string) {
  pending.delete(id);
  setPending((current) => current.filter((candidate) => candidate !== id));
}

export function useDirectionExperimentWorkflow(options: Options) {
  const [pendingExperiment, setPendingExperiment] = useState<PendingExperiment | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [stoppingBatchIds, setStoppingBatchIds] = useState<string[]>([]);
  const [retryingSlotIds, setRetryingSlotIds] = useState<string[]>([]);
  const [proposingAdjacentSlotIds, setProposingAdjacentSlotIds] = useState<string[]>([]);
  const mountedRef = useRef(true);
  const workflowRevisionRef = useRef(0);
  const startingRef = useRef(false);
  const stoppingBatchIdsRef = useRef(new Set<string>());
  const retryingSlotIdsRef = useRef(new Set<string>());
  const proposingAdjacentSlotIdsRef = useRef(new Set<string>());
  const getAssistantContextKey = useStableCallback(() => options.currentAssistantContextKey);
  const getRequestIdentity = useStableCallback(() => options.requestIdentity);
  const notify = useStableCallback(options.notify);
  const onAssistantError = useStableCallback(options.onAssistantError);
  const onAssistantRun = useStableCallback(options.onAssistantRun);
  const onAssistantRunAdopted = useStableCallback(options.onAssistantRunAdopted);
  const refresh = useStableCallback(options.refresh);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workflowRevisionRef.current += 1;
    };
  }, []);

  const reset = useStableCallback(() => {
    workflowRevisionRef.current += 1;
    startingRef.current = false;
    setStarting(false);
    setError('');
    setPendingExperiment(null);
  });

  const review = useStableCallback((assistantRun: AssistantRunDto, directions: DirectionProposalDto[]) => {
    if (startingRef.current || !directions.length || !assistantRun.proposal) return;
    workflowRevisionRef.current += 1;
    setError('');
    setPendingExperiment({ assistantRun, directions: directions.map((direction) => ({ ...direction })) });
  });

  const changeDialogOpen = useStableCallback((open: boolean) => {
    if (open || startingRef.current) return;
    reset();
  });

  const start = useStableCallback(async (delegation: DirectionExperimentDelegationInput) => {
    const snapshot = pendingExperiment;
    if (startingRef.current || !snapshot?.directions.length) return;
    const { assistantRun, directions } = snapshot;
    const proposal = assistantRun.proposal;
    if (!proposal || assistantRun.status !== 'SUCCEEDED') return;
    if (['EXPIRED', 'CLOSED'].includes(proposal.status)) {
      setError(
        options.locale === 'zh'
          ? '此方向提案已过期或关闭，请重新获取方向。'
          : 'This direction proposal is expired or closed. Request fresh directions.',
      );
      return;
    }
    const assistantContextKey = getAssistantContextKey();
    if (
      !assistantRun.input.sourceExperimentSlotId &&
      assistantRun.contextKey !== assistantContextKey &&
      proposal.adoptedContextKey !== assistantContextKey
    ) {
      setError(
        options.locale === 'zh'
          ? '当前创作输入已变化，请重新获取方向后再启动实验。'
          : 'The current creation input has changed. Request fresh directions before starting the experiment.',
      );
      return;
    }
    const requestIdentity = getRequestIdentity();
    const workflowRevision = ++workflowRevisionRef.current;
    const requestIsCurrent = () =>
      mountedRef.current &&
      workflowRevisionRef.current === workflowRevision &&
      getRequestIdentity() === requestIdentity;
    startingRef.current = true;
    setStarting(true);
    setError('');
    try {
      const batch = await window.desktopApi.styleExplorationStart(
        buildStyleExplorationStartInput({
          assistantRun,
          directions,
          locale: options.locale,
          delegation,
        }),
      );
      await refresh().catch(() => undefined);
      if (!requestIsCurrent()) return;
      onAssistantRunAdopted({
        ...assistantRun,
        proposal: {
          ...proposal,
          status: 'ADOPTED',
          adoptedContextKey: assistantRun.input.sourceExperimentSlotId ? assistantRun.contextKey : assistantContextKey,
          updatedAt: new Date().toISOString(),
        },
      });
      setPendingExperiment(null);
      notify(
        options.locale === 'zh'
          ? `方向实验已委派 · ${batch.totalCount}`
          : `Direction experiment delegated · ${batch.totalCount}`,
      );
    } catch (reason) {
      if (requestIsCurrent()) setError(messageFor(reason));
    } finally {
      if (workflowRevisionRef.current === workflowRevision) {
        startingRef.current = false;
        if (mountedRef.current) setStarting(false);
      }
    }
  });

  const stop = useStableCallback(async (batchId: string) => {
    if (!addPendingId(stoppingBatchIdsRef.current, setStoppingBatchIds, batchId)) return;
    try {
      await window.desktopApi.styleExplorationCancel(batchId);
      await refresh();
    } catch (reason) {
      notify(messageFor(reason));
    } finally {
      if (mountedRef.current) removePendingId(stoppingBatchIdsRef.current, setStoppingBatchIds, batchId);
      else stoppingBatchIdsRef.current.delete(batchId);
    }
  });

  const retrySlot = useStableCallback(async (slotId: string) => {
    if (!addPendingId(retryingSlotIdsRef.current, setRetryingSlotIds, slotId)) return;
    try {
      await window.desktopApi.styleExplorationRetrySlot(slotId);
      await refresh();
    } catch (reason) {
      notify(messageFor(reason));
    } finally {
      if (mountedRef.current) removePendingId(retryingSlotIdsRef.current, setRetryingSlotIds, slotId);
      else retryingSlotIdsRef.current.delete(slotId);
    }
  });

  const proposeAdjacent = useStableCallback(async (slot: StyleExplorationSlotDto) => {
    if (!addPendingId(proposingAdjacentSlotIdsRef.current, setProposingAdjacentSlotIds, slot.id)) return;
    const requestIdentity = getRequestIdentity();
    const workflowRevision = workflowRevisionRef.current;
    const requestIsCurrent = () =>
      mountedRef.current &&
      workflowRevisionRef.current === workflowRevision &&
      getRequestIdentity() === requestIdentity;
    try {
      const run = await window.desktopApi.styleExplorationProposeAdjacent(slot.id);
      await refresh().catch(() => undefined);
      if (!requestIsCurrent()) return;
      onAssistantRun(run);
      const directions = run.proposal?.result.directions ?? [];
      if (run.status === 'SUCCEEDED' && directions.length) {
        review(run, directions);
      } else {
        const message =
          run.errorMessage ||
          (options.locale === 'zh' ? '相邻方向提案未完成' : 'Adjacent direction proposal did not complete');
        onAssistantError(message);
        notify(message);
      }
    } catch (reason) {
      if (!requestIsCurrent()) return;
      const message = messageFor(reason);
      onAssistantError(message);
      notify(message);
    } finally {
      if (mountedRef.current) {
        removePendingId(proposingAdjacentSlotIdsRef.current, setProposingAdjacentSlotIds, slot.id);
      } else {
        proposingAdjacentSlotIdsRef.current.delete(slot.id);
      }
    }
  });

  const dialog = useMemo(() => {
    const assistantRun = pendingExperiment?.assistantRun ?? null;
    const directions = pendingExperiment?.directions ?? [];
    return buildDirectionExperimentDialogModel({
      assistantRun,
      canvasPresets: options.canvasPresets,
      currentCanvasPreset: options.currentCanvasPreset,
      currentGenerationTargets: options.currentGenerationTargets,
      currentReferenceCount: options.currentReferenceCount,
      directions,
      locale: options.locale,
    });
  }, [
    options.canvasPresets,
    options.currentCanvasPreset,
    options.currentGenerationTargets,
    options.currentReferenceCount,
    options.locale,
    pendingExperiment,
  ]);

  return {
    changeDialogOpen,
    dialog,
    error,
    proposeAdjacent,
    proposingAdjacentSlotIds,
    reset,
    retrySlot,
    retryingSlotIds,
    review,
    start,
    starting,
    stop,
    stoppingBatchIds,
  };
}
