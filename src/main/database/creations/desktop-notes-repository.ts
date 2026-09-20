import { sameArticleElementPlacements, articleCommentAnchorUpdatesAreApplied } from '@/shared/contracts/article';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import { articleNote, saveArticleNote } from '@/main/database/creations/article-note-repository';
import { InspirationStashRepository } from '@/main/database/creations/inspiration-stash-repository';
import {
  type DesktopNote,
  type DesktopNoteDraft,
  type DesktopNoteInitial,
  type DesktopNoteSave,
  type PetalColor,
  type PetalIcon,
} from '@/shared/contracts/desktop-petals';
import { petalError } from '@/shared/petal-errors';
import { petalLabel } from '@/shared/petal-preview';
import { DEFAULT_PETAL_COLOR } from '@/shared/contracts/petal-appearance';

interface NoteRow {
  id: string;
  stash_id: string;
  color: PetalColor;
  icon: PetalIcon;
  input_json: string;
  content_hash: string;
  revision_id: string | null;
  album_id: string | null;
}
const hasInitialContent = (initial?: DesktopNoteInitial) =>
  Boolean(
    initial?.title?.trim() || initial?.text.trim() || initial?.referenceAssetIds?.length || initial?.files?.length,
  );
const noteQuery = `SELECT n.* FROM desktop_note_instances n JOIN articles s ON s.id = n.stash_id WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL`;

export class DesktopNotesRepository {
  summaries(): { id: string; title: string; color: PetalColor; icon: PetalIcon; hasImages: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT n.id,n.color,n.icon,
      COALESCE(json_extract(r.content_json,'$.title'),'') AS title,
      substr(COALESCE(json_extract(r.content_json,'$.markdown'),
        (SELECT group_concat(part,' ') FROM (
          SELECT substr(atom,1,480) AS part FROM json_tree(r.content_json,'$.document.root')
          WHERE key='text' AND type='text' LIMIT 8
        )),''),1,480) AS excerpt,
      COALESCE(json_array_length(r.content_json,'$.mediaBindings'),0)>0 AS hasImages
      FROM desktop_note_instances n JOIN articles s ON s.id=n.stash_id
      JOIN article_revisions r ON r.id=s.current_revision_id
      WHERE s.status='ACTIVE' AND s.deleted_at IS NULL ORDER BY n.created_at,n.id`,
      )
      .all() as { id: string; title: string; excerpt: string; color: PetalColor; icon: PetalIcon; hasImages: number }[];
    return rows.map(({ excerpt, hasImages, ...row }) => ({
      ...row,
      hasImages: Boolean(hasImages),
      title: petalLabel(row.title, excerpt),
    }));
  }
  private readonly inspirations: InspirationStashRepository;
  constructor(
    private readonly storage: LibraryStorage,
    private readonly articles: ArticleRepository,
  ) {
    this.inspirations = new InspirationStashRepository(storage, articles);
  }
  private get db() {
    return this.storage.db;
  }

  list(): DesktopNote[] {
    const rows = this.db.prepare(`${noteQuery} ORDER BY n.created_at, n.id`).all() as NoteRow[];
    const articles = new Map(
      this.articles.list([...new Set(rows.map((row) => row.stash_id))]).map((article) => [article.id, article]),
    );
    return rows.map((row) => ({
      ...articleNote(articles.get(row.stash_id)!, row.id),
      color: row.color,
      icon: row.icon,
    }));
  }
  activeIds(color?: PetalColor): string[] {
    return this.db
      .prepare(
        `SELECT n.id FROM desktop_note_instances n JOIN articles s ON s.id = n.stash_id
      WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL${color ? ' AND n.color = ?' : ''}`,
      )
      .pluck()
      .all(...(color ? [color] : [])) as string[];
  }
  get(id: string): DesktopNote {
    const row = this.db.prepare(`${noteQuery} AND n.id = ?`).get(id) as NoteRow | undefined;
    if (!row) throw petalError('sourceUnavailable');
    return this.dto(row);
  }
  create(requestId: string, stashId?: string, initial?: DesktopNoteInitial): DesktopNote {
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM desktop_note_instances WHERE id = ?').get(requestId))
        return this.get(requestId);
      if (!stashId && !hasInitialContent(initial)) throw petalError('emptyNote');
      const stash = stashId
        ? this.inspirations.get(stashId)
        : this.inspirations.save({
            mode: 'CREATE_NOTE',
            requestId,
            albumId: initial?.albumId ?? null,
            consumeCreationDraftId: null,
            content: {
              schemaVersion: 1,
              ...(initial?.title !== undefined ? { title: initial.title } : {}),
              ...(initial?.format ? { format: initial.format } : {}),
              ...(initial?.document ? { schemaVersion: 2, document: initial.document } : {}),
              manualPrompt: initial!.text,
              promptNodes: [{ kind: 'TEXT', text: initial!.text }],
              referenceAssetIds: initial?.referenceAssetIds ?? [],
              ...(initial?.files ? { files: initial.files } : {}),
              termPromptLocale: 'zh',
              termIds: [],
              wordPaletteReferences: [],
            },
          });
      if (stash.status !== 'ACTIVE') throw petalError('sourceUnavailable');
      this.db
        .prepare(
          'INSERT INTO desktop_note_instances(id, stash_id, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(requestId, stash.id, initial?.color ?? DEFAULT_PETAL_COLOR, initial?.icon ?? 'feather', now(), now());
      return this.get(requestId);
    })();
  }
  reconcileSources(stashIds?: readonly string[]) {
    const filter = stashIds ? ` AND n.stash_id IN (${stashIds.map(() => '?').join(',')})` : '';
    if (stashIds?.length === 0) return [];
    return this.db.transaction(() => {
      const unavailable = this.db
        .prepare(
          `SELECT n.id, s.deleted_at, s.id AS source_id
        FROM desktop_note_instances n LEFT JOIN articles s ON s.id = n.stash_id
        WHERE (s.id IS NULL OR s.deleted_at IS NOT NULL OR s.status <> 'ACTIVE')${filter}`,
        )
        .all(...(stashIds ?? [])) as { id: string; deleted_at: string | null; source_id: string | null }[];
      const remove = this.db.prepare('DELETE FROM desktop_note_instances WHERE id = ?');
      const removeMembership = this.db.prepare('DELETE FROM desktop_petal_memberships WHERE instance_id = ?');
      for (const row of unavailable) {
        if (!row.source_id || row.deleted_at) {
          removeMembership.run(row.id);
          remove.run(row.id);
        }
      }
      return unavailable.map((row) => row.id);
    })();
  }
  save(input: DesktopNoteSave) {
    return this.db.transaction(() => {
      const note = this.get(input.id);
      if (!note.editable) throw petalError('structuredNote');
      saveArticleNote(this.articles, input, note.stashId);
      // Only acknowledge the exact draft this editor saved; a newer checkpoint survives.
      this.db
        .prepare(
          'DELETE FROM desktop_note_drafts WHERE instance_id = ? AND editor_id = ? AND text_content = ? AND document_json = ?',
        )
        .run(
          input.id,
          input.editorId,
          input.text,
          JSON.stringify({
            expectedRevisionId: input.expectedRevisionId,
            title: input.title,
            format: input.format,
            referenceAssetIds: input.referenceAssetIds,
            document: input.document,
            elements: input.elements,
            commentAnchors: input.commentAnchors,
          }),
        );
      return this.get(input.id);
    })();
  }
  appearance(id: string, patch: { color?: PetalColor; icon?: PetalIcon }) {
    const note = this.get(id);
    this.db
      .prepare('UPDATE desktop_note_instances SET color = ?, icon = ?, updated_at = ? WHERE id = ?')
      .run(patch.color ?? note.color, patch.icon ?? note.icon, now(), id);
    return this.get(id);
  }
  remove(id: string) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM desktop_petal_memberships WHERE instance_id = ?').run(id);
      this.db.prepare('DELETE FROM desktop_note_instances WHERE id = ?').run(id);
    })();
  }
  removeByColor(color: PetalColor) {
    return this.db.transaction(() => {
      const ids = this.activeIds(color);
      if (!ids.length) return ids;
      const selected = JSON.stringify(ids);
      const drafts = this.db
        .prepare(
          'SELECT instance_id,text_content,document_json,base_hash FROM desktop_note_drafts WHERE instance_id IN (SELECT value FROM json_each(?))',
        )
        .all(selected) as { instance_id: string; text_content: string; document_json: string; base_hash: string }[];
      const notes = new Map(this.list().map((note) => [note.id, note]));
      for (const draft of drafts) {
        const note = notes.get(draft.instance_id)!;
        const metadata = JSON.parse(draft.document_json) as Partial<DesktopNoteDraft>;
        if (
          draft.base_hash !== note.contentHash ||
          draft.text_content !== note.text ||
          (metadata.title !== undefined && metadata.title !== note.title) ||
          JSON.stringify(metadata.document ?? null) !== JSON.stringify(note.document ?? null) ||
          (metadata.referenceAssetIds &&
            JSON.stringify(metadata.referenceAssetIds) !== JSON.stringify(note.references.map((ref) => ref.assetId))) ||
          (metadata.elements && !sameArticleElementPlacements(metadata.elements, note.elements)) ||
          (metadata.commentAnchors &&
            !articleCommentAnchorUpdatesAreApplied(
              metadata.commentAnchors,
              note.comments.map((comment) => ({ commentId: comment.id, anchor: comment.anchor })),
            ))
        )
          throw petalError('unsaved');
      }
      this.db
        .prepare('DELETE FROM desktop_petal_memberships WHERE instance_id IN (SELECT value FROM json_each(?))')
        .run(selected);
      this.db.prepare('DELETE FROM desktop_note_instances WHERE id IN (SELECT value FROM json_each(?))').run(selected);
      return ids;
    })();
  }
  checkpoint(input: DesktopNoteDraft) {
    this.get(input.id);
    this.db
      .prepare(
        `INSERT INTO desktop_note_drafts(instance_id, editor_id, base_hash, text_content, document_json, sequence, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, editor_id) DO UPDATE SET base_hash = excluded.base_hash, text_content = excluded.text_content, document_json = excluded.document_json, sequence = excluded.sequence, updated_at = excluded.updated_at
      WHERE excluded.sequence > desktop_note_drafts.sequence`,
      )
      .run(
        input.id,
        input.editorId,
        input.expectedContentHash,
        input.text,
        JSON.stringify({
          expectedRevisionId: input.expectedRevisionId,
          title: input.title,
          format: input.format,
          referenceAssetIds: input.referenceAssetIds,
          document: input.document,
          elements: input.elements,
          commentAnchors: input.commentAnchors,
        }),
        input.sequence,
        now(),
      );
  }
  draft(id: string) {
    const row = this.db
      .prepare(
        'SELECT text_content, document_json, base_hash, editor_id, sequence FROM desktop_note_drafts WHERE instance_id = ? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(id) as
      | { text_content: string; document_json: string; base_hash: string; editor_id: string; sequence: number }
      | undefined;
    return row
      ? {
          ...(JSON.parse(row.document_json) as {
            title?: string;
            format?: 'markdown';
            referenceAssetIds?: string[];
            elements?: DesktopNoteDraft['elements'];
            commentAnchors?: DesktopNoteDraft['commentAnchors'];
          }),
          text: row.text_content,
          expectedContentHash: row.base_hash,
          editorId: row.editor_id,
          sequence: row.sequence,
        }
      : null;
  }
  private dto(row: NoteRow): DesktopNote {
    return { ...articleNote(this.articles.get(row.stash_id), row.id), color: row.color, icon: row.icon };
  }
}
