import type { LibraryStorage } from '@/main/database/core/storage';
import type { CreationFormEntityRef } from '@/shared/contracts/creation-library';
import { authorSchema, creationAuthorStateSchema, type Author, type MeCommand } from '@/shared/contracts/me';
import { authorSummary, createAuthorIdentity } from '@/main/database/me/author-identities';
import { contentAuthors, initializeContentAuthors, replaceContentAuthors } from '@/main/database/me/content-authorship';
import { creationEntityExists } from '@/main/database/creations/creation-form-entity';

const authorSelect = `SELECT author.*,author.id=(SELECT value FROM app_meta WHERE key='user_profile_id') is_current_user
  FROM creation_authors author`;
type AuthorRow = {
  id: string;
  name: string;
  kind: 'HUMAN' | 'AI' | null;
  application: string | null;
  avatar_data_url: string | null;
  revision: number;
  is_current_user: number;
};
const authorDto = (row: AuthorRow): Author =>
  authorSchema.parse({
    id: row.id,
    name: row.name,
    kind: row.kind,
    application: row.application,
    revision: row.revision,
    avatarDataUrl: row.avatar_data_url,
    isCurrentUser: Boolean(row.is_current_user),
  });

export class AuthorRepository {
  constructor(private readonly storage: LibraryStorage) {}
  private get db() {
    return this.storage.db;
  }

  get(id: string) {
    const row = this.db.prepare(`${authorSelect} WHERE author.id=?`).get(id) as AuthorRow | undefined;
    if (!row) throw new Error('AUTHOR_UNAVAILABLE');
    return authorDto(row);
  }

  list(input: Extract<MeCommand, { kind: 'authors-list' }>) {
    const rows = this.db
      .prepare(
        `${authorSelect} WHERE INSTR(LOWER(author.name || ' ' || COALESCE(author.application,'')),LOWER(?))>0
      ORDER BY is_current_user DESC,author.name COLLATE NOCASE,author.id LIMIT 31 OFFSET ?`,
      )
      .all(input.term, input.offset) as AuthorRow[];
    return { authors: rows.slice(0, 30).map(authorDto), nextOffset: rows.length > 30 ? input.offset + 30 : null };
  }

  private targetItem(target: CreationFormEntityRef) {
    if (!creationEntityExists(this.db, target)) return undefined;
    return this.db
      .prepare(
        `SELECT item.id,item.archived_at FROM creation_forms form
      JOIN creation_items item ON item.id=form.creation_item_id AND item.deleted_at IS NULL
      WHERE form.entity_type=? AND form.entity_id=? AND form.deleted_at IS NULL`,
      )
      .get(target.kind, target.id) as { id: string; archived_at: string | null } | undefined;
  }

  forTarget(target: CreationFormEntityRef) {
    if (!this.targetItem(target)) return null;
    const revision = this.db
      .prepare('SELECT revision FROM content_authorships WHERE target_type=? AND target_id=?')
      .pluck()
      .get(target.kind, target.id);
    const summaries = contentAuthors(this.db, target);
    const authors = summaries.length
      ? (
          this.db
            .prepare(
              `${authorSelect}
      JOIN json_each(?) selected ON selected.value=author.id ORDER BY CAST(selected.key AS INTEGER)`,
            )
            .all(JSON.stringify(summaries.map((author) => author.id))) as AuthorRow[]
        ).map(authorDto)
      : [];
    const legacyId = this.db
      .prepare('SELECT author_id FROM content_authorship_legacy WHERE target_type=? AND target_id=?')
      .pluck()
      .get(target.kind, target.id);
    return creationAuthorStateSchema.parse({
      target,
      revision: revision ?? 0,
      authors,
      legacyAuthor: typeof legacyId === 'string' ? authorSummary(this.db, legacyId) : null,
    });
  }

  assign(input: Extract<MeCommand, { kind: 'creation-author-set' }>) {
    return this.db
      .transaction(() => {
        const item = this.targetItem(input.target);
        if (!item || item.archived_at) throw new Error('CREATION_UNAVAILABLE');
        if (
          input.target.kind === 'ARTICLE' &&
          !this.db.prepare("SELECT 1 FROM articles WHERE id=? AND status='ACTIVE'").get(input.target.id)
        )
          throw new Error('CREATION_UNAVAILABLE');
        const previous = this.forTarget(input.target)!;
        if (previous.revision !== input.expectedRevision) throw new Error('AUTHOR_CHANGED');
        initializeContentAuthors(this.db, input.target);
        let ids = previous.authors.map((author) => author.id);
        const selection = input.selection;
        if (selection.kind === 'UNSET') ids = [];
        if (selection.kind === 'REMOVE') ids = ids.filter((id) => id !== selection.authorId);
        if (selection.kind === 'EXISTING') ids.push(this.get(selection.authorId).id);
        if (selection.kind === 'NEW') {
          const author = createAuthorIdentity(this.db, selection.fields.name);
          this.db
            .prepare('UPDATE creation_authors SET avatar_data_url=? WHERE id=?')
            .run(selection.fields.avatarDataUrl, author.id);
          ids.push(author.id);
          this.storage.recordChange('AUTHOR', author.id, 'CREATE', { name: author.name });
        }
        const result = this.db
          .prepare(
            `UPDATE content_authorships SET revision=revision+1
        WHERE target_type=? AND target_id=? AND revision=?`,
          )
          .run(input.target.kind, input.target.id, input.expectedRevision);
        if (result.changes !== 1) throw new Error('AUTHOR_CHANGED');
        replaceContentAuthors(this.db, input.target, ids);
        this.db
          .prepare('DELETE FROM content_authorship_legacy WHERE target_type=? AND target_id=?')
          .run(input.target.kind, input.target.id);
        const next = this.forTarget(input.target)!;
        this.storage.recordChange(input.target.kind, input.target.id, 'SET_AUTHORS', {
          writerAuthorId: this.db.prepare("SELECT value FROM app_meta WHERE key='user_profile_id'").pluck().get(),
          authors: next.authors.map(({ id, name, kind, application }) => ({ id, name, kind, application })),
          previousAuthorIds: previous.authors.map((author) => author.id),
          revision: next.revision,
        });
        return next;
      })
      .immediate();
  }

  update(input: Extract<MeCommand, { kind: 'author-update' }>) {
    return this.db
      .transaction(() => {
        const previous = this.get(input.authorId);
        const result = this.db
          .prepare(
            `UPDATE creation_authors SET name=?,avatar_data_url=?,revision=revision+1,updated_at=?
        WHERE id=? AND revision=?`,
          )
          .run(
            input.fields.name,
            input.fields.avatarDataUrl,
            new Date().toISOString(),
            input.authorId,
            input.expectedRevision,
          );
        if (result.changes !== 1) throw new Error('AUTHOR_CHANGED');
        this.storage.recordChange('AUTHOR', input.authorId, 'UPDATE', {
          writerAuthorId: this.db.prepare("SELECT value FROM app_meta WHERE key='user_profile_id'").pluck().get(),
          previousName: previous.name,
          name: input.fields.name,
        });
        return this.get(input.authorId);
      })
      .immediate();
  }
}
