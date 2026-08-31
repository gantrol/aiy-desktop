import type {
  ArticleDto,
  BootstrapDto,
  CanvasPresetDto,
  CreationDictionaryScopeDto,
  CreationDraftDto,
  CreatorPromptNodeInput,
  DerivedVisualDto,
  DerivedVisualWorkspaceOpenResult,
  Locale,
  PromptVersionDto,
  SocialPostDto,
} from '@/shared/contracts';
import type { RefObject } from 'react';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { replaceCreatorPromptText } from '@/renderer/components/creator/creatorPromptDocument';
import {
  buildArticleHeaderPrompt,
  buildArticleInlinePrompt,
  buildSocialCoverPrompt,
} from '@/renderer/components/creator/derivedVisualPrompt';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  data: Pick<BootstrapDto, 'articles' | 'derivedVisualPrompts' | 'series' | 'socialPosts'>;
  editorDerivedVisual: DerivedVisualDto | null;
  locale: Locale;
  notify(message: string): void;
  onComparisonFullWindowChange(open: boolean): void;
  preserveParentSelection: boolean;
  promptNodesRef: RefObject<CreatorPromptNodeInput[]>;
  replaceDraftSession(draft: null): void;
  resetInputs(): void;
  restoreAssistant(scope: { kind: 'DRAFT'; id: string }): void;
  restoreDraft(draft: CreationDraftDto): void;
  restoreVersion(version: PromptVersionDto | undefined): void;
  selectedArticle: ArticleDto | null;
  selectedSocialPost: SocialPostDto | null;
  selectArticle(id: string): void;
  selectSocialPost(id: string): void;
  setCanvasPresetKey(key: string): void;
  setCompactPanel(panel: 'output'): void;
  setCreationMode(mode: 'existing' | 'new'): void;
  setDictionaryScope(scope: CreationDictionaryScopeDto): void;
  setDismissedDerivedVisualId(id: string | null): void;
  setOutputCollapsed(collapsed: boolean): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputMode(mode: CreationOutputMode): void;
  setOutputSeriesId(id: string | null): void;
  setRequestedAssetId(id: string | null): void;
  setSeriesId(id: string | null): void;
  setTargetAlbumId(id: string | null): void;
  setVersionId(id: string): void;
  setVideoCreationRequest(value: null): void;
  updatePromptDocument(nodes: CreatorPromptNodeInput[]): void;
}

export function useDerivedVisualWorkspaceNavigation(options: Options) {
  const changePrompt = useStableCallback((prompt: string) => {
    options.updatePromptDocument(replaceCreatorPromptText(options.promptNodesRef.current, prompt));
  });

  const openDraftWorkspace = useStableCallback((draft: CreationDraftDto) => {
    options.onComparisonFullWindowChange(false);
    if (!options.preserveParentSelection) options.clearSelection();
    options.clearSavedInspiration();
    options.setOutputMode('results');
    options.setVideoCreationRequest(null);
    options.setCreationMode('new');
    options.setSeriesId(null);
    options.setOutputSeriesId(null);
    options.setVersionId('');
    options.setRequestedAssetId(null);
    options.setOutputGalleryOpen(false);
    options.resetInputs();
    options.restoreDraft(draft);
    options.restoreAssistant({ kind: 'DRAFT', id: draft.id });
    options.setDismissedDerivedVisualId(null);
    options.setOutputCollapsed(false);
    options.setCompactPanel('output');
  });

  const openSeriesWorkspace = useStableCallback(
    (
      visual: DerivedVisualDto,
      hostSeriesId: string,
      workspace: { outputSeriesId?: string; assetId?: string; prompt?: string; canvasPreset?: CanvasPresetDto } = {},
    ) => {
      const hostSeries = options.data.series.find((candidate) => candidate.id === hostSeriesId);
      if (!hostSeries || visual.promptSeriesId !== hostSeries.id) {
        throw new Error(
          options.locale === 'zh' ? '派生创作工作区不可用' : 'The derived creation workspace is unavailable',
        );
      }
      const targetVersion =
        hostSeries.versions.find((candidate) => candidate.id === hostSeries.currentVersionId) ?? hostSeries.versions[0];
      const targetArticle = visual.articleId
        ? (options.data.articles ?? []).find((article) => article.id === visual.articleId)
        : null;
      const targetPost = visual.socialPostId
        ? (options.data.socialPosts ?? []).find((post) => post.id === visual.socialPostId)
        : null;
      if (!targetArticle && !targetPost) {
        throw new Error(options.locale === 'zh' ? '父创作不可用' : 'The parent creation is unavailable');
      }
      options.replaceDraftSession(null);
      options.onComparisonFullWindowChange(false);
      if (targetArticle) options.selectArticle(targetArticle.id);
      else if (targetPost) options.selectSocialPost(targetPost.id);
      options.clearSavedInspiration();
      options.setTargetAlbumId(null);
      options.setOutputMode('results');
      options.setVideoCreationRequest(null);
      options.setCreationMode('existing');
      options.setSeriesId(hostSeries.id);
      options.setOutputSeriesId(workspace.outputSeriesId ?? hostSeries.id);
      options.setVersionId(targetVersion?.id ?? '');
      options.setRequestedAssetId(workspace.assetId ?? null);
      options.setOutputGalleryOpen(false);
      options.setDictionaryScope(emptyCreationDictionaryScope());
      options.resetInputs();
      options.restoreVersion(targetVersion);
      if (workspace.canvasPreset) options.setCanvasPresetKey(workspace.canvasPreset.stableKey);
      if (workspace.prompt) changePrompt(workspace.prompt);
      options.setDismissedDerivedVisualId(null);
      options.setOutputCollapsed(false);
      options.setCompactPanel('output');
      options.commit(
        targetArticle
          ? { surface: 'article', articleId: targetArticle.id }
          : { surface: 'social-post', postId: targetPost!.id },
        'replace',
      );
    },
  );

  const openWorkspace = useStableCallback((result: DerivedVisualWorkspaceOpenResult) => {
    if (result.kind === 'DRAFT') openDraftWorkspace(result.draft);
    else
      openSeriesWorkspace(result.visual, result.seriesId, {
        assetId: result.visual.selectedImageAssetId ?? undefined,
      });
  });

  const changeCanvas = useStableCallback((preset: CanvasPresetDto) => {
    const visual = options.editorDerivedVisual;
    if (!visual) return;
    try {
      const templates = options.data.derivedVisualPrompts;
      if (!templates?.articleHeader || !templates.articleInline || !templates.socialCover) {
        throw new Error(
          options.locale === 'zh' ? '配图提示词配置不可用' : 'Visual prompt configuration is unavailable',
        );
      }
      let prompt: string;
      if (visual.role === 'ARTICLE_HEADER') {
        if (!options.selectedArticle) return;
        prompt = buildArticleHeaderPrompt(
          templates,
          options.selectedArticle.content.title,
          options.selectedArticle.content.markdown,
        );
      } else if (visual.role === 'ARTICLE_INLINE') {
        if (!options.selectedArticle || !visual.anchor) return;
        prompt = buildArticleInlinePrompt(
          templates,
          preset,
          options.selectedArticle.content.title,
          visual.anchor.selectedText,
          options.selectedArticle.content.markdown,
        );
      } else {
        if (!options.selectedSocialPost) return;
        prompt = buildSocialCoverPrompt(
          templates,
          preset,
          options.selectedSocialPost.content.title,
          options.selectedSocialPost.content.body,
        );
      }
      options.setCanvasPresetKey(preset.stableKey);
      changePrompt(prompt);
    } catch (reason) {
      options.notify(reason instanceof Error ? reason.message : String(reason));
    }
  });

  return { changeCanvas, changePrompt, openDraftWorkspace, openSeriesWorkspace, openWorkspace };
}
