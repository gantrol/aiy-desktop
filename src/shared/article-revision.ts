import type { ArticleDto } from '@/shared/contracts';
import {
  articleCommentAnchorUpdates,
  articleCommentAnchorUpdatesAreApplied,
  articleContentSchema,
  sameArticleElementPlacements,
  type ArticleContentInput,
  type ArticleRevisionSaveInput,
} from '@/shared/contracts/article';
import { removeUnboundArticleMarkdownImages } from '@/shared/article-wechat-renderer';

export function normalizeArticleContent(input: ArticleContentInput): ArticleContentInput {
  const content = articleContentSchema.parse(input);
  const markdown = removeUnboundArticleMarkdownImages(
    content.markdown,
    content.mediaBindings.map((binding) => binding.path),
  );
  return markdown === content.markdown ? content : { ...content, markdown };
}

/** Compare the complete save payload with the current revision, never with history. */
export function articleRevisionMatchesArticle(request: ArticleRevisionSaveInput, article: ArticleDto) {
  if (request.articleId !== article.id || request.contentHash !== article.contentHash) return false;
  if (request.elements && !sameArticleElementPlacements(request.elements, article.elements)) return false;
  return (
    !request.commentAnchors ||
    articleCommentAnchorUpdatesAreApplied(request.commentAnchors, articleCommentAnchorUpdates(article.comments))
  );
}
