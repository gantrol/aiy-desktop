import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { mediaUrl, type JsonMap } from '@/main/database/core/values';
import { pinSourceProjection, pinSourceQueries } from '@/main/database/creations/petal-pin-sources';
import { AlbumProjectionRepository } from '@/main/database/albums/album-projection-repository';
import {
  desktopPinSchema,
  petalLayerSchema,
  pinSummarySchema,
  type PinSource,
  type PinSearch,
  type PetalLayer,
} from '@/shared/contracts/petal-board';
import type { PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { blockDocumentSchema } from '@/shared/contracts/block-document';
import { petalError } from '@/shared/petal-errors';
const colors: PetalColor[] = ['rose', 'cream', 'sage', 'sky', 'lilac'];
function summary(row: JsonMap) {
  return pinSummarySchema.parse({
    source: { kind: row.kind, id: row.id },
    title: row.title,
    preview:
      typeof row.document_json === 'string'
        ? blockDocumentMarkdown(blockDocumentSchema.parse(JSON.parse(row.document_json))).slice(0, 4000)
        : row.preview,
    mediaUrl: typeof row.asset_id === 'string' ? mediaUrl(row.asset_id) : null,
  });
}
export class PetalBoardRepository {
  private albumCovers = new Map<string, string | null>();
  constructor(private readonly storage: LibraryStorage) {}
  private get db() {
    return this.storage.db;
  }
  search(input: PinSearch) {
    const rows = this.db
      .prepare(
        `SELECT ? AS kind, source.* FROM (${pinSourceQueries[input.kind]}) source
      WHERE deleted_at IS NULL AND status='ACTIVE' AND (title LIKE ? OR id LIKE ?)
      ORDER BY updated DESC, id LIMIT 30 OFFSET ?`,
      )
      .all(input.kind, '%' + input.query + '%', '%' + input.query + '%', input.offset) as JsonMap[];
    return rows.map(summary);
  }
  list() {
    const rows = this.db
      .prepare(
        `WITH sources AS (${pinSourceProjection})
      SELECT s.*, p.id AS pin_id, p.color, p.icon, COALESCE(m.layer_id,'default') AS layer_id
      FROM desktop_content_pins p JOIN sources s ON s.kind=p.source_kind AND s.id=p.source_id
      LEFT JOIN desktop_petal_memberships m ON m.instance_id=p.id
      WHERE s.deleted_at IS NULL AND s.status='ACTIVE' ORDER BY p.id`,
      )
      .all() as JsonMap[];
    return this.withAlbumPreviews(rows).map((row) =>
      desktopPinSchema.parse({
        ...summary(row),
        id: row.pin_id,
        color: row.color,
        icon: row.icon,
        layerId: row.layer_id,
      }),
    );
  }
  private withAlbumPreviews(rows: JsonMap[]) {
    const albumIds = rows
      .filter((row) => row.kind === 'ALBUM' || row.kind === 'MATERIAL_ALBUM')
      .map((row) => String(row.id));
    const active = new Set(albumIds);
    for (const id of this.albumCovers.keys()) if (!active.has(id)) this.albumCovers.delete(id);
    if (!albumIds.length) return rows;
    // Reuse album cover ordering in one bounded query, without reading members or media files per pin.
    const missing = albumIds.filter((id) => !this.albumCovers.has(id));
    if (missing.length) {
      const previews = new AlbumProjectionRepository(this.storage).listPreviewAssets(missing);
      for (const id of missing) {
        const album = previews.get(id);
        const cover = [...(album?.previewAssets ?? []), ...(album?.documentPreviewAssets ?? [])].find((asset) =>
          asset.mimeType.startsWith('image/'),
        );
        this.albumCovers.set(id, cover?.id ?? null);
      }
    }
    return rows.map((row) => {
      if (row.kind !== 'ALBUM' && row.kind !== 'MATERIAL_ALBUM') return row;
      return { ...row, asset_id: this.albumCovers.get(String(row.id)) ?? null };
    });
  }
  pin(source: PinSource, layerId: string) {
    return this.db.transaction(() => {
      this.requireLayer(layerId);
      const row = this.db
        .prepare(
          `SELECT id FROM (${pinSourceQueries[source.kind]}) WHERE id=? AND deleted_at IS NULL AND status='ACTIVE'`,
        )
        .get(source.id);
      if (!row) throw petalError('sourceUnavailable');
      if (source.kind === 'ARTICLE') {
        const existing = this.db
          .prepare('SELECT id FROM desktop_note_instances WHERE stash_id=? ORDER BY created_at,id LIMIT 1')
          .get(source.id) as { id: string } | undefined;
        if (existing) return existing.id;
        const id = 'article:' + ulid();
        this.db
          .prepare(
            "INSERT INTO desktop_note_instances(id,stash_id,color,icon,created_at,updated_at) VALUES(?,?,'cream','feather',?,?)",
          )
          .run(id, source.id, new Date().toISOString(), new Date().toISOString());
        this.assign(id, layerId);
        return id;
      }
      const existing = this.db
        .prepare('SELECT id FROM desktop_content_pins WHERE source_kind=? AND source_id=?')
        .get(source.kind, source.id) as { id: string } | undefined;
      if (existing) return existing.id;
      if ((this.db.prepare('SELECT COUNT(*) AS n FROM desktop_content_pins').get() as { n: number }).n >= 200)
        throw petalError('pinLimit');
      const id = 'pin:' + ulid();
      this.db
        .prepare('INSERT INTO desktop_content_pins(id,source_kind,source_id) VALUES (?,?,?)')
        .run(id, source.kind, source.id);
      this.assign(id, layerId);
      return id;
    })();
  }
  appearance(id: string, patch: { color?: PetalColor; icon?: PetalIcon }) {
    this.db
      .prepare('UPDATE desktop_content_pins SET color=COALESCE(?,color), icon=COALESCE(?,icon) WHERE id=?')
      .run(patch.color ?? null, patch.icon ?? null, id);
  }
  remove(id: string) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM desktop_petal_memberships WHERE instance_id=?').run(id);
      this.db.prepare('DELETE FROM desktop_content_pins WHERE id=?').run(id);
    })();
  }
  reconcile() {
    this.albumCovers.clear();
    const removed = this.db
      .prepare(
        `WITH sources AS (${pinSourceProjection})
      SELECT p.id FROM desktop_content_pins p LEFT JOIN sources s ON s.kind=p.source_kind AND s.id=p.source_id
      WHERE s.id IS NULL OR s.deleted_at IS NOT NULL`,
      )
      .all() as { id: string }[];
    this.db.transaction(() => {
      for (const { id } of removed) this.remove(id);
    })();
    return removed.map((row) => row.id);
  }
  layers(): PetalLayer[] {
    return this.db
      .prepare("SELECT id,name,color FROM desktop_petal_layers ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END,id")
      .all()
      .map((row) => petalLayerSchema.parse(row));
  }
  memberships(): Record<string, string> {
    return Object.fromEntries(
      (
        this.db.prepare('SELECT instance_id,layer_id FROM desktop_petal_memberships').all() as {
          instance_id: string;
          layer_id: string;
        }[]
      ).map((row) => [row.instance_id, row.layer_id]),
    );
  }
  private requireLayer(id: string) {
    if (!this.layers().some((layer) => layer.id === id)) throw petalError('invalidSettings');
  }
  createLayer(name: string) {
    const layers = this.layers();
    if (layers.length >= 8) throw petalError('layerLimit');
    const id = ulid();
    this.db
      .prepare('INSERT INTO desktop_petal_layers(id,name,color) VALUES (?,?,?)')
      .run(id, name, colors[layers.length % colors.length]);
    return id;
  }
  renameLayer(id: string, name: string) {
    this.requireLayer(id);
    this.db.prepare('UPDATE desktop_petal_layers SET name=? WHERE id=?').run(name, id);
  }
  removeLayer(id: string) {
    if (id === 'default') throw petalError('invalidSettings');
    this.db.transaction(() => {
      this.db.prepare('UPDATE desktop_petal_memberships SET layer_id=? WHERE layer_id=?').run('default', id);
      this.db.prepare('DELETE FROM desktop_petal_layers WHERE id=?').run(id);
    })();
  }
  assign(id: string, layerId: string) {
    this.requireLayer(layerId);
    this.db
      .prepare(
        'INSERT INTO desktop_petal_memberships(instance_id,layer_id) VALUES (?,?) ON CONFLICT(instance_id) DO UPDATE SET layer_id=excluded.layer_id',
      )
      .run(id, layerId);
  }
  forget(id: string) {
    this.db.prepare('DELETE FROM desktop_petal_memberships WHERE instance_id=?').run(id);
  }
}
