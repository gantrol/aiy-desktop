import { createHash } from 'node:crypto';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import type { ArticleDto } from '@/shared/contracts';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentReferenceTargets } from '@/main/database/creations/content-reference-targets';
import { localArticleWriteContext } from '@/main/database/creations/article-write-context';
import { commentCompilationContent } from '@/main/database/creations/comment-compilation-content';
import {
  commentCompilationInputSchema,
  commentCompilationSelection,
  type CommentCompilationInput,
} from '@/shared/contracts/comment-compilation';
import type { CommentCompilationResult } from '@/shared/contracts/comment-compilation-result';
import { contentLinkUrl } from '@/shared/contracts/content-links';

function compilationResult(
  repositories: LibraryDatabaseRepositories,
  spaceId: string,
  article: ArticleDto,
  created: boolean,
): CommentCompilationResult {
  const creationItem = repositories.creationItems.findForEntity({ kind: 'ARTICLE', id: article.id });
  if (!creationItem) throw new Error('COMMENT_COMPILATION_RESULT_UNAVAILABLE');
  return { spaceId, article, creationItem, created };
}

/** Copies and source metadata commit together. A retry returns the existing work, even after it was edited. */
export function createCommentCompilation(
  repositories: LibraryDatabaseRepositories,
  references: ContentReferenceTargets,
  raw: CommentCompilationInput,
): CommentCompilationResult {
  const input = commentCompilationInputSchema.parse(raw);
  return repositories.db
    .transaction(() => {
      const { db, articles } = repositories;
      if (db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== input.spaceId)
        throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
      const prefix = 'comment-compilation:' + input.requestId + ':';
      const articleId = prefix + createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const prior = db
        .prepare('SELECT id, deleted_at FROM articles WHERE id >= ? AND id < ? LIMIT 2')
        .all(prefix, prefix + '~') as { id: string; deleted_at: string | null }[];
      if (prior.length) {
        if (prior.length !== 1 || prior[0].id !== articleId) throw new Error('COMMENT_COMPILATION_REQUEST_REUSED');
        if (prior[0].deleted_at) throw new Error('COMMENT_COMPILATION_RESULT_UNAVAILABLE');
        return compilationResult(repositories, input.spaceId, articles.get(articleId), false);
      }
      const source = references.open({ source: { kind: 'ARTICLE', id: input.sourceArticleId } }).article;
      if (source.revisionId !== input.expectedRevisionId) throw new Error('COMMENT_COMPILATION_SOURCE_CHANGED');
      const byId = new Map(source.comments.map((comment) => [comment.id, comment]));
      for (const selected of input.comments) {
        const current = byId.get(selected.id);
        if (!current || JSON.stringify(commentCompilationSelection(current)) !== JSON.stringify(selected))
          throw new Error('COMMENT_COMPILATION_COMMENTS_CHANGED');
      }
      const ids = [...new Set(input.comments.flatMap((comment) => (comment.authorId ? [comment.authorId] : [])))];
      const rows = db
        .prepare('SELECT id, name FROM creation_authors WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(ids)) as { id: string; name: string }[];
      const { document, origin } = commentCompilationContent(
        source,
        input,
        new Map(rows.map((row) => [row.id, row.name])),
      );
      const article = articles.save(
        {
          id: null,
          albumId: source.albumId,
          sourceInspirationStashId: null,
          consumeCreationDraftId: null,
          content: {
            schemaVersion: 2,
            ...(input.format === 'OUTLINE' ? { editorMode: 'OUTLINE' as const } : {}),
            title: input.title,
            document,
            markdown: blockDocumentMarkdown(document),
            mediaBindings: [],
            coverAssetId: null,
          },
        },
        { requestId: articleId },
        {
          ...localArticleWriteContext(db, input.requestId),
          operation: 'COPIED',
          sources: [
            {
              relation: 'REFERENCE',
              url: contentLinkUrl({ spaceId: input.spaceId, target: { kind: 'ARTICLE', id: source.id } }),
            },
          ],
          commentCompilation: origin,
        },
      );
      return compilationResult(repositories, input.spaceId, article, true);
    })
    .immediate();
}
