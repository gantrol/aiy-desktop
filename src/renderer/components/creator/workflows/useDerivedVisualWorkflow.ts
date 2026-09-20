import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArticleContentInput,
  ArticleDto,
  CanvasPresetDto,
  CreationItemDto,
  DerivedVisualAdoptInput,
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
  derivedVisualWorkspaceAvailable,
  DerivedVisualViewUnavailableError,
  type DerivedVisualWorkspaceViewState,
} from '@/renderer/components/creator/derivedVisualWorkspace';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DerivedVisualOperationRequest } from '@/shared/contracts/derived-visual-operations';
import { articleIllustrationInsertionOffset } from '@/shared/article-wechat-renderer';
import { ARTICLE_COVER_PRESET_KEYS, type ArticleCoverRatio } from '@/shared/article-covers';
import { useWorkspaceVisualResume } from '@/renderer/components/workspace/WorkspaceVisualResumeProvider';

interface Options {
  spaceId: string;
  articles: readonly ArticleDto[];
  socialPosts: readonly SocialPostDto[];
  canvasPresets: readonly CanvasPresetDto[];
  captureSelectionIdentity(): string;
  creationDraftId: string | null;
  creationItems: readonly CreationItemDto[];
  derivedVisuals: readonly DerivedVisualDto[];
  locale: Locale;
  notify(message: string): void;
  onKeepAdoptedWorkspace(imageAssetId: string): void;
  onOpenWorkspace(result: DerivedVisualWorkspaceOpenResult, view?: DerivedVisualWorkspaceViewState): void;
  preserveBeforeNavigation(): Promise<boolean>;
  promptTemplates: DerivedVisualPromptTemplatesDto | undefined;
  refresh(): Promise<void>;
  seriesIds: ReadonlySet<string>;
  stayInWorkspace(visualId: string): boolean;
}

interface ResumeFailure {
  visualId: string;
  spaceId: string;
  selectionIdentity: string;
  operationGeneration: number;
  message: string;
}

function resumeFailureForSelection(failure: ResumeFailure | null, spaceId: string, selectionIdentity: string) {
  return failure?.spaceId === spaceId && failure.selectionIdentity === selectionIdentity ? failure : null;
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

function adoptedMessage(
  visual: DerivedVisualDto,
  labels: MessageCatalog['creator']['derivedVisual'],
  intent: DerivedVisualAdoptInput['intent'],
) {
  if (visual.role === 'ARTICLE_HEADER') return labels.heroAdopted;
  if (visual.role === 'ARTICLE_INLINE') return labels.illustrationAdopted;
  return intent === 'SET_COVER_AND_FIRST' ? labels.coverAndFirstAdopted : labels.coverAdopted;
}

function requiredPromptTemplates(options: Options, unavailableMessage: string) {
  const templates = options.promptTemplates;
  if (!templates?.articleHeader || !templates.articleInline || !templates.socialCover) {
    throw new Error(unavailableMessage);
  }
  return templates;
}

export function useDerivedVisualWorkflow(options: Options) {
  const findResumeView = useWorkspaceVisualResume(options.spaceId);
  const labels = useI18n().messages.creator.derivedVisual;
  const [creatingDerivedScheme, setCreatingDerivedScheme] = useState(false);
  const [resumeFailure, setResumeFailure] = useState<ResumeFailure | null>(null);
  const creatingDerivedSchemeRef = useRef(false);
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const canvasPresets = useMemo(() => [...options.canvasPresets], [options.canvasPresets]);
  const captureSelectionIdentity = useStableCallback(options.captureSelectionIdentity);
  const notify = useStableCallback(options.notify);
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

  const promptTemplates = () => requiredPromptTemplates(options, labels.promptConfigurationUnavailable);

  const finishOpen = useStableCallback(
    async (
      result: DerivedVisualWorkspaceOpenResult,
      operationGeneration: number,
      selectionIdentity: string,
      message?: string,
      view?: DerivedVisualWorkspaceViewState,
    ) => {
      await refresh();
      if (
        !mountedRef.current ||
        operationGenerationRef.current !== operationGeneration ||
        captureSelectionIdentity() !== selectionIdentity
      )
        return;
      const remembered = !view && result.kind === 'SERIES' ? findResumeView(result.visual.id) : undefined;
      const resumeView = remembered?.seriesId === result.visual.promptSeriesId ? remembered : undefined;
      try {
        onOpenWorkspace(result, view ?? resumeView);
      } catch (reason) {
        if (!(reason instanceof DerivedVisualViewUnavailableError)) throw reason;
        setResumeFailure({
          visualId: result.visual.id,
          spaceId: options.spaceId,
          selectionIdentity,
          operationGeneration,
          message: reason.message,
        });
        return;
      }
      setResumeFailure(null);
      if (message) notify(message);
    },
  );

  const openArticleHeaderWorkspace = useStableCallback(
    async (article: ArticleDto, content: ArticleContentInput, coverRatio?: ArticleCoverRatio) => {
      const operationGeneration = ++operationGenerationRef.current;
      const selectionIdentity = captureSelectionIdentity();
      const source = creationFormByEntity(options.creationItems, 'ARTICLE', article.id);
      if (!source) throw new Error(labels.heroSourceUnavailable);
      const preset = canvasPresets.find(
        (item) => item.stableKey === (coverRatio ? ARTICLE_COVER_PRESET_KEYS[coverRatio] : 'xiaohongshu_portrait_3_4'),
      );
      if (!preset) throw new Error(labels.heroCanvasUnavailable);
      const snapshot = articleContentSnapshot(content);
      const prompt = buildArticleHeaderPrompt(promptTemplates(), snapshot.title, snapshot.markdown, preset);
      const roleLabel = labels.targetRoles.ARTICLE_HEADER + (coverRatio ? ` ${coverRatio}` : '');
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'CREATE',
        role: 'ARTICLE_HEADER',
        ...(coverRatio ? { coverRatio } : {}),
        workspaceTitle: `${snapshot.title || labels.untitled} · ${roleLabel}`.slice(0, 300),
        sourceFormId: source.form.id,
        articleId: article.id,
        articleRevisionId: article.revisionId,
        prompt,
        canvasPresetKey: preset.stableKey,
        locale: options.locale,
      });
      await finishOpen(result, operationGeneration, selectionIdentity, labels.heroOpened);
    },
  );

  const openArticleIllustrationWorkspace = useStableCallback(
    async (
      article: ArticleDto,
      content: ArticleContentInput,
      selectedText: string,
      preset: CanvasPresetDto,
      positionVisual?: DerivedVisualDto,
    ) => {
      const operationGeneration = ++operationGenerationRef.current;
      const selectionIdentity = captureSelectionIdentity();
      const snapshot = articleContentSnapshot(content);
      const anchorText = selectedText.trim();
      if (!positionVisual && articleIllustrationInsertionOffset(snapshot.markdown, anchorText) === null) {
        throw new Error(labels.uniquePassageRequired);
      }
      const existingWorkspace = options.derivedVisuals.find(
        (visual) =>
          visual.role === 'ARTICLE_INLINE' &&
          visual.articleId === article.id &&
          visual.anchor?.selectedText === anchorText &&
          derivedVisualWorkspaceAvailable(visual, options.seriesIds),
      );
      if (!positionVisual && existingWorkspace) {
        const result = await window.desktopApi.derivedVisualWorkspaceOpen({
          mode: 'RESUME',
          visualId: existingWorkspace.id,
        });
        await finishOpen(result, operationGeneration, selectionIdentity, labels.illustrationResumed);
        return;
      }
      const source = creationFormByEntity(options.creationItems, 'ARTICLE', article.id);
      if (!source) throw new Error(labels.illustrationSourceUnavailable);
      const prompt = buildArticleInlinePrompt(promptTemplates(), preset, snapshot.title, anchorText, snapshot.markdown);
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'CREATE',
        role: 'ARTICLE_INLINE',
        workspaceTitle: `${snapshot.title || labels.untitled} · ${labels.targetRoles.ARTICLE_INLINE}`.slice(0, 300),
        sourceFormId: source.form.id,
        articleId: article.id,
        articleRevisionId: article.revisionId,
        prompt,
        canvasPresetKey: preset.stableKey,
        locale: options.locale,
        anchor: { selectedText: anchorText },
        ...(positionVisual?.positionId ? { positionId: positionVisual.positionId } : {}),
      });
      await finishOpen(result, operationGeneration, selectionIdentity, labels.illustrationOpened);
    },
  );

  const openSocialCoverWorkspace = useStableCallback(
    async (post: SocialPostDto, content: SocialPostContentInput, preset: CanvasPresetDto) => {
      const operationGeneration = ++operationGenerationRef.current;
      const selectionIdentity = captureSelectionIdentity();
      const source = creationFormByEntity(options.creationItems, 'SOCIAL_POST', post.id);
      if (!source) throw new Error(labels.coverSourceUnavailable);
      const snapshot = socialPostContentSnapshot(content);
      const prompt = buildSocialCoverPrompt(promptTemplates(), preset, snapshot.title, snapshot.body);
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'CREATE',
        role: 'SOCIAL_POST_COVER',
        workspaceTitle: `${snapshot.title || labels.untitled} · ${labels.targetRoles.SOCIAL_POST_COVER}`.slice(0, 300),
        sourceFormId: source.form.id,
        socialPostId: post.id,
        socialPostRevisionId: post.revisionId,
        prompt,
        canvasPresetKey: preset.stableKey,
        locale: options.locale,
      });
      await finishOpen(result, operationGeneration, selectionIdentity, labels.coverOpened);
    },
  );

  const createDerivedScheme = useStableCallback(async (visualId: string) => {
    if (creatingDerivedSchemeRef.current) return;
    const visual = options.derivedVisuals.find((item) => item.id === visualId);
    if (!visual) return;
    creatingDerivedSchemeRef.current = true;
    setCreatingDerivedScheme(true);
    const selectionIdentity = captureSelectionIdentity();
    try {
      if (!(await preserveBeforeNavigation()) || captureSelectionIdentity() !== selectionIdentity) return;
      if (visual.role === 'ARTICLE_INLINE') {
        const article = options.articles.find((item) => item.id === visual.articleId);
        if (!article || !visual.anchor || !visual.positionId) throw new Error(labels.sourceArticleUnavailable);
        const preset = canvasPresets.find((candidate) => candidate.stableKey === 'landscape_4_3');
        if (!preset) throw new Error(labels.illustrationCanvasUnavailable);
        await openArticleIllustrationWorkspace(article, article.content, visual.anchor.selectedText, preset, visual);
        return;
      }
      if (visual.role === 'ARTICLE_HEADER') {
        const article = options.articles.find((item) => item.id === visual.articleId);
        if (!article) throw new Error(labels.sourceArticleUnavailable);
        await openArticleHeaderWorkspace(article, article.content, visual.coverRatio);
        return;
      }
      const post = options.socialPosts.find((item) => item.id === visual.socialPostId);
      if (!post) throw new Error(labels.sourcePostUnavailable);
      const preset = canvasPresets.find((candidate) => candidate.stableKey === 'xiaohongshu_portrait_3_4');
      if (!preset) {
        notify(labels.coverCanvasUnavailable);
        return;
      }
      await openSocialCoverWorkspace(post, socialPostContent(post), preset);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      creatingDerivedSchemeRef.current = false;
      if (mountedRef.current) setCreatingDerivedScheme(false);
    }
  });

  const resumeDerivedVisual = useStableCallback(async (visualId: string, view?: DerivedVisualWorkspaceViewState) => {
    const selectionIdentity = captureSelectionIdentity();
    try {
      if (!(await preserveBeforeNavigation()) || captureSelectionIdentity() !== selectionIdentity) return;
      setResumeFailure(null);
      const operationGeneration = ++operationGenerationRef.current;
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({ mode: 'RESUME', visualId });
      await finishOpen(result, operationGeneration, selectionIdentity, undefined, view);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  });

  const openCurrentDerivedVisual = useStableCallback(async () => {
    const failed = resumeFailureForSelection(resumeFailure, options.spaceId, captureSelectionIdentity());
    setResumeFailure(null);
    if (!failed || failed.operationGeneration !== operationGenerationRef.current) return;
    await resumeDerivedVisual(failed.visualId, { assetId: null });
  });

  const runDerivedVisualOperation = useStableCallback(async (request: DerivedVisualOperationRequest) => {
    const selectionIdentity = captureSelectionIdentity();
    if (request.spaceId !== options.spaceId) throw new Error(labels.targetUnavailable);
    if (!(await preserveBeforeNavigation()) || captureSelectionIdentity() !== selectionIdentity) return null;
    const result = await (async () => {
      if (request.kind === 'ADOPT') {
        const { kind: _kind, ...input } = request;
        return window.desktopApi.derivedVisualAdopt(input);
      }
      const { kind: _kind, ...input } = request;
      return window.desktopApi.derivedVisualUndo(input);
    })();
    // The durable operation result remains valid even if refreshing the workspace fails.
    if (result.status === 'SUCCEEDED') {
      void refresh().catch((reason) => notify(String(reason)));
      if (mountedRef.current && captureSelectionIdentity() === selectionIdentity) {
        const visual = options.derivedVisuals.find((item) => item.id === request.id);
        if (request.kind === 'ADOPT' && visual) {
          if (stayInWorkspace(request.id)) onKeepAdoptedWorkspace(request.imageAssetId);
          notify(adoptedMessage(visual, labels, request.intent));
        } else notify(labels.adoption.undone);
      }
    }
    return result;
  });

  return {
    runDerivedVisualOperation,
    createDerivedScheme,
    creatingDerivedScheme,
    openArticleHeaderWorkspace,
    openArticleIllustrationWorkspace,
    openSocialCoverWorkspace,
    resumeDerivedVisual,
    resumeFailure: resumeFailureForSelection(resumeFailure, options.spaceId, options.captureSelectionIdentity()),
    dismissResumeFailure: () => setResumeFailure(null),
    openCurrentDerivedVisual,
  };
}
