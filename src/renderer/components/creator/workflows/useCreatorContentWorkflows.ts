import { useMemo } from 'react';
import type {
  ArticleDto,
  AssetDto,
  BootstrapDto,
  CreationDraftDto,
  DerivedVisualWorkspaceOpenResult,
  Locale,
  SocialPostDto,
} from '@/shared/contracts';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import type { CreationDraftSaveSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useCreatorArticleWorkflow } from '@/renderer/components/creator/workflows/useCreatorArticleWorkflow';
import { useCreatorOutcomeWorkflow } from '@/renderer/components/creator/workflows/useCreatorOutcomeWorkflow';
import { useCreatorSocialPostWorkflow } from '@/renderer/components/creator/workflows/useCreatorSocialPostWorkflow';
import { useDerivedVisualWorkflow } from '@/renderer/components/creator/workflows/useDerivedVisualWorkflow';
import { resolveCreatorPrompt } from '@/renderer/components/creator/utils';

interface Options {
  automaticChangeSummary: string;
  captureDraftCommitIdentity(): string | null;
  captureDraftSaveSnapshot(prompt: CreationDraftPromptSnapshot): CreationDraftSaveSnapshot;
  capturePrompt(): CreationDraftPromptSnapshot;
  clearSavedInspiration(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  data: BootstrapDto;
  editorSocialCoverVisualId: string | null;
  generationRequestIdentity: string;
  getSavedDraftTitle(): string;
  invalidateAutosaves(): void;
  locale: Locale;
  newTitle: string;
  notify(message: string): void;
  onOpenDerivedVisualWorkspace(result: DerivedVisualWorkspaceOpenResult): void;
  preserveBeforeNavigation(): Promise<boolean>;
  promptProfileId: string;
  referenceAssets: readonly AssetDto[];
  refresh(): Promise<void>;
  replaceDraftSession(draft: CreationDraftDto | null): void;
  resetInputs(): void;
  restoreDraft(draft: CreationDraftDto | null): void;
  saveCapturedDraft(snapshot: CreationDraftSaveSnapshot): Promise<CreationDraftDto>;
  saveDraft(prompt: CreationDraftPromptSnapshot): Promise<CreationDraftDto>;
  selectedInspirationStashId: string | null;
  setCompactPanel(panel: 'creator' | 'output'): void;
  setCreationMode(mode: 'existing' | 'new'): void;
  setOutputCollapsed(collapsed: boolean): void;
  setOutputMode(mode: 'results'): void;
  setOutputSeriesId(seriesId: string | null): void;
  setRequestedAssetId(assetId: string | null): void;
  setSelectedAlbumId(albumId: string | null): void;
  setSelectedArticleId(articleId: string | null): void;
  setSelectedIdeaCreationId(creationId: string | null): void;
  setSelectedInspirationStashId(stashId: string | null): void;
  setSelectedSocialPostId(postId: string | null): void;
  setSeriesId(seriesId: string | null): void;
  setTargetAlbumId(albumId: string | null): void;
  setVersionId(versionId: string): void;
  synchronizePrompt(prompt: CreationDraftPromptSnapshot): void;
  targetAlbumId: string | null;
  termPromptLocale: Locale;
}

export function useCreatorContentWorkflows(options: Options) {
  function openArticle(article: ArticleDto) {
    options.setSelectedSocialPostId(null);
    options.setSelectedArticleId(article.id);
    options.commit({ surface: 'article', articleId: article.id }, 'push');
  }

  function openSocialPost(post: SocialPostDto) {
    options.setSelectedArticleId(null);
    options.setSelectedSocialPostId(post.id);
    options.commit({ surface: 'social-post', postId: post.id }, 'push');
  }

  function finishDraftContent(destination: { article: ArticleDto } | { post: SocialPostDto }) {
    const article = 'article' in destination ? destination.article : null;
    const post = 'post' in destination ? destination.post : null;
    options.setTargetAlbumId(null);
    options.setSelectedSocialPostId(post?.id ?? null);
    options.setSelectedArticleId(article?.id ?? null);
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
    options.commit(
      article ? { surface: 'article', articleId: article.id } : { surface: 'social-post', postId: post!.id },
      'replace',
    );
  }

  const article = useCreatorArticleWorkflow({
    creationItems: options.data.creationItems,
    getCreationDraftCommitIdentity: options.captureDraftCommitIdentity,
    inspirationStashes: options.data.inspirationStashes ?? [],
    locale: options.locale,
    notify: options.notify,
    onDraftArticleCreated: (created) => finishDraftContent({ article: created }),
    onOpenArticle: openArticle,
    onOpenSocialPost: openSocialPost,
    refresh: options.refresh,
  });
  const socialPost = useCreatorSocialPostWorkflow({
    creationItems: options.data.creationItems,
    getCreationDraftCommitIdentity: options.captureDraftCommitIdentity,
    inspirationStashes: options.data.inspirationStashes ?? [],
    locale: options.locale,
    notify: options.notify,
    onDraftSocialPostCreated: (created) => finishDraftContent({ post: created }),
    onOpenArticle: openArticle,
    onOpenSocialPost: openSocialPost,
    refresh: options.refresh,
  });
  const outcome = useCreatorOutcomeWorkflow({
    captureDraftSaveSnapshot: options.captureDraftSaveSnapshot,
    captureSnapshot() {
      const prompt = options.capturePrompt();
      const resolution = resolveCreatorPrompt({
        manualPrompt: prompt.manualPrompt,
        promptNodes: prompt.nodes,
        selectedTerms: prompt.selectedTerms,
        appliedPalettes: prompt.appliedPalettes,
        termPromptLocale: options.termPromptLocale,
        promptProfileId: options.promptProfileId,
      });
      return {
        automaticChangeSummary: options.automaticChangeSummary,
        livePrompt: resolution.livePrompt,
        locale: options.locale,
        prompt,
        referenceAssets: [...options.referenceAssets],
        resolvedPrompt: resolution.composition,
        savedDraftTitle: options.getSavedDraftTitle(),
        sourceInspirationStashId: options.selectedInspirationStashId,
        targetAlbumId: options.targetAlbumId,
        termPromptLocale: options.termPromptLocale,
        typedTitle: options.newTitle.trim(),
      };
    },
    createArticleFromDraft: article.createArticleFromDraft,
    createSocialPostFromDraft: socialPost.createSocialPostFromDraft,
    invalidateAutosaves: options.invalidateAutosaves,
    notify: options.notify,
    onImageCommitted(result) {
      options.replaceDraftSession(null);
      options.setTargetAlbumId(null);
      options.setSelectedSocialPostId(null);
      options.setSelectedArticleId(null);
      options.setSelectedInspirationStashId(null);
      options.clearSavedInspiration();
      options.setSelectedIdeaCreationId(null);
      options.setOutputMode('results');
      options.setSelectedAlbumId(null);
      options.setCreationMode('existing');
      options.setSeriesId(result.seriesId);
      options.setOutputSeriesId(result.seriesId);
      options.setVersionId(result.versionId);
      options.setOutputCollapsed(false);
      options.setCompactPanel('output');
      options.commit({ surface: 'existing-creation', seriesId: result.seriesId, assetId: null }, 'replace');
    },
    onPromptCaptured: options.synchronizePrompt,
    refresh: options.refresh,
    requestIdentity: options.generationRequestIdentity,
    saveCapturedDraft: options.saveCapturedDraft,
    saveDraft: options.saveDraft,
  });
  const seriesIds = useMemo(() => new Set(options.data.series.map((item) => item.id)), [options.data.series]);
  const derivedVisual = useDerivedVisualWorkflow({
    canvasPresets: options.data.canvasPresets,
    captureSelectionIdentity: () => options.generationRequestIdentity,
    creationDraftId: options.data.creationDraft?.id ?? null,
    creationItems: options.data.creationItems,
    derivedVisuals: options.data.derivedVisuals ?? [],
    locale: options.locale,
    notify: options.notify,
    onAdoptedArticle(created) {
      options.setSelectedSocialPostId(null);
      options.setSelectedArticleId(created.id);
      options.setCompactPanel('creator');
      options.commit({ surface: 'article', articleId: created.id }, 'replace');
    },
    onAdoptedSocialPost(created) {
      options.setSelectedArticleId(null);
      options.setSelectedSocialPostId(created.id);
      options.setCompactPanel('creator');
      options.commit({ surface: 'social-post', postId: created.id }, 'replace');
    },
    onKeepAdoptedWorkspace: options.setRequestedAssetId,
    onOpenWorkspace: options.onOpenDerivedVisualWorkspace,
    preserveBeforeNavigation: options.preserveBeforeNavigation,
    promptTemplates: options.data.derivedVisualPrompts,
    refresh: options.refresh,
    seriesIds,
    stayInWorkspace: (visualId) => options.editorSocialCoverVisualId === visualId,
  });

  return { article, derivedVisual, outcome, socialPost };
}
