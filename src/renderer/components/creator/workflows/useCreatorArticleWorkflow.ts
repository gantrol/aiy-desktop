import { emptyArticleContent } from '@/renderer/components/creator/article-editor/articleContentTransforms';
import { creationFormByEntity, creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type {
  ArticleContentInput,
  ArticleDto,
  ArticleRevisionSaveInput,
  ArticleWechatCopyOptions,
  CreationItemDto,
  InspirationStashDto,
  Locale,
} from '@/shared/contracts';
import { captureBlockDocument } from '@/shared/contracts/block-document';

interface Options {
  creationItems: readonly CreationItemDto[];
  getCreationDraftCommitIdentity(): string | null;
  inspirationStashes: readonly InspirationStashDto[];
  locale: Locale;
  notify(message: string): void;
  onDraftArticleCreated(article: ArticleDto): void;
  onOpenArticle(article: ArticleDto): void;
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
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  const saveArticleRevision = useStableCallback((input: ArticleRevisionSaveInput) =>
    window.desktopApi.articleRevisionSave(input),
  );
  const getCreationDraftCommitIdentity = useStableCallback(options.getCreationDraftCommitIdentity);
  const notify = useStableCallback(options.notify);
  const onDraftArticleCreated = useStableCallback(options.onDraftArticleCreated);
  const openArticle = useStableCallback(options.onOpenArticle);
  const refresh = useStableCallback(options.refresh);

  function activeSourceId(sourceId: string | null) {
    return sourceId && options.inspirationStashes.some((stash) => stash.id === sourceId) ? sourceId : null;
  }

  function formId(entityId: string) {
    const context = creationFormByEntity(options.creationItems, 'ARTICLE', entityId);
    if (!context) {
      throw new Error(socialCopy.itemUnavailable);
    }
    return context.form.id;
  }

  const finishArticle = useStableCallback(async (article: ArticleDto, message: string) => {
    await refresh();
    openArticle(article);
    notify(message);
  });

  const exportMarkdown = useStableCallback(async (articleId: string) => {
    const result = await window.desktopApi.articleExportMarkdown({ id: articleId });
    if (result.status === 'SAVED') notify(socialCopy.markdownExported);
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
        sourceFormId: formId(sourceArticle.id),
        sourceInspirationStashId: activeSourceId(sourceArticle.sourceInspirationStashId),
        content: copySourceContent
          ? {
              ...content,
              ...(content.document ? { document: captureBlockDocument(content.document.root, [], true) } : {}),
            }
          : emptyArticleContent(),
      });
      await finishArticle(article, copySourceContent ? socialCopy.articleForked : socialCopy.articleCreated);
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
      throw new Error(socialCopy.inspirationUnavailable);
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
    notify(socialCopy.articleCreated);
  });

  const renameArticle = useStableCallback(async (article: ArticleDto, title: string) => {
    await window.desktopApi.articleRename({ id: article.id, title });
    await refresh();
    notify(socialCopy.articleTitleUpdated);
  });

  return {
    copyForWechat,
    createArticleFromArticle,
    createArticleFromDraft,
    exportMarkdown,
    renameArticle,
    saveArticleRevision,
  };
}
