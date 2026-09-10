import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { DerivedVisualWorkspaceViewState } from '@/renderer/components/creator/derivedVisualWorkspace';
import type {
  CreationDraftPromptSnapshot,
  CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useCreatorArticleWorkflow } from '@/renderer/components/creator/workflows/useCreatorArticleWorkflow';
import { useCreatorImageVariantWorkflow } from '@/renderer/components/creator/workflows/useCreatorImageVariantWorkflow';
import { useCreatorOutcomeWorkflow } from '@/renderer/components/creator/workflows/useCreatorOutcomeWorkflow';
import { useCreatorSocialPostWorkflow } from '@/renderer/components/creator/workflows/useCreatorSocialPostWorkflow';
import { useDerivedVisualWorkflow } from '@/renderer/components/creator/workflows/useDerivedVisualWorkflow';
import type {
  ArticleDto,
  AssetDto,
  BootstrapDto,
  CreationDraftDto,
  DerivedVisualWorkspaceOpenResult,
  Locale,
  SocialPostDto,
} from '@/shared/contracts';
import { useMemo } from 'react';

interface Options {
  captureDraftCommitIdentity(): string | null;
  captureDraftSaveSnapshot(prompt: CreationDraftPromptSnapshot): CreationDraftSaveSnapshot;
  capturePrompt(): CreationDraftPromptSnapshot;
  clearSavedInspiration(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  data: BootstrapDto;
  editorDerivedVisualId: string | null;
  generationRequestIdentity: string;
  getSavedDraftTitle(): string;
  invalidateAutosaves(): void;
  locale: Locale;
  newTitle: string;
  notify(message: string): void;
  onSocialPostSaved(post: SocialPostDto): void;
  onOpenDerivedVisualWorkspace(result: DerivedVisualWorkspaceOpenResult, view?: DerivedVisualWorkspaceViewState): void;
  preserveBeforeNavigation(): Promise<boolean>;
  referenceAssets: readonly AssetDto[];
  refresh(): Promise<void>;
  resetInputs(): void;
  restoreDraft(draft: CreationDraftDto | null): void;
  saveCapturedDraft(snapshot: CreationDraftSaveSnapshot): Promise<CreationDraftDto>;
  saveDraft(prompt: CreationDraftPromptSnapshot): Promise<CreationDraftDto>;
  selectedInspirationStashId: string | null;
  setCompactPanel(panel: 'creator' | 'output'): void;
  setOutputMode(mode: 'results'): void;
  setOutputSeriesId(seriesId: string | null): void;
  setRequestedAssetId(assetId: string | null): void;
  setSelectedAlbumId(albumId: string | null): void;
  setSelectedArticleId(articleId: string | null): void;
  setSelectedIdeaCreationId(creationId: string | null): void;
  setSelectedInspirationStashId(stashId: string | null): void;
  setSelectedSocialPostId(postId: string | null): void;
  setTargetAlbumId(albumId: string | null): void;
  synchronizePrompt(prompt: CreationDraftPromptSnapshot): void;
  targetAlbumId: string | null;
}

export function useCreatorContentWorkflows(options: Options) {
  function openArticle(article: ArticleDto) {
    options.setSelectedSocialPostId(null);
    options.setSelectedArticleId(article.id);
    options.commit({ surface: 'article', articleId: article.id }, 'push');
  }

  function finishDraftContent(article: ArticleDto) {
    options.setTargetAlbumId(null);
    options.setSelectedSocialPostId(null);
    options.setSelectedArticleId(article.id);
    options.setSelectedInspirationStashId(null);
    options.clearSavedInspiration();
    options.setSelectedIdeaCreationId(null);
    options.setSelectedAlbumId(null);
    options.setOutputMode('results');
    options.setOutputSeriesId(null);
    options.setRequestedAssetId(null);
    options.resetInputs();
    options.restoreDraft(null);
    options.setCompactPanel('creator');
    options.commit({ surface: 'article', articleId: article.id }, 'replace');
  }

  const createImageVariant = useCreatorImageVariantWorkflow({
    data: options.data,
    captureSelectionIdentity: () => options.generationRequestIdentity,
    refresh: options.refresh,
    notify: options.notify,
    onOpenArticle: (created) => {
      options.setCompactPanel('creator');
      openArticle(created);
    },
  });
  const article = useCreatorArticleWorkflow({
    creationItems: options.data.creationItems,
    getCreationDraftCommitIdentity: options.captureDraftCommitIdentity,
    inspirationStashes: options.data.inspirationStashes ?? [],
    locale: options.locale,
    notify: options.notify,
    onDraftArticleCreated: finishDraftContent,
    onOpenArticle: openArticle,
    refresh: options.refresh,
  });
  const socialPost = useCreatorSocialPostWorkflow({
    onSaved: options.onSocialPostSaved,
    creationItems: options.data.creationItems,
    inspirationStashes: options.data.inspirationStashes ?? [],
    locale: options.locale,
    notify: options.notify,
    onOpenArticle: openArticle,
    refresh: options.refresh,
  });
  const outcome = useCreatorOutcomeWorkflow({
    captureDraftSaveSnapshot: options.captureDraftSaveSnapshot,
    captureSnapshot() {
      const prompt = options.capturePrompt();
      return {
        prompt,
        referenceAssets: [...options.referenceAssets],
        savedDraftTitle: options.getSavedDraftTitle(),
        sourceInspirationStashId: options.selectedInspirationStashId,
        targetAlbumId: options.targetAlbumId,
        typedTitle: options.newTitle.trim(),
      };
    },
    createArticleFromDraft: article.createArticleFromDraft,
    invalidateAutosaves: options.invalidateAutosaves,
    notify: options.notify,
    onPromptCaptured: options.synchronizePrompt,
    requestIdentity: options.generationRequestIdentity,
    saveCapturedDraft: options.saveCapturedDraft,
    saveDraft: options.saveDraft,
  });
  const seriesIds = useMemo(() => new Set(options.data.series.map((item) => item.id)), [options.data.series]);
  const derivedVisual = useDerivedVisualWorkflow({
    spaceId: options.data.spaceId,
    articles: options.data.articles ?? [],
    socialPosts: options.data.socialPosts ?? [],
    canvasPresets: options.data.canvasPresets,
    captureSelectionIdentity: () => options.generationRequestIdentity,
    creationDraftId: options.data.creationDraft?.id ?? null,
    creationItems: options.data.creationItems,
    derivedVisuals: options.data.derivedVisuals ?? [],
    locale: options.locale,
    notify: options.notify,
    onKeepAdoptedWorkspace: options.setRequestedAssetId,
    onOpenWorkspace: options.onOpenDerivedVisualWorkspace,
    preserveBeforeNavigation: options.preserveBeforeNavigation,
    promptTemplates: options.data.derivedVisualPrompts,
    refresh: options.refresh,
    seriesIds,
    stayInWorkspace: (visualId) => options.editorDerivedVisualId === visualId,
  });

  return { article, createImageVariant, derivedVisual, outcome, socialPost };
}
