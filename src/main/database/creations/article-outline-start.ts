import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentReferenceTargets } from '@/main/database/creations/content-reference-targets';
import { localArticleWriteContext } from '@/main/database/creations/article-write-context';
import {
  articleOutlineStartInputSchema,
  type ArticleOutlineStartInput,
  type ArticleOutlineStartResult,
} from '@/shared/contracts/article-outline-start';
import { startArticleOutlineContent } from '@/shared/article-outline-start';
import { blockDocumentPlacements } from '@/shared/block-document-placements';

/** Correct an empty work in place; never create a replacement article or consume its materials. */
export function startArticleOutline(
  repositories: LibraryDatabaseRepositories,
  references: ContentReferenceTargets,
  raw: ArticleOutlineStartInput,
): ArticleOutlineStartResult {
  const input = articleOutlineStartInputSchema.parse(raw);
  return repositories.db
    .transaction(() => {
      const { db, articles } = repositories;
      if (db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== input.spaceId)
        throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
      const source = references.open({ source: { kind: 'ARTICLE', id: input.articleId } }).article;
      // Rechecking an unknown outcome must not rewrite an outline that was already created and edited.
      if (source.content.editorMode === 'OUTLINE') return { spaceId: input.spaceId, article: source };
      if (source.revisionId !== input.expectedRevisionId) throw new Error('ARTICLE_OUTLINE_START_CHANGED');
      const { mediaAssets: _mediaAssets, ...editable } = source.content;
      const content = startArticleOutlineContent(editable);
      const article = articles.saveSystemRevision(
        {
          articleId: source.id,
          expectedRevisionId: source.revisionId,
          requestId: input.requestId,
          content,
          elements: blockDocumentPlacements(content.document!),
        },
        localArticleWriteContext(db, input.requestId),
      );
      return { spaceId: input.spaceId, article };
    })
    .immediate();
}
