import { useMemo } from 'react';
import type { Locale } from '@/shared/contracts';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import { generationReadiness } from '@/renderer/components/creator/generationReadiness';
import type { ResultLibrarySurface } from '@/renderer/components/creator/ResultLibrary';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import { useCreatorPanes } from '@/renderer/components/creator/useCreatorPanes';
import { creationDiffSummary } from '@/renderer/components/creator/utils';

type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;
type WorkbenchProjection = ReturnType<typeof useCreatorWorkbenchProjection>;

interface Options {
  comparisonFullWindow: boolean;
  documentWorkspaceActive: boolean;
  generation: GenerationInputSession;
  locale: Locale;
  outputMode: CreationOutputMode;
  promptFullWindow: boolean;
  selection: SelectionSession;
  workbench: WorkbenchProjection;
}

function selectedCreatorSurface(selection: SelectionSession): ResultLibrarySurface {
  const selected = selection.contentSelection;
  if (selected.selectedEvaluationSuite) return 'evaluation-suite';
  if (selected.selectedSocialPost) return 'social-post';
  if (selected.selectedArticle) return 'article';
  if (selected.selectedIdeaCreation) return 'idea-creation';
  if (selected.selectedInspirationStash) return 'inspiration-stash';
  if (selected.selectedImageBreakdown) return 'image-breakdown';
  if (selected.selectedAlbum) return 'album-detail';
  return selection.creationMode === 'new' ? 'new-creation' : 'existing-creation';
}

function isNewCreationSurface(selection: SelectionSession) {
  const selected = selection.contentSelection;
  return (
    selection.creationMode === 'new' &&
    !selected.selectedAlbum &&
    !selected.selectedIdeaCreation &&
    !selected.selectedEvaluationSuite &&
    !selected.selectedImageBreakdown &&
    !selected.selectedSocialPost &&
    !selected.selectedArticle
  );
}

function outputPaneVisible(
  selection: SelectionSession,
  workbench: WorkbenchProjection,
  documentWorkspaceActive: boolean,
  comparisonFullWindow: boolean,
  outputMode: CreationOutputMode,
) {
  const selected = selection.contentSelection;
  if (documentWorkspaceActive || selected.selectedEvaluationSuite || selected.selectedImageBreakdown) return false;
  if (workbench.editorDerivedVisual) return true;
  if (selected.selectedSocialPost || selected.selectedArticle) return false;
  if (comparisonFullWindow) return true;
  if (selected.selectedAlbum) return false;
  return (
    (selection.creationMode === 'existing' && Boolean(workbench.outputSeries)) ||
    (outputMode === 'records' &&
      Boolean(selected.selectedIdeaCreation ?? workbench.projectIdeaCreation ?? workbench.assistantScope))
  );
}

export function useCreatorScreenProjection({
  comparisonFullWindow,
  documentWorkspaceActive,
  generation,
  locale,
  outputMode,
  promptFullWindow,
  selection,
  workbench,
}: Options) {
  const document = generation.hydration;
  const prompt = generation.promptResolution;
  const promptDocument = generation.promptDocument;
  const automaticChangeSummary = useMemo(
    () =>
      creationDiffSummary({
        locale,
        previousPrompt: document.version?.finalPrompt ?? '',
        nextPrompt: prompt.livePrompt,
        previousReferenceIds: (document.version?.referenceAssets ?? []).map((asset) => asset.id),
        nextReferenceIds: promptDocument.referenceAssets.map((asset) => asset.id),
        previousCanvasKey: document.version?.runs[0]?.canvasPresetKey ?? null,
        nextCanvasKey: generation.canvasPreset?.stableKey ?? null,
        nextCanvasLabel: generation.canvasPreset?.ratio ?? '',
        previousQuality: document.version?.runs[0]?.quality ?? null,
        nextQuality: generation.quality,
      }),
    [
      document.version,
      prompt.livePrompt,
      locale,
      promptDocument.referenceAssets,
      generation.canvasPreset,
      generation.quality,
    ],
  );
  const readiness = useMemo(
    () =>
      generationReadiness({
        prompt: prompt.livePrompt,
        routes: generation.configuration.imageGenerationRoutes,
        selectedModelKeys: generation.configuration.selectedModelKeys,
        referenceCount: promptDocument.referenceAssets.length,
      }),
    [prompt.livePrompt, generation.configuration, promptDocument.referenceAssets.length],
  );
  const showOutputPane = outputPaneVisible(
    selection,
    workbench,
    documentWorkspaceActive,
    comparisonFullWindow,
    outputMode,
  );
  const panes = useCreatorPanes({
    showResultLibrary: true,
    showOutputInspector: showOutputPane,
    comparisonFullWindow: comparisonFullWindow || promptFullWindow,
  });

  return {
    activeIdeaCreation: selection.contentSelection.selectedIdeaCreation ?? workbench.projectIdeaCreation,
    automaticChangeSummary,
    creatorSurface: selectedCreatorSurface(selection),
    dictionarySelectionCount:
      prompt.effectiveTerms.filter(({ directSource }) => directSource).length + prompt.recipeSources.length,
    generationCount: generation.generationTargets.reduce((total, target) => total + target.count, 0),
    newCreationSurface: isNewCreationSurface(selection),
    panes,
    readiness,
    showOutputPane,
  };
}
