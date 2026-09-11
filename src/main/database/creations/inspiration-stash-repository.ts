import { createHash } from 'node:crypto';
import { ensureDefaultNotesAlbum } from '@/main/database/albums/default-notes-album';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import { articleDraftContent, articleDraftDto } from '@/shared/article-draft';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import type {
  InspirationStashDto,
  InspirationStashSaveInput,
  InspirationStashMoveInput,
  InspirationStashSetArchivedInput,
} from '@/shared/contracts';
import { ulid } from 'ulid';

/** Compatibility API for saved generation inputs. Articles are the sole writable authority. */
export class InspirationStashRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly articles: ArticleRepository,
  ) {}
  get(id: string): InspirationStashDto {
    return articleDraftDto(this.articles.get(id));
  }
  list(): InspirationStashDto[] {
    return this.articles
      .list()
      .filter((article) => article.content.creationInput)
      .map(articleDraftDto);
  }
  save(input: InspirationStashSaveInput): InspirationStashDto {
    return this.storage.db.transaction(() => {
      if (input.mode === 'UPDATE') {
        const article = this.articles.get(input.id);
        const content = articleDraftContent(input.content, article.content);
        const same = canonicalArticleContentJson(content) === canonicalArticleContentJson(article.content);
        if (
          !same &&
          (input.expectedContentHash !== article.contentHash ||
            (input.expectedRevisionId && input.expectedRevisionId !== article.revisionId))
        )
          throw new Error('[aiy-petal:unsaved]');
        const saved = same
          ? article
          : this.articles.saveSystemRevision({
              articleId: article.id,
              expectedRevisionId: article.revisionId,
              requestId: ulid(),
              content,
            });
        this.consume(input.consumeCreationDraftId, saved.id);
        return articleDraftDto(saved);
      }
      const content = articleDraftContent(input.content);
      if (
        !content.title.trim() &&
        !content.markdown.trim() &&
        !content.mediaBindings.length &&
        !content.files?.length &&
        !content.creationInput?.promptNodes.some((node) => node.kind !== 'TEXT' || node.text.trim())
      )
        throw new Error('[aiy-petal:emptyNote]');
      const item =
        input.mode === 'ADD_FORM' ? new CreationItemRepository(this.storage).get(input.creationItemId) : null;
      const albumId = item
        ? item.albumId
        : input.mode === 'ADD_FORM'
          ? null
          : (input.albumId ?? ensureDefaultNotesAlbum(this.storage));
      const saved = this.articles.save(
        {
          id: null,
          albumId,
          sourceInspirationStashId: null,
          consumeCreationDraftId: input.consumeCreationDraftId,
          content,
        },
        {
          requestId:
            input.mode === 'CREATE_NOTE'
              ? input.requestId
              : input.consumeCreationDraftId
                ? 'draft:' + createHash('sha256').update(input.consumeCreationDraftId).digest('hex')
                : ulid(),
          ...(item ? { creationItemId: item.id } : {}),
        },
      );
      return articleDraftDto(saved);
    })();
  }
  move(input: InspirationStashMoveInput) {
    return articleDraftDto(this.articles.move(input));
  }
  setArchived(input: InspirationStashSetArchivedInput) {
    return articleDraftDto(this.articles.setArchived(input));
  }
  private consume(id: string | null, articleId: string) {
    if (!id) return;
    const time = now();
    const result = this.storage.db
      .prepare(
        'UPDATE creation_drafts SET consumed_at = ?, updated_at = ? WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL',
      )
      .run(time, time, id);
    if (result.changes !== 1) {
      if (
        this.storage.db
          .prepare(
            "SELECT 1 FROM change_events WHERE entity_type='CREATION_DRAFT' AND entity_id=? AND operation='CONSUME_ARTICLE' AND json_extract(payload_json,'$.articleId')=? LIMIT 1",
          )
          .get(id, articleId)
      )
        return;
      throw new Error('Creation input is no longer available');
    }
    this.storage.recordChange('CREATION_DRAFT', id, 'CONSUME_ARTICLE', { articleId }, { affectsFileView: false });
  }
}

/** Retained for legacy album migration; no new inspiration records are written. */
export function rehomeInspirationStashesForAlbum(storage: LibraryStorage, albumId: string) {
  storage.db.prepare('UPDATE inspiration_stashes SET album_id = NULL WHERE album_id = ?').run(albumId);
}
