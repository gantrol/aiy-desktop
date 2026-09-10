import type { Dispatch, SetStateAction } from 'react';
import type { Locale } from '@/shared/contracts';
import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import { commitGeneratedImageLocation } from '@/renderer/components/creator/screen/creatorScreenProjection';
import type { useCreatorDraftInputSession } from '@/renderer/components/creator/screen/useCreatorDraftInputSession';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import type { useCreatorScreenProjection } from '@/renderer/components/creator/screen/useCreatorScreenProjection';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import type { useCreatorAutoTitle } from '@/renderer/components/creator/workflows/useCreatorAutoTitle';
import {
  useCreatorGenerationLaunch,
  type CreatorGenerationLaunchSnapshot,
} from '@/renderer/components/creator/workflows/useCreatorGenerationLaunch';
import { useCreatorOutputCommands } from '@/renderer/components/creator/workflows/useCreatorOutputCommands';
import { navigationLocationKey } from '@/renderer/components/app/app-navigation';
import { resolveCreatorPrompt } from '@/renderer/components/creator/utils';

type DraftInputSession = ReturnType<typeof useCreatorDraftInputSession>;
type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type ScreenProjection = ReturnType<typeof useCreatorScreenProjection>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;
type WorkbenchProjection = ReturnType<typeof useCreatorWorkbenchProjection>;

interface Options {
  active: boolean;
  annotationRefinementState: AnnotationRefinementState | null;
  blocked(): boolean;
  clearSavedInspiration(): void;
  draftInput: DraftInputSession;
  generation: GenerationInputSession;
  locale: Locale;
  messages: { failed: string; started: string };
  notify(message: string): void;
  projection: ScreenProjection;
  refresh(): Promise<void>;
  scheduleAutoTitle: ReturnType<typeof useCreatorAutoTitle>['scheduleAutoTitle'];
  selection: SelectionSession;
  setOutputMode: Dispatch<SetStateAction<CreationOutputMode>>;
  workbench: WorkbenchProjection;
}

export function useCreatorGenerationRuntime({
  active,
  annotationRefinementState,
  blocked,
  clearSavedInspiration,
  draftInput,
  generation,
  locale,
  messages,
  notify,
  projection,
  refresh,
  scheduleAutoTitle,
  selection,
  setOutputMode,
  workbench,
}: Options) {
  const document = generation.promptDocument;
  const navigation = draftInput.navigation;
  const draftSession = selection.creationDraftSession;

  function captureSnapshot(): CreatorGenerationLaunchSnapshot {
    const capturedPrompt = document.capture();
    const capturedResolution = resolveCreatorPrompt({
      manualPrompt: capturedPrompt.manualPrompt,
      promptNodes: capturedPrompt.nodes,
      selectedTerms: capturedPrompt.selectedTerms,
      appliedPalettes: capturedPrompt.appliedPalettes,
      termPromptLocale: document.termPromptLocale,
      promptProfileId: generation.configuration.promptProfileId,
    });
    if (projection.readiness.ready && capturedResolution.livePrompt.trim()) document.synchronize(capturedPrompt);
    const creating = selection.creationMode === 'new';
    const typedTitle = generation.title.trim();
    return {
      annotationRefinement: annotationRefinementState,
      automaticChangeSummary: projection.automaticChangeSummary,
      baseVersionId: generation.hydration.version?.id ?? null,
      canvas: {
        height: generation.canvasPreset?.height ?? null,
        stableKey: generation.canvasPreset?.stableKey ?? null,
        width: generation.canvasPreset?.width ?? null,
      },
      creating,
      finalPrompt: capturedResolution.livePrompt,
      generationTargets: generation.generationTargets.map((target) => ({ ...target })),
      initialTitle: creating ? typedTitle || '新创作' : workbench.series?.title || '新创作',
      inspirationStashId: selection.contentSelection.selectedInspirationStashId,
      keepEditorOpen: Boolean(workbench.editorDerivedVisual),
      locale,
      prompt: capturedPrompt,
      quality: generation.quality,
      ready: projection.readiness.ready,
      referenceAssetIds: document.referenceAssets.map((asset) => asset.id),
      resolvedPrompt: capturedResolution.composition,
      seriesId: selection.seriesId,
      termPromptLocale: document.termPromptLocale,
      typedTitle,
      wordPaletteReferences: capturedPrompt.appliedPalettes.map((reference) => ({
        paletteId: reference.palette.id,
        paletteRevisionId: reference.revision.id,
        parameterValues: { ...reference.parameterValues },
        promptLocale: reference.promptLocale,
      })),
    };
  }

  const requestIdentity = `${selection.inputSessionRevision}:${navigationLocationKey(navigation.workbenchLocation())}`;
  const launch = useCreatorGenerationLaunch({
    active,
    blocked: () => blocked() || draftInput.recovery.state.status === 'loading',
    captureSnapshot,
    preserveWorkingInput: draftInput.recovery.flush,
    failedMessage: messages.failed,
    invalidateAutosaves: draftSession.invalidateAutosaves,
    notify,
    onGenerated(result, snapshot) {
      selection.setCreationMode('existing');
      selection.setTargetAlbumId(null);
      selection.contentSelection.setSelectedInspirationStashId(null);
      clearSavedInspiration();
      if (snapshot.creating) draftSession.replaceDraftSession(null);
      else draftSession.detachDraftIdentity();
      selection.contentSelection.setSelectedIdeaCreationId(null);
      setOutputMode('results');
      selection.setSeriesId(result.seriesId);
      workbench.setOutputSeriesId(result.seriesId);
      generation.hydration.setVersionId(result.versionId);
      projection.panes.setOutputCollapsed(false);
      projection.panes.setCompactPanel('output');
      commitGeneratedImageLocation(snapshot.keepEditorOpen, result.seriesId, result.versionId, navigation.commit);
      if (snapshot.creating && !snapshot.typedTitle) {
        scheduleAutoTitle({
          runId: result.runIds[0],
          seriesId: result.seriesId,
          prompt: snapshot.finalPrompt,
          initialTitle: snapshot.initialTitle,
        });
      }
    },
    onRefinementGenerated(result) {
      workbench.setOutputSeriesId(result.seriesId);
      projection.panes.setCompactPanel('output');
    },
    refresh,
    requestIdentity,
    saveDraft: (prompt) => draftSession.saveDraftNow(undefined, prompt),
    startedMessage: messages.started,
  });
  const outputCommands = useCreatorOutputCommands({
    generationTargets: generation.generationTargets,
    locale,
    notify,
    onOutputSeries(seriesId) {
      workbench.setOutputSeriesId(seriesId);
      projection.panes.setCompactPanel('output');
    },
    refresh,
    requestIdentity,
    startedMessage: messages.started,
  });

  return { launch, outputCommands, requestIdentity };
}
