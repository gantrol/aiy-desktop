import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { navigationLocationKey } from '@/renderer/components/app/app-navigation';
import { isDerivedVisualLocation } from '@/renderer/components/creator/derivedVisualWorkspace';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import { useCreatorNavigationCore } from '@/renderer/components/creator/screen/useCreatorNavigationCore';
import type { useCreatorPromptSession } from '@/renderer/components/creator/screen/useCreatorPromptSession';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import { resolveCreatorPrompt } from '@/renderer/components/creator/utils';
import {
  imagePromptPlanNode,
  MAX_IMAGE_PROMPTS,
  readImagePromptPlan,
} from '@/renderer/components/creator/imagePromptPlan';
import { useCreationInputStashes } from '@/renderer/components/creator/workflows/useCreationInputStashes';
import { useCreatorDraftProjection } from '@/renderer/components/creator/workflows/useCreatorDraftProjection';
import { useCreatorInputRecovery } from '@/renderer/components/creator/workflows/useCreatorInputRecovery';
import { useBrowserCompanionHandoff } from '@/renderer/features/browser-companion/useBrowserCompanionHandoff';
import { useI18n } from '@/renderer/i18n/useI18n';
import { assertBlockDocumentReady, blockDocumentAssetIds } from '@/shared/contracts/block-document';
import type { Locale, PromptSeriesDto } from '@/shared/contracts';
import { useEffect } from 'react';

type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type PromptSession = ReturnType<typeof useCreatorPromptSession>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;

interface Options {
  active: boolean;
  spaceId: string;
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
  active,
  spaceId,
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
  const handoffCopy = useI18n().messages.browserCompanion;
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
    document: document.document,
    quality: generation.quality,
    referenceAssets: document.referenceAssets,
    videoAttachments: document.videoAttachments,
    repeatCount: generation.repeatCount,
    resolvedPrompt: generation.promptResolution.livePrompt,
    resolvePrompt: (captured) =>
      resolveCreatorPrompt({
        manualPrompt: captured.manualPrompt,
        promptNodes: captured.nodes,
        selectedTerms: captured.selectedTerms,
        appliedPalettes: captured.appliedPalettes,
        termPromptLocale: document.termPromptLocale,
        promptProfileId: generation.configuration.promptProfileId,
      }).livePrompt,
    saveDraft: creationDraftSession.saveDraftNow,
    selectedModelKeys: generation.configuration.selectedModelKeys,
    selectedTerms: document.selectedTerms,
    sessionHostSeries,
    targetAlbumId: selection.targetAlbumId,
    termPromptLocale: document.termPromptLocale,
    title: prompt.newTitle,
  });
  selection.captureCreationDraftRef.current = draftProjection.captureDraft;
  selection.settleCreationDraftInputRef.current = async () => {
    await document.promptComposerRef.current?.whenSettled();
  };
  const visibleInput =
    Boolean(selection.workbenchProjection.editorDerivedVisual) ||
    !(
      contentSelection.selectedArticleId ||
      contentSelection.selectedSocialPostId ||
      contentSelection.selectedEvaluationSuiteId ||
      contentSelection.selectedImageBreakdownId
    );
  const recovery = useCreatorInputRecovery({
    scope:
      active &&
      visibleInput &&
      creationMode === 'existing' &&
      series &&
      generation.hydration.version &&
      generation.hydration.hydratedVersionId === generation.hydration.version.id
        ? { spaceId, seriesId: series.id, versionId: generation.hydration.version.id }
        : null,
    snapshot: draftProjection.currentInput,
    capture: draftProjection.captureInput,
    restore: generation.hydration.applyInputSnapshot,
  });
  const inputStashes = useCreationInputStashes({
    locale,
    notify,
    ensureScope: draftProjection.ensureScope,
    isScopeCurrent: draftProjection.isScopeCurrent,
    captureSnapshot: draftProjection.captureInput,
    applyStash: generation.hydration.applyInputStash,
  });
  const navigation = useCreatorNavigationCore({
    derivedVisualId: selection.workbenchProjection.editorDerivedVisual?.id ?? null,
    versionId: generation.hydration.versionId || null,
    outputSeriesId: selection.workbenchProjection.outputSeries?.id ?? null,
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
  const creationDraftId = creationDraftSession.getDraftId();
  const currentVisualId = selection.workbenchProjection.editorDerivedVisual?.id;
  const { locationApplicationRef, workbenchLocation, commit } = navigation;
  useEffect(() => {
    if (
      !active ||
      !currentVisualId ||
      !isDerivedVisualLocation(location) ||
      location.derivedVisualId !== currentVisualId ||
      locationApplicationRef.current.appliedKey !== navigationLocationKey(location)
    )
      return;
    const next = workbenchLocation();
    if (navigationLocationKey(next) !== navigationLocationKey(location)) commit(next, 'replace');
  }, [
    active,
    commit,
    creationDraftId,
    creationMode,
    currentVisualId,
    generation.hydration.versionId,
    location,
    locationApplicationRef,
    requestedAssetId,
    selection.seriesId,
    selection.workbenchProjection.outputSeries?.id,
    workbenchLocation,
  ]);
  const promptHandoff = useBrowserCompanionHandoff({
    notify,
    prepare: async () => {
      await document.promptComposerRef.current?.whenSettled();
      const captured = document.capture();
      assertBlockDocumentReady(captured.document);
      const imagePrompts = readImagePromptPlan(captured.document);
      if (
        imagePromptPlanNode(captured.document) &&
        (!imagePrompts.length ||
          imagePrompts.length > MAX_IMAGE_PROMPTS ||
          imagePrompts.some((prompt) => !prompt.trim()))
      ) {
        notify(handoffCopy.imagePlanInvalid);
        return null;
      }
      const mediaAssetIds = [
        ...new Set([
          ...document.materialsRef.current.referenceAssets.map((asset) => asset.id),
          ...(captured.document ? blockDocumentAssetIds(captured.document) : []),
        ]),
      ];
      if (mediaAssetIds.length > 20) {
        notify(handoffCopy.promptMediaLimit);
        return null;
      }
      const resolved = resolveCreatorPrompt({
        manualPrompt: captured.manualPrompt,
        promptNodes: captured.nodes,
        selectedTerms: captured.selectedTerms,
        appliedPalettes: captured.appliedPalettes,
        termPromptLocale: document.termPromptLocale,
        promptProfileId: generation.configuration.promptProfileId,
      }).livePrompt.trim();
      if (!resolved) {
        notify(handoffCopy.promptRequired);
        return null;
      }
      const canvas = generation.canvasPreset;
      const text = [
        resolved,
        ...(canvas
          ? [
              handoffCopy.canvasPrompt
                .replace('{ratio}', canvas.ratio)
                .replace('{width}', String(canvas.width))
                .replace('{height}', String(canvas.height)),
              ...(canvas.stableKey === 'wechat_article_cover_2_35_1' ? [handoffCopy.wechatCropPrompt] : []),
            ]
          : []),
      ].join('\n\n');
      if (text.length > 10_000) {
        notify(handoffCopy.promptLimit);
        return null;
      }
      const draft = await creationDraftSession.saveDraftNow(undefined, captured);
      const outputTarget = await generation.prepareBrowserCompanionOutputTarget({
        draft,
        captured,
        referenceAssetIds: mediaAssetIds,
        text,
      });
      return {
        source: {
          kind: 'creation-draft' as const,
          id: draft.id,
          ...(outputTarget ? { outputTarget } : {}),
        },
        contentKind: 'prompt' as const,
        text,
        mediaAssetIds,
      };
    },
  });

  return { draftProjection, inputStashes, navigation, promptHandoff, recovery, series };
}
