import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArticleContentInput,
  ArticleDto,
  CanvasPresetDto,
  CreationItemDto,
  DerivedVisualAdoptResult,
  DerivedVisualDto,
  DerivedVisualPromptTemplatesDto,
  DerivedVisualWorkspaceOpenResult,
  Locale,
  SocialPostContentInput,
  SocialPostDto,
} from '@/shared/contracts';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import {
  buildArticleHeaderPrompt,
  buildArticleInlinePrompt,
  buildSocialCoverPrompt,
} from '@/renderer/components/creator/derivedVisualPrompt';
import {
  derivedVisualCanvasPresetKeys,
  derivedVisualWorkspaceAvailable,
} from '@/renderer/components/creator/derivedVisualWorkspace';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  canvasPresets: readonly CanvasPresetDto[];
  captureSelectionIdentity(): string;
  creationDraftId: string | null;
  creationItems: readonly CreationItemDto[];
  derivedVisuals: readonly DerivedVisualDto[];
  locale: Locale;
  notify(message: string): void;
  onAdoptedArticle(article: ArticleDto): void;
  onAdoptedSocialPost(post: SocialPostDto): void;
  onKeepAdoptedWorkspace(imageAssetId: string): void;
  onOpenWorkspace(result: DerivedVisualWorkspaceOpenResult): void;
  preserveBeforeNavigation(): Promise<boolean>;
  promptTemplates: DerivedVisualPromptTemplatesDto | undefined;
  refresh(): Promise<void>;
  seriesIds: ReadonlySet<string>;
  stayInWorkspace(visualId: string): boolean;
}

function articleContentSnapshot(content: ArticleContentInput): ArticleContentInput {
  return {
    ...content,
    mediaBindings: content.mediaBindings.map((binding) => ({ ...binding })),
  };
}

function socialPostContentSnapshot(content: SocialPostContentInput): SocialPostContentInput {
  return {
    ...content,
    mediaAssetIds: [...content.mediaAssetIds],
  };
}

function socialPostContent(post: SocialPostDto): SocialPostContentInput {
  const { mediaAssets: _mediaAssets, ...content } = post.content;
  return socialPostContentSnapshot(content);
}

function adoptedMessage(result: DerivedVisualAdoptResult, locale: Locale) {
  if (locale === 'zh') {
    if (result.visual.role === 'ARTICLE_HEADER') return '已设为文章题图';
    if (result.visual.role === 'ARTICLE_INLINE') return '已插入文章正文';
    return '已设为贴图首图';
  }
  if (result.visual.role === 'ARTICLE_HEADER') return 'Article hero updated';
  if (result.visual.role === 'ARTICLE_INLINE') return 'Illustration inserted in the article';
  return 'Social cover updated';
}

export function useDerivedVisualWorkflow(options: Options) {
  const [creatingSocialCoverScheme, setCreatingSocialCoverScheme] = useState(false);
  const creatingSocialCoverSchemeRef = useRef(false);
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const canvasPresets = useMemo(() => [...options.canvasPresets], [options.canvasPresets]);
  const captureSelectionIdentity = useStableCallback(options.captureSelectionIdentity);
  const notify = useStableCallback(options.notify);
  const onAdoptedArticle = useStableCallback(options.onAdoptedArticle);
  const onAdoptedSocialPost = useStableCallback(options.onAdoptedSocialPost);
  const onKeepAdoptedWorkspace = useStableCallback(options.onKeepAdoptedWorkspace);
  const onOpenWorkspace = useStableCallback(options.onOpenWorkspace);
  const preserveBeforeNavigation = useStableCallback(options.preserveBeforeNavigation);
  const refresh = useStableCallback(options.refresh);
  const stayInWorkspace = useStableCallback(options.stayInWorkspace);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
    };
  }, []);

  function promptTemplates() {
    const templates = options.promptTemplates;
    if (!templates?.articleHeader || !templates.articleInline || !templates.socialCover) {
      throw new Error(options.locale === 'zh' ? '配图提示词配置不可用' : 'Visual prompt configuration is unavailable');
    }
    return templates;
  }

  const finishOpen = useStableCallback(
    async (
      result: DerivedVisualWorkspaceOpenResult,
      operationGeneration: number,
      selectionIdentity: string,
      message?: string,
    ) => {
      await refresh();
      if (
        !mountedRef.current ||
        operationGenerationRef.current !== operationGeneration ||
        captureSelectionIdentity() !== selectionIdentity
      )
        return;
      onOpenWorkspace(result);
      if (message) notify(message);
    },
  );

  const openArticleHeaderWorkspace = useStableCallback(async (article: ArticleDto, content: ArticleContentInput) => {
    const operationGeneration = ++operationGenerationRef.current;
    const selectionIdentity = captureSelectionIdentity();
    const source = creationFormByEntity(options.creationItems, 'ARTICLE', article.id);
    if (!source) throw new Error(options.locale === 'zh' ? '题图来源不可用' : 'Hero source is unavailable');
    const preset = canvasPresets.find((item) => item.stableKey === 'wechat_article_cover_2_35_1');
    if (!preset)
      throw new Error(options.locale === 'zh' ? '公众号题图画幅不可用' : 'WeChat hero canvas is unavailable');
    const snapshot = articleContentSnapshot(content);
    const prompt = buildArticleHeaderPrompt(promptTemplates(), snapshot.title, snapshot.markdown);
    const result = await window.desktopApi.derivedVisualWorkspaceOpen({
      mode: 'CREATE',
      role: 'ARTICLE_HEADER',
      sourceFormId: source.form.id,
      articleId: article.id,
      articleRevisionId: article.revisionId,
      prompt,
      canvasPresetKey: preset.stableKey,
      locale: options.locale,
    });
    await finishOpen(
      result,
      operationGeneration,
      selectionIdentity,
      options.locale === 'zh' ? '已打开题图创作' : 'Hero creation opened',
    );
  });

  const openArticleIllustrationWorkspace = useStableCallback(
    async (article: ArticleDto, content: ArticleContentInput, selectedText: string, preset: CanvasPresetDto) => {
      const operationGeneration = ++operationGenerationRef.current;
      const selectionIdentity = captureSelectionIdentity();
      const snapshot = articleContentSnapshot(content);
      const anchorText = selectedText.trim();
      const first = snapshot.markdown.indexOf(anchorText);
      if (!anchorText || first < 0 || first !== snapshot.markdown.lastIndexOf(anchorText)) {
        throw new Error(
          options.locale === 'zh'
            ? '请选择当前文章中一段唯一的连续文字'
            : 'Select one unique continuous passage in the current article',
        );
      }
      const existingWorkspace = options.derivedVisuals.find(
        (visual) =>
          visual.role === 'ARTICLE_INLINE' &&
          visual.articleId === article.id &&
          visual.anchor?.selectedText === anchorText &&
          derivedVisualWorkspaceAvailable(visual, options.seriesIds, options.creationDraftId),
      );
      if (existingWorkspace) {
        const result = await window.desktopApi.derivedVisualWorkspaceOpen({
          mode: 'RESUME',
          visualId: existingWorkspace.id,
        });
        await finishOpen(
          result,
          operationGeneration,
          selectionIdentity,
          options.locale === 'zh' ? '已继续正文配图创作' : 'Illustration creation resumed',
        );
        return;
      }
      const source = creationFormByEntity(options.creationItems, 'ARTICLE', article.id);
      if (!source) throw new Error(options.locale === 'zh' ? '配图来源不可用' : 'Illustration source is unavailable');
      const prompt = buildArticleInlinePrompt(promptTemplates(), preset, snapshot.title, anchorText, snapshot.markdown);
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'CREATE',
        role: 'ARTICLE_INLINE',
        sourceFormId: source.form.id,
        articleId: article.id,
        articleRevisionId: article.revisionId,
        prompt,
        canvasPresetKey: preset.stableKey,
        locale: options.locale,
        anchor: { selectedText: anchorText },
      });
      await finishOpen(
        result,
        operationGeneration,
        selectionIdentity,
        options.locale === 'zh' ? '已打开正文配图创作' : 'Illustration creation opened',
      );
    },
  );

  const openSocialCoverWorkspace = useStableCallback(
    async (post: SocialPostDto, content: SocialPostContentInput, preset: CanvasPresetDto) => {
      const operationGeneration = ++operationGenerationRef.current;
      const selectionIdentity = captureSelectionIdentity();
      const source = creationFormByEntity(options.creationItems, 'SOCIAL_POST', post.id);
      if (!source) throw new Error(options.locale === 'zh' ? '封面来源不可用' : 'Cover source is unavailable');
      const snapshot = socialPostContentSnapshot(content);
      const prompt = buildSocialCoverPrompt(promptTemplates(), preset, snapshot.title, snapshot.body);
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'CREATE',
        role: 'SOCIAL_POST_COVER',
        sourceFormId: source.form.id,
        socialPostId: post.id,
        socialPostRevisionId: post.revisionId,
        prompt,
        canvasPresetKey: preset.stableKey,
        locale: options.locale,
      });
      await finishOpen(
        result,
        operationGeneration,
        selectionIdentity,
        options.locale === 'zh' ? '已打开封面创作' : 'Cover creation opened',
      );
    },
  );

  const createSocialCoverScheme = useStableCallback(
    async (post: SocialPostDto, currentPreset: CanvasPresetDto | null) => {
      if (creatingSocialCoverSchemeRef.current) return;
      creatingSocialCoverSchemeRef.current = true;
      setCreatingSocialCoverScheme(true);
      const selectionIdentity = captureSelectionIdentity();
      try {
        if (!(await preserveBeforeNavigation()) || captureSelectionIdentity() !== selectionIdentity) return;
        const allowedKeys = new Set(derivedVisualCanvasPresetKeys.SOCIAL_POST_COVER);
        const preset =
          (currentPreset && allowedKeys.has(currentPreset.stableKey) ? currentPreset : null) ??
          canvasPresets.find((candidate) => candidate.stableKey === 'xiaohongshu_portrait_3_4');
        if (!preset) {
          notify(options.locale === 'zh' ? '贴图封面画幅不可用' : 'Social cover canvas is unavailable');
          return;
        }
        await openSocialCoverWorkspace(post, socialPostContent(post), preset);
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : String(reason));
      } finally {
        creatingSocialCoverSchemeRef.current = false;
        if (mountedRef.current) setCreatingSocialCoverScheme(false);
      }
    },
  );

  const resumeDerivedVisual = useStableCallback(async (visualId: string) => {
    const selectionIdentity = captureSelectionIdentity();
    try {
      if (!(await preserveBeforeNavigation()) || captureSelectionIdentity() !== selectionIdentity) return;
      const operationGeneration = ++operationGenerationRef.current;
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({ mode: 'RESUME', visualId });
      await finishOpen(result, operationGeneration, selectionIdentity);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  });

  const adoptDerivedVisual = useStableCallback(async (visualId: string, imageAssetId: string) => {
    const operationGeneration = ++operationGenerationRef.current;
    const selectionIdentity = captureSelectionIdentity();
    const keepWorkspace = stayInWorkspace(visualId);
    const result = await window.desktopApi.derivedVisualAdopt({ id: visualId, imageAssetId });
    await refresh();
    if (
      !mountedRef.current ||
      operationGenerationRef.current !== operationGeneration ||
      captureSelectionIdentity() !== selectionIdentity
    )
      return;
    if (keepWorkspace) {
      onKeepAdoptedWorkspace(imageAssetId);
      notify(adoptedMessage(result, options.locale));
      return;
    }
    if (result.article) {
      onAdoptedArticle(result.article);
      notify(adoptedMessage(result, options.locale));
    } else if (result.socialPost) {
      onAdoptedSocialPost(result.socialPost);
      notify(adoptedMessage(result, options.locale));
    }
  });

  return {
    adoptDerivedVisual,
    createSocialCoverScheme,
    creatingSocialCoverScheme,
    openArticleHeaderWorkspace,
    openArticleIllustrationWorkspace,
    openSocialCoverWorkspace,
    resumeDerivedVisual,
  };
}
