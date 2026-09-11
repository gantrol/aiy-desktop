import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { petalError } from '@/shared/petal-errors';
import type { NoteFile } from '@/shared/contracts/note-files';
import { DEFAULT_PETAL_COLOR } from '@/shared/contracts/petal-appearance';
import type {
  DesktopNote,
  DesktopNoteDraft,
  DesktopNoteSave,
  PetalColor,
  PetalIcon,
} from '@/shared/contracts/desktop-petals';

/** A plucked blank is provisional until text or a reference image creates its source and first revision. */
export class PetalNoteService {
  private pending = new Map<string, { note: DesktopNote; draft: DesktopNoteDraft | null }>();
  constructor(private readonly database: ActiveLibraryContext['database']) {}
  isPending(id: string) {
    return this.pending.has(id);
  }
  pendingIds(color: PetalColor) {
    return [...this.pending.values()].filter(({ note }) => note.color === color).map(({ note }) => note.id);
  }
  discard(id: string) {
    this.pending.delete(id);
  }
  get(id: string) {
    return this.pending.get(id)?.note ?? this.database.getDesktopNote(id);
  }
  create(id: string, stashId?: string) {
    if (stashId) return this.database.createDesktopNote(id, stashId);
    const existing = this.pending.get(id);
    if (existing) return existing.note;
    const saved = this.database.listDesktopNotes().find((note) => note.id === id);
    if (saved) return saved;
    const note: DesktopNote = {
      id,
      stashId: id,
      text: '',
      contentHash: `pending:${id}`,
      color: DEFAULT_PETAL_COLOR,
      icon: 'feather',
      editable: true,
      title: '',
      displayTitle: '',
      albumId: this.lastAlbumId(),
      revisionId: null,
      elements: [],
      comments: [],
      persisted: false,
      references: [],
    };
    this.pending.set(id, { note, draft: null });
    return note;
  }
  save(input: DesktopNoteSave) {
    const pending = this.pending.get(input.id);
    if (!pending) return this.database.saveDesktopNote(input);
    if (!input.text.trim() && !input.title?.trim() && !input.referenceAssetIds?.length) {
      pending.note = {
        ...pending.note,
        text: input.text,
        title: input.title ?? '',
        format: input.format,
        document: input.document,
      };
      pending.draft = null;
      return pending.note;
    }
    const note = this.database.createDesktopNote(input.id, undefined, {
      text: input.text,
      referenceAssetIds: input.referenceAssetIds,
      title: input.title,
      format: input.format,
      document: input.document,
      albumId: pending.note.albumId,
      color: pending.note.color,
      icon: pending.note.icon,
    });
    this.pending.delete(input.id);
    return note;
  }
  appearance(id: string, patch: { color?: PetalColor; icon?: PetalIcon }) {
    const pending = this.pending.get(id);
    if (!pending) return this.database.updateDesktopNoteAppearance(id, patch);
    pending.note = { ...pending.note, ...patch };
    return pending.note;
  }
  references(id: string, expectedHash: string, assetIds: string[]) {
    const note = this.get(id);
    if (!note.editable || note.contentHash !== expectedHash) throw petalError('unsaved');
    if (this.pending.has(id)) {
      const saved = this.database.createDesktopNote(id, undefined, {
        text: note.text,
        title: note.title,
        format: note.format,
        document: note.document,
        albumId: note.albumId,
        color: note.color,
        icon: note.icon,
        referenceAssetIds: assetIds,
      });
      this.pending.delete(id);
      return saved;
    }
    return this.database.db.transaction(() => {
      const { referenceAssets: _assets, ...content } = this.database.getInspirationStash(note.stashId).content;
      this.database.saveInspirationStash({
        mode: 'UPDATE',
        id: note.stashId,
        consumeCreationDraftId: null,
        expectedContentHash: expectedHash,
        content: { ...content, referenceAssetIds: assetIds },
      });
      this.database.contentLibrary.inheritNoteProjection(note.stashId, note.revisionId, note.elements);
      return this.get(id);
    })();
  }
  files(id: string, expectedHash: string, files: NoteFile[]) {
    const note = this.get(id);
    if (!note.editable || note.contentHash !== expectedHash) throw petalError('unsaved');
    if (this.pending.has(id)) {
      const saved = this.database.createDesktopNote(id, undefined, {
        text: note.text,
        title: note.title,
        format: note.format,
        document: note.document,
        albumId: note.albumId,
        color: note.color,
        icon: note.icon,
        referenceAssetIds: note.references.map((reference) => reference.assetId),
        files,
      });
      this.pending.delete(id);
      return saved;
    }
    return this.database.db.transaction(() => {
      const { referenceAssets: _assets, ...content } = this.database.getInspirationStash(note.stashId).content;
      this.database.saveInspirationStash({
        mode: 'UPDATE',
        id: note.stashId,
        consumeCreationDraftId: null,
        expectedContentHash: expectedHash,
        content: { ...content, files },
      });
      this.database.contentLibrary.inheritNoteProjection(note.stashId, note.revisionId, note.elements);
      return this.get(id);
    })();
  }
  checkpoint(input: DesktopNoteDraft) {
    const pending = this.pending.get(input.id);
    if (!pending) return this.database.checkpointDesktopNote(input);
    if (!pending.draft || input.sequence > pending.draft.sequence) pending.draft = input;
  }
  draft(id: string) {
    const pending = this.pending.get(id);
    if (!pending) return this.database.getDesktopNoteDraft(id);
    const draft = pending.draft;
    return draft
      ? {
          text: draft.text,
          title: draft.title,
          format: draft.format,
          document: draft.document,
          referenceAssetIds: draft.referenceAssetIds,
          elements: draft.elements,
          commentAnchors: draft.commentAnchors,
          expectedContentHash: draft.expectedContentHash,
          editorId: draft.editorId,
          sequence: draft.sequence,
        }
      : null;
  }
  recover(id: string) {
    const draft = this.pending.get(id)?.draft;
    if (draft && (draft.text.trim() || draft.title?.trim() || draft.referenceAssetIds?.length)) this.save(draft);
  }

  setAlbum(id: string, albumId: string | null) {
    if (albumId && !this.database.listAlbums().some((album) => album.id === albumId && !album.archivedAt))
      throw petalError('sourceUnavailable');
    const pending = this.pending.get(id);
    if (pending) {
      this.rememberAlbum(albumId);
      pending.note = { ...pending.note, albumId };
      return pending.note;
    }
    const note = this.get(id);
    this.database.db.transaction(() => {
      this.database.moveInspirationStash({ id: note.stashId, albumId });
      this.rememberAlbum(albumId);
    })();
    return this.get(id);
  }
  private lastAlbumId(): string | null {
    const row = this.database.db
      .prepare(
        "SELECT a.id FROM app_meta m JOIN albums a ON a.id=m.value WHERE m.key='desktop-petals.last-note-album' AND a.deleted_at IS NULL AND a.archived_at IS NULL",
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }
  private rememberAlbum(albumId: string | null) {
    this.database.db
      .prepare(
        "INSERT INTO app_meta(key,value) VALUES('desktop-petals.last-note-album',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(albumId ?? '');
  }
}
