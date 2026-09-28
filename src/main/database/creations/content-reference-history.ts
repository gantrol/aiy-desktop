import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import type { ArticleContentInput } from '@/shared/contracts';
import { contentMarkdownReferences } from '@/shared/content-markdown';
import { referenceHistoryResultSchema } from '@/shared/contracts/content-library';

function recoverableReferenceFailure(reason: unknown) {
  const code = reason instanceof Error ? reason.message : '';
  return (
    /^(REFERENCE_|CONTENT_LIBRARY_SPACE_CHANGED|BLOCK_)/u.test(code) ||
    ['Too many block references', 'Block reference unavailable', 'Expanded content is too large'].includes(code)
  );
}

/** Historical display never re-resolves a saved binding against today's source. */
export class ContentReferenceHistory {
  constructor(
    private readonly repositories: LibraryDatabaseRepositories,
    private readonly content: ContentLibraryRepository,
  ) {}

  capture(articleId: string, revisionId: string, input: ArticleContentInput) {
    // Avoid parsing ordinary articles or creating empty per-revision dependency records.
    if (!input.markdown.includes(':::aiy-block')) return;
    let resolutionId: string | null = null;
    try {
      const ids = [...new Set(contentMarkdownReferences(input.markdown).map(({ id }) => id))];
      if (!ids.length) return;
      if (ids.length > 100) throw new Error('Too many block references');
      const references = this.content.references(ids);
      const following = new Set(
        (
          this.repositories.db
            .prepare(
              `SELECT reference_id FROM content_following_references WHERE reference_id IN (${ids.map(() => '?').join(',')})`,
            )
            .all(...ids) as { reference_id: string }[]
        ).map(({ reference_id }) => reference_id),
      );
      if (
        references.some(
          (reference) =>
            following.has(reference.id) &&
            reference.source.id === articleId &&
            reference.selector?.kind === 'DOCUMENT_BODY',
        )
      )
        throw new Error('REFERENCE_FOLLOW_NESTED');
      resolutionId = this.content.freeze(input.markdown).resolutionId;
    } catch (reason) {
      if (!recoverableReferenceFailure(reason)) throw reason;
    }
    this.repositories.db
      .prepare('INSERT INTO article_reference_history(revision_id,resolution_id,state) VALUES (?,?,?)')
      .run(revisionId, resolutionId, resolutionId ? 'COMPLETE' : 'UNAVAILABLE');
  }

  read(articleId: string, revisionId: string, expectedSpaceId: string) {
    return this.repositories.db.transaction(() => {
      const spaceId = this.repositories.db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get();
      if (spaceId !== expectedSpaceId) throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
      const revision = this.repositories.articles.getRevision({ articleId, revisionId });
      const row = this.repositories.db
        .prepare('SELECT resolution_id,state FROM article_reference_history WHERE revision_id=?')
        .get(revisionId) as { resolution_id: string | null; state: 'COMPLETE' | 'UNAVAILABLE' } | undefined;
      const markdown = revision.content.markdown;
      const hasReferences = contentMarkdownReferences(markdown).length > 0;
      if (!hasReferences)
        return referenceHistoryResultSchema.parse({
          spaceId,
          articleId,
          revisionId,
          state: 'COMPLETE',
          markdown,
          media: [],
          bindings: {},
        });
      if (!row?.resolution_id)
        return referenceHistoryResultSchema.parse({
          spaceId,
          articleId,
          revisionId,
          state: row?.state ?? 'LEGACY',
          markdown,
          media: [],
          bindings: {},
        });
      const expanded = this.content.renderFrozen(markdown, row.resolution_id);
      const bindings = this.repositories.db
        .prepare('SELECT bindings_json FROM content_reference_resolutions WHERE id=?')
        .pluck()
        .get(row.resolution_id);
      return referenceHistoryResultSchema.parse({
        spaceId,
        articleId,
        revisionId,
        state: 'COMPLETE',
        ...expanded,
        bindings: JSON.parse(String(bindings)),
        resolutionId: row.resolution_id,
      });
    })();
  }

  resolutionFor(articleId: string, revisionId: string, markdown: string) {
    if (!contentMarkdownReferences(markdown).length) return undefined;
    const row = this.repositories.db
      .prepare(
        `SELECT history.resolution_id FROM article_reference_history history
       JOIN article_revisions revision ON revision.id=history.revision_id
       WHERE revision.article_id=? AND revision.id=? AND history.state='COMPLETE'`,
      )
      .get(articleId, revisionId) as { resolution_id: string } | undefined;
    if (!row) throw new Error('REFERENCE_HISTORY_UNAVAILABLE');
    return row.resolution_id;
  }
}
