import type {
  ArticleContentInput,
  ArticleDto,
  ArticleRevisionSaveInput,
  ArticleWechatCopyOptions,
  CreationItemDto,
  InspirationStashDto,
  Locale,
  SocialPostDto,
} from '@/shared/contracts';
import {
  emptyArticleContent,
  emptySocialPostContent,
  socialPostBodyFromMarkdown,
} from '@/renderer/components/creator/article-editor/articleContentTransforms';
import { creationFormByEntity, creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  creationItems: readonly CreationItemDto[];
  getCreationDraftCommitIdentity(): string | null;
  inspirationStashes: readonly InspirationStashDto[];
  locale: Locale;
  notify(message: string): void;
  onDraftArticleCreated(article: ArticleDto): void;
  onOpenArticle(article: ArticleDto): void;
  onOpenSocialPost(post: SocialPostDto): void;
  refresh(): Promise<void>;
}

interface CreateArticleFromDraftInput {
  content: ArticleContentInput;
  creationDraftId: string;
  creationDraftCommitIdentity: string;
  sourceInspirationStashId: string | null;
  targetAlbumId: string | null;
}

function articleContentSnapshot(content: ArticleContentInput): ArticleContentInput {
  return {
    ...content,
    mediaBindings: content.mediaBindings.map((binding) => ({ ...binding })),
  };
}

export function useCreatorArticleWorkflow(options: Options) {
  const saveArticleRevision = useStableCallback((input: ArticleRevisionSaveInput) =>
    window.desktopApi.articleRevisionSave(input),
  );
  const getCreationDraftCommitIdentity = useStableCallback(options.getCreationDraftCommitIdentity);
  const notify = useStableCallback(options.notify);
  const onDraftArticleCreated = useStableCallback(options.onDraftArticleCreated);
  const openArticle = useStableCallback(options.onOpenArticle);
  const openSocialPost = useStableCallback(options.onOpenSocialPost);
  const refresh = useStableCallback(options.refresh);

  function activeSourceId(sourceId: string | null) {
    return sourceId && options.inspirationStashes.some((stash) => stash.id === sourceId) ? sourceId : null;
  }

  function formId(kind: 'ARTICLE' | 'SOCIAL_POST', entityId: string) {
    const context = creationFormByEntity(options.creationItems, kind, entityId);
    if (!context) {
      throw new Error(options.locale === 'zh' ? '所属创作项不可用' : 'The containing creation item is unavailable');
    }
    return context.form.id;
  }

  const finishArticle = useStableCallback(async (article: ArticleDto, message: string) => {
    await refresh();
    openArticle(article);
    notify(message);
  });

  const finishSocialPost = useStableCallback(async (post: SocialPostDto, message: string) => {
    await refresh();
    openSocialPost(post);
    notify(message);
  });

  const exportMarkdown = useStableCallback(async (articleId: string) => {
    const result = await window.desktopApi.articleExportMarkdown({ id: articleId });
    if (result.status === 'SAVED') notify(options.locale === 'zh' ? '已导出 Markdown' : 'Markdown exported');
  });

  const copyForWechat = useStableCallback(async (articleId: string, copyOptions: ArticleWechatCopyOptions) => {
    const result = await window.desktopApi.articleCopyForWechat({ id: articleId, ...copyOptions });
    const referenceNotice =
      result.endReferenceCount > 0
        ? options.locale === 'zh'
          ? `；${result.endReferenceCount} 个链接已转为文末引用`
          : `; ${result.endReferenceCount} link${result.endReferenceCount === 1 ? '' : 's'} converted to end references`
        : '';
    const imageNotice =
      result.remoteImageCount > 0
        ? options.locale === 'zh'
          ? `；${result.remoteImageCount} 张网络图片需在公众号中确认`
          : `; check ${result.remoteImageCount} remote image${result.remoteImageCount === 1 ? '' : 's'} in WeChat`
        : '';
    notify(
      options.locale === 'zh'
        ? `已复制公众号正文${referenceNotice}${imageNotice}`
        : `WeChat article body copied${referenceNotice}${imageNotice}`,
    );
  });

  const createArticleFromArticle = useStableCallback(
    async (sourceArticle: ArticleDto, content: ArticleContentInput, copySourceContent: boolean) => {
      const article = await window.desktopApi.articleFormCreate({
        sourceFormId: formId('ARTICLE', sourceArticle.id),
        sourceInspirationStashId: activeSourceId(sourceArticle.sourceInspirationStashId),
        content: copySourceContent ? content : emptyArticleContent(),
      });
      await finishArticle(
        article,
        copySourceContent
          ? options.locale === 'zh'
            ? '已克隆文章'
            : 'Article forked'
          : options.locale === 'zh'
            ? '已新建文章'
            : 'Article created',
      );
    },
  );

  const createSocialPostFromArticle = useStableCallback(
    async (article: ArticleDto, content: ArticleContentInput, copySourceContent: boolean) => {
      const post = await window.desktopApi.socialPostFormCreate({
        sourceFormId: formId('ARTICLE', article.id),
        sourceInspirationStashId: activeSourceId(article.sourceInspirationStashId),
        content: copySourceContent
          ? {
              schemaVersion: 1,
              title: content.title,
              body: socialPostBodyFromMarkdown(content.markdown),
              mediaAssetIds: content.mediaBindings.map((binding) => binding.assetId),
              coverAssetId: content.coverAssetId,
            }
          : emptySocialPostContent(),
      });
      await finishSocialPost(
        post,
        copySourceContent
          ? options.locale === 'zh'
            ? '已转为贴图'
            : 'Converted to social post'
          : options.locale === 'zh'
            ? '已新建贴图'
            : 'Social post created',
      );
    },
  );

  const createArticleFromDraft = useStableCallback(async (input: CreateArticleFromDraftInput) => {
    const snapshot = {
      ...input,
      content: articleContentSnapshot(input.content),
    };
    const sourceItem = snapshot.sourceInspirationStashId
      ? creationItemByFormEntity(options.creationItems, 'INSPIRATION_STASH', snapshot.sourceInspirationStashId)
      : null;
    if (snapshot.sourceInspirationStashId && !sourceItem) {
      throw new Error(
        options.locale === 'zh' ? '灵感所属创作项不可用' : 'The inspiration creation item is unavailable',
      );
    }
    const article = sourceItem
      ? await window.desktopApi.articleFormAdd({
          creationItemId: sourceItem.id,
          sourceInspirationStashId: snapshot.sourceInspirationStashId,
          consumeCreationDraftId: snapshot.creationDraftId,
          content: snapshot.content,
        })
      : await window.desktopApi.articleSave({
          id: null,
          albumId: snapshot.targetAlbumId,
          sourceInspirationStashId: null,
          consumeCreationDraftId: snapshot.creationDraftId,
          content: snapshot.content,
        });
    await refresh();
    if (getCreationDraftCommitIdentity() !== snapshot.creationDraftCommitIdentity) return;
    onDraftArticleCreated(article);
    notify(options.locale === 'zh' ? '已创建文章' : 'Article created');
  });

  const renameArticle = useStableCallback(async (article: ArticleDto, title: string) => {
    await window.desktopApi.articleRename({ id: article.id, title });
    await refresh();
    notify(options.locale === 'zh' ? '文章标题已更新' : 'Article title updated');
  });

  return {
    copyForWechat,
    createArticleFromArticle,
    createArticleFromDraft,
    createSocialPostFromArticle,
    exportMarkdown,
    renameArticle,
    saveArticleRevision,
  };
}
