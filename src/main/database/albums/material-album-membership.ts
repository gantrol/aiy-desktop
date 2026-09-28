import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';
import { ensureImageMaterials, sqlPlaceholders } from '@/main/database/albums/image-material-batch';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import { assetDto } from '@/main/database/albums/material-album-scopes';
import type { MaterialAlbumRepository } from '@/main/database/albums/material-album-repository';
import type { MaterialAlbumMemberDto } from '@/shared/contracts';
import {
  materialAlbumMembershipApplySchema,
  type MaterialAlbumMembershipApplyInput,
  type MaterialAlbumMembershipApplyResult,
  type MaterialAlbumMembershipPatch,
} from '@/shared/contracts/material-album-membership';

class MembershipFailure extends Error {
  constructor(readonly status: 'CONFLICT' | 'UNAVAILABLE' | 'WRONG_LIBRARY') {
    super(status);
  }
}

function assertDestinations(storage: LibraryStorage, ids: string[]) {
  if (!ids.length) return;
  const rows = storage.db
    .prepare(
      `WITH RECURSIVE lineage(root_id, id, unavailable) AS (
    SELECT id, id, deleted_at IS NOT NULL OR archived_at IS NOT NULL FROM albums
    WHERE id IN (${sqlPlaceholders(ids.length)}) AND intent = ?
    UNION
    SELECT child.root_id, parent.id, parent.deleted_at IS NOT NULL OR parent.archived_at IS NOT NULL
    FROM lineage child JOIN album_members edge
      ON edge.target_type = 'ALBUM' AND edge.target_id = child.id AND edge.deleted_at IS NULL
    JOIN albums parent ON parent.id = edge.album_id
  ) SELECT root_id FROM lineage GROUP BY root_id HAVING MAX(unavailable) = 0`,
    )
    .all(...ids, MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
  if (rows.length !== ids.length) throw new MembershipFailure('UNAVAILABLE');
}

function currentMemberships(storage: LibraryStorage, input: MaterialAlbumMembershipApplyInput) {
  const ids = input.changes.map((change) => change.albumId);
  if (!ids.length) return new Map<string, JsonMap>();
  const target = input.target;
  const rows = storage.db
    .prepare(
      `SELECT edge.* FROM album_members edge
    JOIN materials material ON material.id = edge.target_id AND material.deleted_at IS NULL
    WHERE edge.album_id IN (${sqlPlaceholders(ids.length)}) AND edge.target_type = 'MATERIAL'
      AND edge.deleted_at IS NULL AND ${target.kind === 'MATERIAL' ? 'material.id' : 'material.image_asset_id'} = ?`,
    )
    .all(...ids, target.kind === 'MATERIAL' ? target.materialId : target.imageAssetId) as JsonMap[];
  const result = new Map<string, JsonMap>();
  for (const row of rows) {
    const albumId = text(row.album_id);
    // An asset-only reference cannot safely edit ambiguous legacy material identities.
    if (result.has(albumId)) throw new MembershipFailure('CONFLICT');
    result.set(albumId, row);
  }
  for (const change of input.changes) {
    const current = result.get(change.albumId);
    if (
      change.expected
        ? !current || current.id !== change.expected.id || current.updated_at !== change.expected.updatedAt
        : Boolean(current)
    )
      throw new MembershipFailure('CONFLICT');
  }
  return result;
}

function requireMaterial(storage: LibraryStorage, materialId: string) {
  const row = storage.db
    .prepare(
      `SELECT material.kind AS material_kind, material.text_content,
    asset.* FROM materials material LEFT JOIN image_assets asset
      ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
    WHERE material.id = ? AND material.deleted_at IS NULL AND material.archived_at IS NULL
      AND (material.kind = 'TEXT' OR (material.kind IN ('IMAGE', 'VIDEO') AND asset.id IS NOT NULL))`,
    )
    .get(materialId) as JsonMap | undefined;
  if (!row) throw new MembershipFailure('UNAVAILABLE');
  return row;
}

function writeMemberships(
  storage: LibraryStorage,
  input: MaterialAlbumMembershipApplyInput,
  current: Map<string, JsonMap>,
  materialId: string,
) {
  const db = storage.db;
  const ids = input.changes.map((change) => change.albumId);
  const patches: MaterialAlbumMembershipPatch[] = [];
  if (!ids.length) return patches;
  const material = requireMaterial(storage, materialId);
  const orders = new Map(
    (
      db
        .prepare(
          `SELECT album_id, COALESCE(MAX(sort_order), -1) + 1 AS next_order
    FROM album_members WHERE album_id IN (${sqlPlaceholders(ids.length)}) AND deleted_at IS NULL
    GROUP BY album_id`,
        )
        .all(...ids) as JsonMap[]
    ).map((row) => [text(row.album_id), Number(row.next_order)]),
  );
  const prior = new Map(
    (
      db
        .prepare(
          `SELECT * FROM album_members
    WHERE album_id IN (${sqlPlaceholders(ids.length)}) AND target_type = 'MATERIAL' AND target_id = ?`,
        )
        .all(...ids, materialId) as JsonMap[]
    ).map((row) => [text(row.album_id), row]),
  );
  const insert = db.prepare(`INSERT INTO album_members
    (id, album_id, target_type, target_id, sort_order, created_at, updated_at)
    VALUES (?, ?, 'MATERIAL', ?, ?, ?, ?)`);
  const restore = db.prepare('UPDATE album_members SET deleted_at = NULL, updated_at = ?, sort_order = ? WHERE id = ?');
  const remove = db.prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?');
  const tombstone = db.prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')");
  const touch = db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?');
  for (const change of input.changes) {
    const existing = current.get(change.albumId);
    if (Boolean(existing) === change.checked) continue;
    const timestamp = now();
    let member: MaterialAlbumMemberDto | null = null;
    if (change.checked) {
      const old = prior.get(change.albumId);
      const id = old ? text(old.id) : ulid();
      const order = orders.get(change.albumId) ?? 0;
      if (old) restore.run(timestamp, order, id);
      else insert.run(id, change.albumId, materialId, order, timestamp, timestamp);
      storage.recordChange('ALBUM_MEMBER', id, old ? 'RESTORE' : 'CREATE', {
        albumId: change.albumId,
        materialId,
        sortOrder: order,
      });
      const kind = text(material.material_kind) as MaterialAlbumMemberDto['kind'];
      member = {
        id,
        albumId: change.albumId,
        materialId,
        kind,
        imageAsset: kind === 'TEXT' ? null : assetDto(material),
        text: kind === 'TEXT' ? text(material.text_content) : null,
        sortOrder: order,
        createdAt: old ? text(old.created_at) : timestamp,
        updatedAt: timestamp,
      };
    } else if (existing) {
      remove.run(timestamp, timestamp, existing.id);
      tombstone.run(ulid(), existing.id, timestamp);
      storage.recordChange('ALBUM_MEMBER', text(existing.id), 'DELETE', {
        albumId: change.albumId,
        materialId: existing.target_id,
      });
    }
    touch.run(timestamp, change.albumId);
    patches.push({
      albumId: change.albumId,
      previousMemberId: existing ? text(existing.id) : null,
      member,
      updatedAt: timestamp,
    });
  }
  return patches;
}

/** Validate first, then commit the staged album and all direct memberships together. */
export function applyMaterialAlbumMembership(
  storage: LibraryStorage,
  albums: MaterialAlbumRepository,
  raw: MaterialAlbumMembershipApplyInput,
): MaterialAlbumMembershipApplyResult {
  const input = materialAlbumMembershipApplySchema.parse(raw);
  try {
    return storage.db
      .transaction((): MaterialAlbumMembershipApplyResult => {
        if (storage.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== input.spaceId)
          throw new MembershipFailure('WRONG_LIBRARY');
        assertDestinations(storage, [
          ...new Set([
            ...input.changes.map((change) => change.albumId),
            ...(input.create?.parentAlbumId ? [input.create.parentAlbumId] : []),
          ]),
        ]);
        const current = currentMemberships(storage, input);
        const materialId =
          input.target.kind === 'MATERIAL'
            ? input.target.materialId
            : ensureImageMaterials(storage, [input.target.imageAssetId])[0];
        requireMaterial(storage, materialId);
        const createdAlbum = input.create
          ? albums.create({
              ...input.create,
              parentAlbumId: input.create.parentAlbumId ?? undefined,
              locale: input.locale,
            })
          : null;
        const changes = createdAlbum
          ? [...input.changes, { albumId: createdAlbum.id, checked: true, expected: null }]
          : input.changes;
        const patches = writeMemberships(storage, { ...input, changes }, current, materialId);
        return { status: 'APPLIED', patches, createdAlbum };
      })
      .immediate();
  } catch (error) {
    return { status: error instanceof MembershipFailure ? error.status : 'FAILED' };
  }
}
