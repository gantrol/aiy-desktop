import { mediaUrl } from '@/main/database/core/values';
import { normalizeArticleContent } from '@/shared/article-revision';
import { createHash } from 'node:crypto';
import type { ArticleDto } from '@/shared/contracts';
import { ulid } from 'ulid';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import { articleDraftContent, articleDraftInput } from '@/shared/article-draft';
import { replaceContentPromptText, contentDisplayTitle } from '@/shared/content-document';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import { desktopNoteSchema, type DesktopNoteSave } from '@/shared/contracts/desktop-petals';
import { DEFAULT_PETAL_COLOR } from '@/shared/contracts/petal-appearance';

export function articleNote(article: ArticleDto, instanceId = article.id) {
  const input = articleDraftInput(article.content);
  return desktopNoteSchema.parse({
    id: instanceId,
    stashId: article.id,
    text: input.manualPrompt,
    title: article.content.title,
    displayTitle: contentDisplayTitle(article.content.title, article.content.markdown),
    albumId: article.albumId,
    format: 'markdown',
    document: article.content.document,
    contentHash: article.contentHash,
    color: DEFAULT_PETAL_COLOR,
    icon: 'feather',
    editable: article.status === 'ACTIVE',
    revisionId: article.revisionId,
    elements: article.elements,
    comments: article.comments.map(({ articleId, ...comment }) => ({ ...comment, noteId: articleId })),
    references: [...new Set(article.content.mediaBindings.map((binding) => binding.assetId))].map((assetId) => ({
      assetId,
      mediaUrl: mediaUrl(assetId),
    })),
    files: article.content.files,
  });
}

/** Both editor surfaces commit through the article revision writer and its compare-and-swap. */
export function saveArticleNote(articles: ArticleRepository, input: DesktopNoteSave, articleId = input.id) {
  const article = articles.get(articleId);
  if (article.status !== 'ACTIVE') throw new Error('[aiy-petal:sourceUnavailable]');
  const previous = articleDraftInput(article.content);
  if (previous.document && !input.document && input.text !== previous.manualPrompt)
    throw new Error('BLOCK_DOCUMENT_REQUIRED');
  const content = normalizeArticleContent(
    articleDraftContent(
      {
        ...previous,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.format ? { format: input.format } : {}),
        ...(input.document ? { schemaVersion: 2, document: input.document } : {}),
        referenceAssetIds: input.referenceAssetIds ?? previous.referenceAssetIds,
        manualPrompt: input.text,
        promptNodes: replaceContentPromptText(previous.promptNodes, input.text),
      },
      article.content,
    ),
  );
  const result = articles.saveRevision({
    requestId: ulid(),
    articleId,
    sessionEpoch: input.editorId,
    draftSeq: 0,
    cause: 'EDITOR',
    expectedRevisionId:
      input.expectedRevisionId ??
      (input.expectedContentHash === article.contentHash ? article.revisionId : `legacy:${input.expectedContentHash}`),
    contentHash: createHash('sha256').update(canonicalArticleContentJson(content)).digest('hex'),
    content,
    elements: input.elements,
    commentAnchors: input.commentAnchors,
  });
  if (result.status === 'CONFLICT') throw new Error('[aiy-petal:unsaved]');
  return articleNote(result.article, input.id);
}
