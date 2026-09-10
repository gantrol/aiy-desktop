import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import type { DerivedVisualWorkspaceViewState } from '@/renderer/components/creator/derivedVisualWorkspace';
import { initialGenerationTargets } from '@/renderer/components/creator/generationTargetDefaults';
import { useCreatorAssistantRuntime } from '@/renderer/components/creator/screen/useCreatorAssistantRuntime';
import type { useCreatorDraftInputSession } from '@/renderer/components/creator/screen/useCreatorDraftInputSession';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import type { useCreatorGenerationRuntime } from '@/renderer/components/creator/screen/useCreatorGenerationRuntime';
import type { useCreatorScreenProjection } from '@/renderer/components/creator/screen/useCreatorScreenProjection';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import { creationDraftSnapshotHasMeaningfulInput } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useCreationDraftAutosave } from '@/renderer/components/creator/workflows/useCreationDraftSession';
import { useCreatorContentWorkflows } from '@/renderer/components/creator/workflows/useCreatorContentWorkflows';
import { useCreatorInspirationSession } from '@/renderer/components/creator/workflows/useCreatorInspirationSession';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type {
  BootstrapDto,
  DerivedVisualWorkspaceOpenResult,
  Locale,
  SocialPostDto,
  WordPaletteDto,
} from '@/shared/contracts';
import { useEffect, type Dispatch, type SetStateAction } from 'react';

type DraftInputSession = ReturnType<typeof useCreatorDraftInputSession>;
type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type GenerationRuntime = ReturnType<typeof useCreatorGenerationRuntime>;
type ScreenProjection = ReturnType<typeof useCreatorScreenProjection>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;
type WorkbenchProjection = ReturnType<typeof useCreatorWorkbenchProjection>;

interface Options {
  active: boolean;
  configurationRequiredMessage: string;
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  draftInput: DraftInputSession;
  generation: GenerationInputSession;
  generationRuntime: GenerationRuntime;
  generationStarting: boolean;
  locale: Locale;
  notify(message: string): void;
  onSocialPostSaved(post: SocialPostDto): void;
  onOpenDerivedVisualWorkspace(result: DerivedVisualWorkspaceOpenResult, view?: DerivedVisualWorkspaceViewState): void;
  onPromptFullWindowChange(open: boolean): void;
  preserveBeforeNavigation(): Promise<boolean>;
  projection: ScreenProjection;
  promptFullWindow: boolean;
  refresh(): Promise<void>;
  restartNewCreation(albumId: string | null): Promise<boolean>;
  selection: SelectionSession;
  setDistilledPalette(palette: WordPaletteDto | null): void;
  setOutputMode: Dispatch<SetStateAction<CreationOutputMode>>;
  setRequestedAssetId(assetId: string | null): void;
  setRenameOpen(open: boolean): void;
  successMessage: string;
  workbench: WorkbenchProjection;
}

export function useCreatorWorkflowRuntime({
  active,
  configurationRequiredMessage,
  data,
  defaultPromptLocale,
  draftInput,
  generation,
  generationRuntime,
  generationStarting,
  locale,
  notify,
  onSocialPostSaved,
  onOpenDerivedVisualWorkspace,
  onPromptFullWindowChange,
  preserveBeforeNavigation,
  projection,
  promptFullWindow,
  refresh,
  restartNewCreation,
  selection,
  setDistilledPalette,
  setOutputMode,
  setRequestedAssetId,
  setRenameOpen,
  successMessage,
  workbench,
}: Options) {
  const document = generation.promptDocument;
  const draftSession = selection.creationDraftSession;
  const navigation = draftInput.navigation;
  const inspiration = useCreatorInspirationSession({
    capturePrompt: document.capture,
    creationItems: data.creationItems,
    creationMode: selection.creationMode,
    currentSeriesId: selection.creationMode === 'existing' ? (workbench.sessionHostSeries?.id ?? null) : null,
    getCreationDraftId: draftSession.getDraftId,
    locale,
    manualPrompt: document.manualPrompt,
    notify,
    onOpenStash(stash) {
      selection.contentSelection.setSelectedInspirationStashId(stash.id);
      selection.contentSelection.setSelectedIdeaCreationId(null);
      selection.contentSelection.setSelectedAlbumId(null);
      projection.panes.setCompactPanel('creator');
      navigation.commit({ surface: 'inspiration-stash', stashId: stash.id }, 'replace');
    },
    palettes: data.wordPalettes,
    promptNodes: document.promptNodes,
    document: document.document,
    referenceAssetIds: document.referenceAssets.map((asset) => asset.id),
    refresh,
    replacePromptDocument: document.replaceDocument,
    restartNewCreation,
    saveCreationDraft: (prompt) => draftSession.saveDraftNow(undefined, prompt),
    selectedStashId: selection.contentSelection.selectedInspirationStashId,
    selectedStash: selection.contentSelection.selectedInspirationStash,
    selectedTerms: document.selectedTerms,
    synchronizePrompt: document.synchronize,
    targetAlbumId: selection.targetAlbumId,
    termPromptLocale: document.termPromptLocale,
    terms: data.terms,
    title: generation.title,
    onTitleChange: generation.setTitle,
    wordPaletteReferences: document.appliedPalettes.map((reference) => ({
      paletteId: reference.palette.id,
      paletteRevisionId: reference.revision.id,
      parameterValues: reference.parameterValues,
      promptLocale: reference.promptLocale,
    })),
  });
  const content = useCreatorContentWorkflows({
    onSocialPostSaved,
    captureDraftCommitIdentity: draftInput.draftProjection.captureCommitIdentity,
    captureDraftSaveSnapshot: (prompt) => draftInput.draftProjection.captureDraft(undefined, prompt),
    capturePrompt: document.capture,
    clearSavedInspiration: inspiration.clearSavedContent,
    commit: navigation.commit,
    data,
    editorDerivedVisualId: workbench.editorDerivedVisual?.id ?? null,
    generationRequestIdentity: generationRuntime.requestIdentity,
    getSavedDraftTitle: () => draftSession.getSavedDraft()?.title.trim() ?? '',
    invalidateAutosaves: draftSession.invalidateAutosaves,
    locale,
    newTitle: generation.title,
    notify,
    onOpenDerivedVisualWorkspace,
    preserveBeforeNavigation,
    referenceAssets: document.referenceAssets,
    refresh,
    resetInputs,
    restoreDraft: generation.hydration.restoreDraft,
    saveCapturedDraft: draftSession.saveCapturedSnapshot,
    saveDraft: (prompt) => draftSession.saveDraftNow(undefined, prompt),
    selectedInspirationStashId: selection.contentSelection.selectedInspirationStashId,
    setCompactPanel: projection.panes.setCompactPanel,
    setOutputMode,
    setOutputSeriesId: workbench.setOutputSeriesId,
    setRequestedAssetId,
    setSelectedAlbumId: selection.contentSelection.setSelectedAlbumId,
    setSelectedArticleId: selection.contentSelection.setSelectedArticleId,
    setSelectedIdeaCreationId: selection.contentSelection.setSelectedIdeaCreationId,
    setSelectedInspirationStashId: selection.contentSelection.setSelectedInspirationStashId,
    setSelectedSocialPostId: selection.contentSelection.setSelectedSocialPostId,
    setTargetAlbumId: selection.setTargetAlbumId,
    synchronizePrompt: document.synchronize,
    targetAlbumId: selection.targetAlbumId,
  });
  const assistant = useCreatorAssistantRuntime({
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
  });
  const starting = generationStarting || content.outcome.starting;
  const autosaveSnapshot = draftInput.draftProjection.snapshotForPrompt({
    document: document.document,
    nodes: document.promptNodes,
    manualPrompt: document.manualPrompt,
    selectedTerms: document.selectedTerms,
    appliedPalettes: document.appliedPalettes,
  });
  const hasDraftContent = creationDraftSnapshotHasMeaningfulInput(
    autosaveSnapshot,
    selection.targetAlbum?.creationDefaults ?? null,
    initialGenerationTargets({ creationDraft: null, imageGenerationRoutes: data.imageGenerationRoutes }),
  );
  const draftPersistenceAllowed = autosaveEnabled(
    selection,
    assistant.workflows.adoption.busy,
    starting,
    Boolean(workbench.editorDerivedVisual),
  );
  const preserveActiveDraft = useStableCallback(() => {
    if (!draftPersistenceAllowed || (!hasDraftContent && !draftSession.getDraftId())) return;
    try {
      const snapshot = draftInput.draftProjection.captureDraft();
      void draftSession
        .preserveCapturedSnapshot(snapshot)
        .catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  });
  useEffect(() => {
    if (!active) return undefined;
    return preserveActiveDraft;
  }, [active, preserveActiveDraft]);
  useCreationDraftAutosave({
    autosaveKey: `${locale}:${JSON.stringify(autosaveSnapshot)}`,
    draftId: draftSession.draftId,
    enabled: active && draftPersistenceAllowed,
    hasContent: hasDraftContent,
    captureIdentity: draftSession.captureAutosaveIdentity,
    saveIfCurrent: draftSession.saveAutosaveIfCurrent,
    onError(reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    },
  });

  function resetInputs() {
    draftSession.invalidateAutosaves();
    selection.setInputSessionRevision((revision) => revision + 1);
    generation.hydration.resetHydration();
    document.promptNodesRef.current = [];
    document.updatePromptDocument([]);
    document.replaceMaterials({
      ...document.materialsRef.current,
      referenceAssets: [],
      videoAttachments: [],
      selectedTerms: [],
      appliedPalettes: [],
    });
    generation.dictionaryMaterials.closeDictionary();
    onPromptFullWindowChange(false);
    assistant.workflows.reset();
    setRenameOpen(false);
    draftInput.inputStashes.reset();
  }

  return { assistant, content, inspiration, resetInputs, starting };
}

function autosaveEnabled(
  selection: SelectionSession,
  adoptionBusy: boolean,
  starting: boolean,
  editingDerivedVisual: boolean,
) {
  const selected = selection.contentSelection;
  return Boolean(
    selection.creationMode === 'new' &&
    !selected.selectedEvaluationSuiteId &&
    !selected.selectedImageBreakdownId &&
    !selected.selectedInspirationStashId &&
    (editingDerivedVisual || (!selected.selectedSocialPostId && !selected.selectedArticleId)) &&
    !adoptionBusy &&
    !starting,
  );
}
