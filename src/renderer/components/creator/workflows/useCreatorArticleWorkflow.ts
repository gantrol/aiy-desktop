import { articleDraftDto, articleDraftInput } from '@/shared/article-draft';
import { inspirationArticleIds } from '@/shared/article-summary';
import { loadArticleDetails } from '@/renderer/components/creator/useArticleDetails';
import { emptyArticleContent } from '@/renderer/components/creator/article-editor/articleContentTransforms';
import { creationFormByEntity, creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type {
  ArticleContentInput,
  ArticleDto,
  ArticleListItem,
  ArticleRevisionSaveInput,
  ArticleWechatCopyOptions,
  CreationItemDto,
  InspirationStashDto,
  Locale,
} from '@/shared/contracts';
import { captureBlockDocument } from '@/shared/contracts/block-document';

interface Options {
  spaceId: string;
  creationItems: readonly CreationItemDto[];
  getCreationDraftCommitIdentity(): string | null;
  inspirationStashes: readonly InspirationStashDto[];
  articles?: readonly ArticleListItem[];
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
  const outlineCopy = useI18n().messages.referenceOutline;
  const saveArticleRevision = useStableCallback((input: ArticleRevisionSaveInput) =>
    window.desktopApi.articleRevisionSave(input),
  );
  const getCreationDraftCommitIdentity = useStableCallback(options.getCreationDraftCommitIdentity);
  const notify = useStableCallback(options.notify);
  const onDraftArticleCreated = useStableCallback(options.onDraftArticleCreated);
  const openArticle = useStableCallback(options.onOpenArticle);
  const refresh = useStableCallback(options.refresh);

  function activeSourceId(sourceId: string | null) {
    return sourceId && inspirationArticleIds(options).includes(sourceId) ? sourceId : null;
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
        ? socialCopy.wechatLinkReferences.replace('{count}', String(result.endReferenceCount))
        : '';
    const imageNotice =
      result.remoteImageCount > 0
        ? socialCopy.wechatRemoteImages.replace('{count}', String(result.remoteImageCount))
        : '';
    notify(socialCopy.wechatCopied + referenceNotice + imageNotice);
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
      ? creationItemByFormEntity(options.creationItems, 'ARTICLE', snapshot.sourceInspirationStashId)
      : null;
    if (snapshot.sourceInspirationStashId && !sourceItem) {
      throw new Error(socialCopy.inspirationUnavailable);
    }
    let article: ArticleDto;
    if (sourceItem && snapshot.sourceInspirationStashId) {
      const summary = options.articles?.find((item) => item.id === snapshot.sourceInspirationStashId);
      const source =
        options.inspirationStashes.find((item) => item.id === snapshot.sourceInspirationStashId) ??
        (summary ? articleDraftDto(await loadArticleDetails(options.spaceId, summary)) : null);
      if (!source) throw new Error(socialCopy.inspirationUnavailable);
      if (getCreationDraftCommitIdentity() !== snapshot.creationDraftCommitIdentity) return;
      await window.desktopApi.inspirationStashSave({
        mode: 'UPDATE',
        id: source.id,
        expectedContentHash: summary?.contentHash ?? source.contentHash,
        expectedRevisionId: summary?.revisionId ?? source.revisionId,
        consumeCreationDraftId: snapshot.creationDraftId,
        content: {
          ...articleDraftInput(snapshot.content),
          ...(source.content.files ? { files: source.content.files } : {}),
        },
      });
      article = (await window.desktopApi.articleOpen({ spaceId: options.spaceId, articleId: source.id })).article;
    } else {
      article = await window.desktopApi.articleSave({
        id: null,
        albumId: snapshot.targetAlbumId,
        sourceInspirationStashId: null,
        consumeCreationDraftId: snapshot.creationDraftId,
        content: snapshot.content,
      });
    }
    await refresh();
    if (getCreationDraftCommitIdentity() !== snapshot.creationDraftCommitIdentity) return;
    onDraftArticleCreated(article);
    notify(article.content.editorMode === 'OUTLINE' ? outlineCopy.outlineCreated : socialCopy.articleCreated);
  });

  const renameArticle = useStableCallback(async (article: Pick<ArticleDto, 'id'>, title: string) => {
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
