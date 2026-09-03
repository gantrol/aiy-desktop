import type { Dispatch, SetStateAction } from 'react';
import type { BootstrapDto, Locale, WordPaletteDto } from '@/shared/contracts';
import { navigationLocationKey, type CreatorLocation } from '@/renderer/components/app/app-navigation';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import type { useCreatorDraftInputSession } from '@/renderer/components/creator/screen/useCreatorDraftInputSession';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import type { useCreatorScreenProjection } from '@/renderer/components/creator/screen/useCreatorScreenProjection';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import { useCreatorAssistantWorkflows } from '@/renderer/components/creator/workflows/useCreatorAssistantWorkflows';

type DraftInputSession = ReturnType<typeof useCreatorDraftInputSession>;
type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type ScreenProjection = ReturnType<typeof useCreatorScreenProjection>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;
type WorkbenchProjection = ReturnType<typeof useCreatorWorkbenchProjection>;

interface Options {
  active: boolean;
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  draftInput: DraftInputSession;
  generation: GenerationInputSession;
  locale: Locale;
  notify(message: string): void;
  projection: ScreenProjection;
  promptFullWindow: boolean;
  refresh(): Promise<void>;
  selection: SelectionSession;
  setDistilledPalette(palette: WordPaletteDto | null): void;
  setOutputMode: Dispatch<SetStateAction<CreationOutputMode>>;
  successMessage: string;
  configurationRequiredMessage: string;
  workbench: WorkbenchProjection;
}

export function useCreatorAssistantRuntime({
  active,
  configurationRequiredMessage,
  data,
  defaultPromptLocale,
  draftInput,
  generation,
  locale,
  notify,
  projection,
  promptFullWindow,
  refresh,
  selection,
  setDistilledPalette,
  setOutputMode,
  successMessage,
  workbench,
}: Options) {
  const document = generation.promptDocument;
  const draftSession = selection.creationDraftSession;
  const navigation = draftInput.navigation;
  const workflows = useCreatorAssistantWorkflows({
    active,
    appliedPaletteCacheRef: document.appliedPaletteCacheRef,
    appliedPalettes: document.appliedPalettes,
    assistantContextKey: generation.assistantContextKey,
    assistantScope: workbench.assistantScope,
    awaitPendingDraftSave: draftSession.awaitPendingSave,
    canvasPreset: generation.canvasPreset ?? null,
    capturePrompt: document.capture,
    configurationRequiredMessage,
    creationMode: selection.creationMode,
    data,
    defaultPromptLocale,
    dictionaryPackReleaseIds: generationDictionaryReleaseIds(generation),
    dictionaryOpen: generation.dictionaryMaterials.dictionaryOpen,
    dictionaryScope: generationDictionaryScope(generation),
    effectiveTermIds: generation.promptResolution.effectiveTerms.map((item) => item.term.id),
    ensureScope: draftInput.draftProjection.ensureScope,
    generationTargets: generation.generationTargets,
    getCurrentDraftId: draftSession.getDraftId,
    getSavedDraft: draftSession.getSavedDraft,
    initialRun: selection.initial.initialAssistantRun,
    inputSessionRevision: selection.inputSessionRevision,
    invalidateDraftAutosaves: draftSession.invalidateAutosaves,
    locale,
    manualPrompt: document.manualPrompt,
    newTitle: generation.title,
    notify,
    onDirectionsCreated(creationId) {
      selection.contentSelection.setSelectedIdeaCreationId(creationId);
      setOutputMode('records');
      selection.contentSelection.setSelectedAlbumId(null);
      projection.panes.setOutputCollapsed(false);
      projection.panes.setCompactPanel('output');
      const nextLocation: CreatorLocation = { surface: 'idea-creation', creationId };
      if (navigation.appliedLocationKeyRef.current !== navigationLocationKey(nextLocation)) {
        navigation.commit(nextLocation, 'push');
      }
    },
    onPaletteAccepted(palette) {
      generationRememberPalette(generation, palette);
      setDistilledPalette(palette);
    },
    promptFullWindow,
    promptNodes: document.promptNodes,
    promptProfileId: generation.configuration.promptProfileId,
    promptResolution: generation.promptResolution,
    quality: generation.quality,
    referenceAssets: document.referenceAssets,
    refresh,
    repeatCount: generation.repeatCount,
    rememberSavedDraft: draftSession.rememberSavedDraft,
    selectedModelKeys: generation.configuration.selectedModelKeys,
    selectedTerms: document.selectedTerms,
    sessionHostSeries: workbench.sessionHostSeries ?? null,
    setGenerationTargets: generation.setGenerationTargets,
    successMessage,
    synchronizePrompt: document.synchronize,
    targetAlbumId: selection.targetAlbumId,
    termPromptLocale: document.termPromptLocale,
    versionHydrated:
      selection.creationMode !== 'existing' ||
      generation.hydration.hydratedVersionId === (generation.hydration.version?.id ?? null),
    workbenchIdentity: navigationLocationKey(navigation.workbenchLocation()),
  });
  const assistantHistory = workflows.history;
  const ideaAssistantRuns = projection.activeIdeaCreation
    ? data.assistantRuns.filter((run) => run.creationId === projection.activeIdeaCreation?.id)
    : assistantHistory.filter((run) => run.mode === 'directions');
  const recordAssistantRuns = [
    ...new Map([...assistantHistory, ...ideaAssistantRuns].map((run) => [run.id, run])).values(),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));

  return { recordAssistantRuns, workflows };
}

function generationDictionaryReleaseIds(generation: GenerationInputSession) {
  return generation.dictionaryCatalog.dictionaryPackReleaseIds;
}

function generationDictionaryScope(generation: GenerationInputSession) {
  return generation.dictionaryCatalog.dictionaryScope;
}

function generationRememberPalette(generation: GenerationInputSession, palette: WordPaletteDto) {
  generation.dictionaryCatalog.rememberPalette(palette);
}
