import type { Locale, PromptSeriesDto } from '@/shared/contracts';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import { useCreatorNavigationCore } from '@/renderer/components/creator/screen/useCreatorNavigationCore';
import type { useCreatorPromptSession } from '@/renderer/components/creator/screen/useCreatorPromptSession';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import { useCreationInputStashes } from '@/renderer/components/creator/workflows/useCreationInputStashes';
import { useCreatorDraftProjection } from '@/renderer/components/creator/workflows/useCreatorDraftProjection';
import { useBrowserCompanionHandoff } from '@/renderer/features/browser-companion/useBrowserCompanionHandoff';
import { resolveCreatorPrompt } from '@/renderer/components/creator/utils';

type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type PromptSession = ReturnType<typeof useCreatorPromptSession>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;

interface Options {
  generation: GenerationInputSession;
  locale: Locale;
  location: CreatorLocation;
  notify(message: string): void;
  onNavigate(location: CreatorLocation, mode?: NavigationMode): void;
  onPromptFullWindowChange(open: boolean): void;
  prompt: PromptSession;
  requestedAssetId: string | null;
  selection: SelectionSession;
  series: PromptSeriesDto | undefined;
  sessionHostSeries: PromptSeriesDto | null;
  setRequestedAssetId(assetId: string | null): void;
}

export function useCreatorDraftInputSession({
  generation,
  locale,
  location,
  notify,
  onNavigate,
  onPromptFullWindowChange,
  prompt,
  requestedAssetId,
  selection,
  series,
  sessionHostSeries,
  setRequestedAssetId,
}: Options) {
  const { contentSelection, creationDraftSession, creationMode } = selection;
  const document = prompt.promptDocument;
  const catalog = prompt.dictionaryCatalog;
  const draftProjection = useCreatorDraftProjection({
    appliedPalettes: document.appliedPalettes,
    canvasPresetKey: generation.canvasPreset?.stableKey ?? null,
    capturePrompt: document.capture,
    creationMode,
    dictionaryScope: catalog.dictionaryScope,
    generationTargets: generation.generationTargets,
    getDraftId: creationDraftSession.getDraftId,
    manualPrompt: document.manualPrompt,
    promptNodes: document.promptNodes,
    quality: generation.quality,
    referenceAssets: document.referenceAssets,
    repeatCount: generation.repeatCount,
    resolvedPrompt: generation.promptResolution.livePrompt,
    saveDraft: creationDraftSession.saveDraftNow,
    selectedModelKeys: generation.configuration.selectedModelKeys,
    selectedTerms: document.selectedTerms,
    sessionHostSeries,
    targetAlbumId: selection.targetAlbumId,
    termPromptLocale: document.termPromptLocale,
    title: prompt.newTitle,
  });
  selection.captureCreationDraftRef.current = draftProjection.captureDraft;
  const inputStashes = useCreationInputStashes({
    locale,
    notify,
    ensureScope: draftProjection.ensureScope,
    isScopeCurrent: draftProjection.isScopeCurrent,
    captureSnapshot: () => draftProjection.currentInput,
    applyStash: generation.hydration.applyInputStash,
  });
  const navigation = useCreatorNavigationCore({
    closeDictionary: generation.dictionaryMaterials.closeDictionary,
    creationMode,
    getDraftId: creationDraftSession.getDraftId,
    initialLocation: location,
    location,
    notify,
    onNavigate,
    onPromptFullWindowChange,
    requestedAssetId,
    saveDraft: creationDraftSession.saveDraftNow,
    selected: {
      articleId: contentSelection.selectedArticleId,
      evaluationSuiteId: contentSelection.selectedEvaluationSuiteId,
      ideaCreationId: contentSelection.selectedIdeaCreationId,
      imageBreakdownId: contentSelection.selectedImageBreakdownId,
      inspirationStashId: contentSelection.selectedInspirationStashId,
      socialPostId: contentSelection.selectedSocialPostId,
    },
    seriesId: selection.seriesId,
    setCreationStartMode: selection.setCreationStartMode,
    setRequestedAssetId,
    setTargetAlbumId: selection.setTargetAlbumId,
    setVideoCreationRequest: selection.setVideoCreationRequest,
    targetAlbumId: selection.targetAlbumId,
  });
  const promptHandoff = useBrowserCompanionHandoff({
    notify,
    zh: locale === 'zh',
    prepare: async () => {
      const captured = document.capture();
      const resolved = resolveCreatorPrompt({
        manualPrompt: captured.manualPrompt,
        promptNodes: captured.nodes,
        selectedTerms: captured.selectedTerms,
        appliedPalettes: captured.appliedPalettes,
        termPromptLocale: document.termPromptLocale,
        promptProfileId: generation.configuration.promptProfileId,
      }).livePrompt.trim();
      if (!resolved) {
        notify(locale === 'zh' ? '请先填写 Prompt' : 'Write a prompt first');
        return null;
      }
      if (Array.from(resolved).length > 10_000) {
        notify(
          locale === 'zh' ? '浏览器交接 Prompt 不能超过 10000 字' : 'Browser handoff is limited to 10,000 characters',
        );
        return null;
      }
      const draft = await creationDraftSession.saveDraftNow(undefined, captured);
      return {
        source: { kind: 'creation-draft' as const, id: draft.id },
        contentKind: 'prompt' as const,
        text: resolved,
      };
    },
  });

  return { draftProjection, inputStashes, navigation, promptHandoff, series };
}
