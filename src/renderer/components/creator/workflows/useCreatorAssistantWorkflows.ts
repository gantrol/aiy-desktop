import { useMemo, useState, type MutableRefObject } from 'react';
import type {
  AssistantRunDto,
  AssetDto,
  BootstrapDto,
  CreationDictionaryScopeDto,
  CreatorAgentScope,
  GenerationTargetInput,
  Locale,
  PromptSeriesDto,
  WordPaletteDto,
} from '@/shared/contracts';
import type { AssistantPromptAdoptionSource } from '@/renderer/components/creator/assistantPromptAdoption';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useAssistantPromptAdoption } from '@/renderer/components/creator/workflows/useAssistantPromptAdoption';
import { useAssistantProposalSynchronization } from '@/renderer/components/creator/workflows/useAssistantProposalSynchronization';
import { useCreatorAssistantRequest } from '@/renderer/components/creator/workflows/useCreatorAssistantRequest';
import { useDirectionExperimentWorkflow } from '@/renderer/components/creator/workflows/useDirectionExperimentWorkflow';
import { useHistoricalTermRecommendations } from '@/renderer/components/creator/workflows/useHistoricalTermRecommendations';
import { useKnowledgeDistillationWorkflow } from '@/renderer/components/creator/workflows/useKnowledgeDistillationWorkflow';
import { assistantRunHistory } from '@/renderer/components/creator/assistantRunHistory';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  active: boolean;
  appliedPaletteCacheRef: MutableRefObject<Map<string, AppliedWordPalette>>;
  appliedPalettes: readonly AppliedWordPalette[];
  assistantContextKey: string;
  assistantScope: CreatorAgentScope | null;
  awaitPendingDraftSave(): Promise<unknown>;
  canvasPreset: BootstrapDto['canvasPresets'][number] | null;
  capturePrompt(): CreationDraftPromptSnapshot;
  configurationRequiredMessage: string;
  creationMode: 'existing' | 'new';
  currentDraftId: string | null;
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  dictionaryPackReleaseIds: readonly string[];
  dictionaryOpen: boolean;
  dictionaryScope: CreationDictionaryScopeDto;
  effectiveTermIds: readonly string[];
  ensureScope(): Promise<CreatorAgentScope>;
  generationTargets: readonly GenerationTargetInput[];
  initialRun: AssistantRunDto | null;
  inputSessionRevision: number;
  invalidateDraftAutosaves(): void;
  locale: Locale;
  manualPrompt: string;
  newTitle: string;
  notify(message: string): void;
  onDirectionsCreated(creationId: string): void;
  onPaletteAccepted(palette: WordPaletteDto): void;
  promptFullWindow: boolean;
  promptNodes: CreationDraftPromptSnapshot['nodes'];
  promptProfileId: string;
  promptResolution: ReturnType<(typeof import('@/renderer/components/creator/utils'))['resolveCreatorPrompt']>;
  quality: GenerationTargetInput['quality'];
  referenceAssets: readonly AssetDto[];
  refresh(): Promise<void>;
  repeatCount: number;
  selectedModelKeys: readonly string[];
  selectedTerms: CreationDraftPromptSnapshot['selectedTerms'];
  sessionHostSeries: PromptSeriesDto | null;
  setGenerationTargets(targets: GenerationTargetInput[]): void;
  synchronizePrompt(prompt: CreationDraftPromptSnapshot): void;
  successMessage: string;
  targetAlbumId: string | null;
  termPromptLocale: Locale;
  workbenchIdentity: string;
  versionHydrated: boolean;
}

export function useCreatorAssistantWorkflows(options: Options) {
  const [run, setRun] = useState<AssistantRunDto | null>(options.initialRun);
  const allRuns = useMemo(
    () => (run ? [run, ...options.data.assistantRuns] : options.data.assistantRuns),
    [options.data.assistantRuns, run],
  );
  const history = useMemo(
    () =>
      options.assistantScope
        ? assistantRunHistory({
            runs: allRuns,
            scope: options.assistantScope,
            currentContextKey: options.assistantContextKey,
          })
        : [],
    [allRuns, options.assistantContextKey, options.assistantScope],
  );
  const requestIdentity = `${options.inputSessionRevision}:${options.assistantContextKey}`;
  const request = useCreatorAssistantRequest({
    allRuns,
    appliedPalettes: options.appliedPalettes,
    assistantContextKey: options.assistantContextKey,
    assistantScope: options.assistantScope,
    canvasHeight: options.canvasPreset?.height ?? null,
    canvasPresetKey: options.canvasPreset?.stableKey ?? null,
    canvasWidth: options.canvasPreset?.width ?? null,
    configurationRequiredMessage: options.configurationRequiredMessage,
    dictionaryPackReleaseIds: options.dictionaryPackReleaseIds,
    dictionaryScope: options.dictionaryScope,
    ensureScope: options.ensureScope,
    generationTargets: options.generationTargets,
    initialRun: options.initialRun,
    locale: options.locale,
    manualPrompt: options.manualPrompt,
    notify: options.notify,
    onDirectionsCreated(created) {
      if (created.creationId) options.onDirectionsCreated(created.creationId);
    },
    onDismissed(runId) {
      setRun((current) => (current?.id === runId ? null : current));
    },
    onRun: setRun,
    promptNodes: options.promptNodes,
    promptProfileId: options.promptProfileId,
    promptResolution: options.promptResolution,
    referenceAssets: options.referenceAssets,
    refresh: options.refresh,
    requestIdentity,
    selectedTerms: options.selectedTerms,
    termPromptLocale: options.termPromptLocale,
    terms: options.data.terms,
  });
  const proposalSyncReady = Boolean(
    options.active &&
    options.data.modelWorker.state === 'CONNECTED' &&
    options.data.imageGenerationRoutes.length > 0 &&
    options.generationTargets.length > 0 &&
    options.generationTargets.every((target) =>
      options.data.imageGenerationRoutes.some((model) => model.key === target.modelKey),
    ) &&
    options.versionHydrated,
  );
  useAssistantProposalSynchronization({
    currentContextKey: options.assistantContextKey,
    enabled: proposalSyncReady,
    onRunsUpdated(updatedRuns) {
      setRun((current) => updatedRuns.find((updated) => updated.id === current?.id) ?? current);
    },
    refresh: options.refresh,
    runs: history,
  });
  const direction = useDirectionExperimentWorkflow({
    canvasPresets: options.data.canvasPresets,
    currentAssistantContextKey: options.assistantContextKey,
    currentCanvasPreset: options.canvasPreset,
    currentGenerationTargets: options.generationTargets,
    currentReferenceCount: options.referenceAssets.length,
    locale: options.locale,
    notify: options.notify,
    onAssistantError: request.reportError,
    onAssistantRun: setRun,
    onAssistantRunAdopted(adopted) {
      setRun((current) => (current?.id === adopted.id ? adopted : current));
    },
    refresh: options.refresh,
    requestIdentity,
  });
  const distillation = useKnowledgeDistillationWorkflow({
    locale: options.locale,
    notify: options.notify,
    onPaletteAccepted: options.onPaletteAccepted,
    refresh: options.refresh,
    requestIdentity: `${options.inputSessionRevision}:${options.workbenchIdentity}`,
  });
  const historicalTerms = useHistoricalTermRecommendations({
    candidateTermIds: options.data.terms.map((term) => term.id),
    dictionaryPackReleaseIds: options.dictionaryPackReleaseIds,
    dictionaryScope: options.dictionaryScope,
    enabled: options.active && (options.dictionaryOpen || options.promptFullWindow),
    locale: options.locale,
    notify: options.notify,
    prompt: options.manualPrompt,
    scope: options.assistantScope,
    selectedTermIds: options.effectiveTermIds,
  });

  const captureAdoptionSource = useStableCallback((): AssistantPromptAdoptionSource => {
    const currentPrompt = options.capturePrompt();
    const availablePalettes = new Map(options.appliedPaletteCacheRef.current);
    for (const reference of currentPrompt.appliedPalettes) availablePalettes.set(reference.palette.id, reference);
    const persistence =
      options.assistantScope?.kind === 'DRAFT' &&
      options.creationMode === 'new' &&
      options.currentDraftId === options.assistantScope.id
        ? {
            kind: 'DRAFT' as const,
            id: options.assistantScope.id,
            targetAlbumId: options.targetAlbumId,
            title: options.newTitle,
            dictionaryScope: options.dictionaryScope,
            quality: options.quality,
            selectedModelKeys: [...options.selectedModelKeys],
            repeatCount: options.repeatCount,
          }
        : options.assistantScope?.kind === 'SERIES' &&
            options.creationMode === 'existing' &&
            options.sessionHostSeries?.id === options.assistantScope.id
          ? {
              kind: 'SERIES' as const,
              id: options.assistantScope.id,
              title: options.sessionHostSeries.title,
              titleLocale: options.locale,
            }
          : null;
    return {
      availablePalettes: [...availablePalettes.values()],
      availableTerms: options.data.terms,
      canvasPresetKey: options.canvasPreset?.stableKey ?? null,
      canvasWidth: options.canvasPreset?.width ?? null,
      canvasHeight: options.canvasPreset?.height ?? null,
      currentPrompt,
      defaultPromptLocale: options.defaultPromptLocale,
      generationTargets: options.generationTargets.map((target) => ({ ...target })),
      persistence,
      promptProfileId: options.promptProfileId,
      referenceAssets: [...options.referenceAssets],
      termPromptLocale: options.termPromptLocale,
    };
  });
  const adoption = useAssistantPromptAdoption({
    captureSource: captureAdoptionSource,
    locale: options.locale,
    notify: options.notify,
    onApplyPrompt: options.synchronizePrompt,
    onRunAdopted(adopted) {
      setRun((current) => (current?.id === adopted.id ? adopted : current));
    },
    async preparePersistence(persistence) {
      if (persistence.kind !== 'DRAFT') return;
      options.invalidateDraftAutosaves();
      await options.awaitPendingDraftSave();
    },
    refresh: options.refresh,
    successMessage: options.successMessage,
  });

  const reset = useStableCallback(() => {
    setRun(null);
    request.reset();
    direction.reset();
    distillation.reset();
  });
  const restoreScope = useStableCallback((scope: CreatorAgentScope | null) => {
    if (!scope) return;
    const candidates = allRuns
      .filter(
        (candidate, index, runs) =>
          candidate.scope.kind === scope.kind &&
          candidate.scope.id === scope.id &&
          !candidate.dismissedAt &&
          candidate.proposal?.status !== 'CLOSED' &&
          runs.findIndex((item) => item.id === candidate.id) === index,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const latest = candidates[0] ?? null;
    setRun(latest);
    request.restore(latest);
    const contextTargetRun = candidates.find(
      (candidate) =>
        candidate.proposal &&
        ['READY', 'ADOPTED'].includes(candidate.proposal.status) &&
        candidate.input.generationTargets.length > 0,
    );
    if (contextTargetRun) {
      options.setGenerationTargets(contextTargetRun.input.generationTargets.map((target) => ({ ...target })));
    }
  });

  return { adoption, direction, distillation, historicalTerms, history, request, reset, restoreScope };
}
