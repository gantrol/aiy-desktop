import type { LibraryStorage } from '@/main/database/core/storage';
import { mediaUrl, now } from '@/main/database/core/values';
import { appendInspirationRevision } from '@/main/database/creations/inspiration-history';
import { InspirationStashRepository } from '@/main/database/creations/inspiration-stash-repository';
import { contentDisplayTitle, replaceContentPromptText } from '@/shared/content-document';
import {
  desktopNoteSchema,
  type DesktopNote,
  type DesktopNoteDraft,
  type DesktopNoteInitial,
  type DesktopNoteSave,
  type PetalColor,
  type PetalIcon,
} from '@/shared/contracts/desktop-petals';
import { inspirationStashContentSchema } from '@/shared/contracts/inspiration-stash';
import { petalError } from '@/shared/petal-errors';
import { petalLabel } from '@/shared/petal-preview';

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
const noteQuery = `SELECT n.*, s.input_json, s.content_hash, s.album_id,
  (SELECT id FROM inspiration_stash_revisions WHERE stash_id = s.id ORDER BY revision_no DESC LIMIT 1) AS revision_id
  FROM desktop_note_instances n JOIN inspiration_stashes s ON s.id = n.stash_id
  WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL`;

export class DesktopNotesRepository {
  summaries(): { id: string; title: string; color: PetalColor; icon: PetalIcon; hasImages: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT n.id, n.color, n.icon,
      COALESCE(json_extract(s.input_json, '$.title'), '') AS title,
      substr(COALESCE(json_extract(s.input_json, '$.manualPrompt'), ''), 1, 480) AS excerpt,
      COALESCE(json_array_length(s.input_json, '$.referenceAssetIds'), 0) > 0 AS hasImages
      FROM desktop_note_instances n JOIN inspiration_stashes s ON s.id = n.stash_id
      WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL ORDER BY n.created_at, n.id`,
      )
      .all() as { id: string; title: string; excerpt: string; color: PetalColor; icon: PetalIcon; hasImages: number }[];
    return rows.map(({ excerpt, hasImages, ...row }) => ({
      ...row,
      hasImages: Boolean(hasImages),
      title: petalLabel(row.title, excerpt),
    }));
  }
  private readonly inspirations: InspirationStashRepository;
  constructor(private readonly storage: LibraryStorage) {
    this.inspirations = new InspirationStashRepository(storage);
  }
  private get db() {
    return this.storage.db;
  }

  list(): DesktopNote[] {
    return (this.db.prepare(`${noteQuery} ORDER BY n.created_at, n.id`).all() as NoteRow[]).map((row) => this.dto(row));
  }
  activeIds(): string[] {
    return this.db
      .prepare(
        `SELECT n.id FROM desktop_note_instances n JOIN inspiration_stashes s ON s.id = n.stash_id
      WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL`,
      )
      .pluck()
      .all() as string[];
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
      const source = this.db
        .prepare('SELECT input_json, content_hash FROM inspiration_stashes WHERE id = ? AND deleted_at IS NULL')
        .get(stash.id) as { input_json: string; content_hash: string } | undefined;
      if (!source) throw petalError('sourceUnavailable');
      appendInspirationRevision(this.db, stash.id, source.input_json, source.content_hash, now());
      this.db
        .prepare(
          'INSERT INTO desktop_note_instances(id, stash_id, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(requestId, stash.id, initial?.color ?? 'rose', initial?.icon ?? 'feather', now(), now());
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
        FROM desktop_note_instances n LEFT JOIN inspiration_stashes s ON s.id = n.stash_id
        WHERE (s.id IS NULL OR s.deleted_at IS NOT NULL OR s.status <> 'ACTIVE')${filter}`,
        )
        .all(...(stashIds ?? [])) as { id: string; deleted_at: string | null; source_id: string | null }[];
      const remove = this.db.prepare('DELETE FROM desktop_note_instances WHERE id = ?');
      for (const row of unavailable) if (!row.source_id || row.deleted_at) remove.run(row.id);
      return unavailable.map((row) => row.id);
    })();
  }
  save(input: DesktopNoteSave) {
    return this.db.transaction(() => {
      const note = this.get(input.id);
      if (!note.editable) throw petalError('structuredNote');
      const stash = this.inspirations.get(note.stashId);
      const { referenceAssets: _assets, ...content } = stash.content;
      if (content.document && !input.document && input.text !== content.manualPrompt)
        throw new Error('BLOCK_DOCUMENT_REQUIRED');
      this.inspirations.save({
        mode: 'UPDATE',
        id: note.stashId,
        consumeCreationDraftId: null,
        expectedContentHash: input.expectedContentHash,
        content: {
          ...content,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.format ? { format: input.format } : {}),
          ...(input.referenceAssetIds ? { referenceAssetIds: input.referenceAssetIds } : {}),
          ...(input.document ? { schemaVersion: 2, document: input.document } : {}),
          manualPrompt: input.text,
          promptNodes: replaceContentPromptText(content.promptNodes, input.text),
        },
      });
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
            title: input.title,
            format: input.format,
            referenceAssetIds: input.referenceAssetIds,
            document: input.document,
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
          title: input.title,
          format: input.format,
          referenceAssetIds: input.referenceAssetIds,
          document: input.document,
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
          ...(JSON.parse(row.document_json) as { title?: string; format?: 'markdown'; referenceAssetIds?: string[] }),
          text: row.text_content,
          expectedContentHash: row.base_hash,
          editorId: row.editor_id,
          sequence: row.sequence,
        }
      : null;
  }
  private dto(row: NoteRow): DesktopNote {
    const content = inspirationStashContentSchema.parse(JSON.parse(row.input_json));
    const editable = true;
    return desktopNoteSchema.parse({
      id: row.id,
      stashId: row.stash_id,
      text: content.manualPrompt,
      document: content.document,
      contentHash: row.content_hash,
      title: content.title ?? '',
      displayTitle: contentDisplayTitle(content.title, content.manualPrompt),
      albumId: row.album_id,
      ...(content.format ? { format: content.format } : {}),
      color: row.color,
      icon: row.icon,
      editable,
      revisionId: row.revision_id,
      references: content.referenceAssetIds.map((assetId) => ({ assetId, mediaUrl: mediaUrl(assetId) })),
      files: content.files,
    });
  }
}
