import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';
import { ArticleCommentRepository } from '@/main/database/creations/article-comment-repository';
import { ArticleElementRepository } from '@/main/database/creations/article-element-repository';
import type {
  ContentCommentAnchorUpdateInput,
  ContentElementPlacementInput,
} from '@/shared/contracts/content-comments';
import {
  noteCommentMutationInputSchema,
  type NoteCommentMutationInput,
  type NoteCommentMutationResult,
} from '@/shared/contracts/desktop-petals';

/** Compatibility adapter for note editors; articles own comments and element identities. */
export class NoteCommentRepository {
  private readonly comments: ArticleCommentRepository;
  private readonly placements: ArticleElementRepository;
  constructor(private readonly storage: LibraryStorage) {
    this.comments = new ArticleCommentRepository(storage);
    this.placements = new ArticleElementRepository(storage);
  }
  private get db() {
    return this.storage.db;
  }
  private revision(noteId: string) {
    const row = this.db
      .prepare("SELECT current_revision_id FROM articles WHERE id=? AND deleted_at IS NULL AND status='ACTIVE'")
      .get(noteId) as { current_revision_id: string } | undefined;
    if (!row) throw new Error('Article is no longer available');
    return row.current_revision_id;
  }
  elements(noteId: string, revisionId: string) {
    this.revision(noteId);
    return this.placements.listPlacements(revisionId);
  }
  list(noteId: string, revisionId: string) {
    return this.comments
      .list(noteId, revisionId)
      .map(({ articleId, ...comment }) => ({ ...comment, noteId: articleId }));
  }
  saveProjection(
    noteId: string,
    revisionId: string,
    elements: readonly ContentElementPlacementInput[],
    anchors: readonly ContentCommentAnchorUpdateInput[] = [],
  ) {
    this.db.transaction(() => {
      if (this.revision(noteId) !== revisionId)
        throw new Error('The article changed before its editor state could be saved');
      this.db
        .prepare('DELETE FROM article_revision_elements WHERE article_id=? AND revision_id=?')
        .run(noteId, revisionId);
      this.placements.savePlacements(noteId, revisionId, elements, now());
      this.comments.updateAnchors(noteId, anchors);
    })();
  }
  mutate(raw: NoteCommentMutationInput): NoteCommentMutationResult {
    const input = noteCommentMutationInputSchema.parse(raw);
    return this.db.transaction(() => {
      if (input.operation === 'CREATE') {
        const revisionId = this.revision(input.noteId);
        if (revisionId !== input.expectedRevisionId)
          throw new Error('The article changed before its comment could be added');
        const ids = new Set(input.elements.map((element) => element.elementId));
        if (!ids.has(input.anchor.startElementId) || !ids.has(input.anchor.endElementId))
          throw new Error('The selected content is no longer available');
        this.saveProjection(input.noteId, revisionId, input.elements);
      }
      const { noteId, ...mutation } = input;
      const result = this.comments.mutate(
        mutation.operation === 'CREATE'
          ? {
              operation: 'CREATE',
              articleId: noteId,
              expectedRevisionId: mutation.expectedRevisionId,
              anchor: mutation.anchor,
              preview: mutation.preview,
              body: mutation.body,
            }
          : { ...mutation, articleId: noteId },
      );
      return {
        noteId: result.articleId,
        revisionId: result.revisionId,
        comments: result.comments.map(({ articleId, ...comment }) => ({ ...comment, noteId: articleId })),
      };
    })();
  }
}
