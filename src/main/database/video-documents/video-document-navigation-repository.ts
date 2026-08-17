import type {
  VideoDocumentNavigationEntry,
  VideoDocumentNavigationListInput,
  VideoDocumentNavigationPage,
  VideoDocumentNavigationReorderInput,
} from '@/shared/contracts/video-document';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
import { videoDocumentSelect, videoDocumentSummaryDto } from '@/main/database/video-documents/video-document-values';

type AlbumNavigationEntry = Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>;

interface NavigationAlbumDetails {
  title: string;
  childCount: number;
  descendantDocumentCount: number;
  previewAssets: AlbumNavigationEntry['previewAssets'];
}

function encodeOffsetCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeOffsetCursor(value: string | null | undefined) {
  if (!value) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const offset = parsed && typeof parsed === 'object' && 'offset' in parsed ? parsed.offset : undefined;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw new Error('Invalid navigation cursor');
  }
}

function parentKey(parentAlbumId: string | null) {
  return parentAlbumId ? `ALBUM:${parentAlbumId}` : 'ROOT';
}

export class VideoDocumentNavigationRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  list(input: VideoDocumentNavigationListInput): VideoDocumentNavigationPage {
    const parentAlbumId = input.parentAlbumId ?? null;
    if (parentAlbumId) this.requireAlbum(parentAlbumId);
    const offset = decodeOffsetCursor(input.cursor);
    const limit = Math.min(input.limit ?? 50, 50);
    const navigationParentKey = parentKey(parentAlbumId);
    const rows = parentAlbumId
      ? (this.db
          .prepare(
            `WITH navigation AS (
              SELECT 'ALBUM' AS target_type, child.id AS target_id,
                member.sort_order AS membership_order, ordering.sort_order AS explicit_order,
                child.updated_at AS fallback_at
              FROM album_members member
              JOIN albums child ON child.id = member.target_id
                AND child.deleted_at IS NULL AND child.archived_at IS NULL
              LEFT JOIN video_document_navigation_order ordering
                ON ordering.parent_key = ? AND ordering.target_type = 'ALBUM' AND ordering.target_id = child.id
              WHERE member.album_id = ? AND member.target_type = 'ALBUM' AND member.deleted_at IS NULL
              UNION ALL
              SELECT 'DOCUMENT', document.id, member.sort_order, ordering.sort_order, document.updated_at
              FROM album_members member
              JOIN documents document ON document.id = member.target_id
                AND document.deleted_at IS NULL AND document.status = 'ACTIVE'
              LEFT JOIN video_document_navigation_order ordering
                ON ordering.parent_key = ? AND ordering.target_type = 'DOCUMENT' AND ordering.target_id = document.id
              WHERE member.album_id = ? AND member.target_type = 'DOCUMENT' AND member.deleted_at IS NULL
            )
            SELECT * FROM navigation
            ORDER BY explicit_order IS NULL, explicit_order, membership_order, fallback_at DESC, target_type, target_id
            LIMIT ? OFFSET ?`,
          )
          .all(navigationParentKey, parentAlbumId, navigationParentKey, parentAlbumId, limit + 1, offset) as JsonMap[])
      : (this.db
          .prepare(
            `WITH navigation AS (
              SELECT 'ALBUM' AS target_type, album.id AS target_id,
                NULL AS membership_order, ordering.sort_order AS explicit_order,
                album.updated_at AS fallback_at
              FROM albums album
              LEFT JOIN video_document_navigation_order ordering
                ON ordering.parent_key = 'ROOT' AND ordering.target_type = 'ALBUM' AND ordering.target_id = album.id
              WHERE album.deleted_at IS NULL AND album.archived_at IS NULL AND album.intent <> ?
                AND NOT EXISTS (
                  SELECT 1 FROM album_members owner
                  WHERE owner.target_type = 'ALBUM' AND owner.target_id = album.id AND owner.deleted_at IS NULL
                )
              UNION ALL
              SELECT 'DOCUMENT', document.id, NULL, ordering.sort_order, document.updated_at
              FROM documents document
              LEFT JOIN video_document_navigation_order ordering
                ON ordering.parent_key = 'ROOT' AND ordering.target_type = 'DOCUMENT'
                AND ordering.target_id = document.id
              WHERE document.deleted_at IS NULL AND document.status = 'ACTIVE'
                AND NOT EXISTS (
                  SELECT 1 FROM album_members placement
                  WHERE placement.target_type = 'DOCUMENT' AND placement.target_id = document.id
                    AND placement.deleted_at IS NULL
                )
            )
            SELECT * FROM navigation
            ORDER BY explicit_order IS NULL, explicit_order, fallback_at DESC, target_type, target_id
            LIMIT ? OFFSET ?`,
          )
          .all(MATERIAL_LIBRARY_ALBUM_INTENT, limit + 1, offset) as JsonMap[]);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: this.entries(pageRows, parentAlbumId),
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
    };
  }

  reorder(input: VideoDocumentNavigationReorderInput) {
    const parentAlbumId = input.parentAlbumId ?? null;
    if (parentAlbumId) this.requireAlbum(parentAlbumId);
    const navigationParentKey = parentKey(parentAlbumId);
    const uniqueTargets = new Map<string, VideoDocumentNavigationReorderInput['targets'][number]>();
    for (const target of input.targets) uniqueTargets.set(`${target.kind}:${target.targetId}`, target);
    if (uniqueTargets.size !== input.targets.length) throw new Error('VIDEO_DOCUMENT_NAVIGATION_DUPLICATE_TARGET');
    const valid = this.validTargetKeys(parentAlbumId, input.targets);
    if (input.targets.some((target) => !valid.has(`${target.kind}:${target.targetId}`))) {
      throw new Error('VIDEO_DOCUMENT_NAVIGATION_TARGET_CHANGED');
    }
    const timestamp = now();
    this.db
      .transaction(() => {
        const upsert = this.db.prepare(
          `INSERT INTO video_document_navigation_order(parent_key, target_type, target_id, sort_order, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(parent_key, target_type, target_id) DO UPDATE SET
            sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
        );
        input.targets.forEach((target, index) =>
          upsert.run(navigationParentKey, target.kind, target.targetId, index, timestamp),
        );
        this.storage.recordChange('VIDEO_DOCUMENT_NAVIGATION', navigationParentKey, 'REORDER', {
          targets: input.targets,
        });
      })
      .immediate();
  }

  private entries(rows: JsonMap[], parentAlbumId: string | null) {
    const albumIds = rows.filter((row) => text(row.target_type) === 'ALBUM').map((row) => text(row.target_id));
    const documentIds = rows.filter((row) => text(row.target_type) === 'DOCUMENT').map((row) => text(row.target_id));
    const documentsById = new Map<string, ReturnType<typeof videoDocumentSummaryDto>>();
    if (documentIds.length) {
      const documents = this.db
        .prepare(`${videoDocumentSelect} WHERE document.id IN (${documentIds.map(() => '?').join(',')})`)
        .all(...documentIds) as JsonMap[];
      for (const row of documents) documentsById.set(text(row.id), videoDocumentSummaryDto(row));
    }
    const albumsById = this.albumDetails(albumIds);
    return rows.flatMap((row): VideoDocumentNavigationEntry[] => {
      const targetId = text(row.target_id);
      const explicitOrder = row.explicit_order === null ? null : Number(row.explicit_order);
      const membershipOrder = row.membership_order === null ? null : Number(row.membership_order);
      if (text(row.target_type) === 'ALBUM') {
        const album = albumsById.get(targetId);
        return album
          ? [
              {
                nodeId: `ALBUM:${targetId}`,
                kind: 'ALBUM',
                albumId: targetId,
                parentAlbumId,
                title: album.title,
                sortOrder: explicitOrder ?? membershipOrder,
                childCount: album.childCount,
                descendantDocumentCount: album.descendantDocumentCount,
                previewAssets: album.previewAssets,
              },
            ]
          : [];
      }
      const document = documentsById.get(targetId);
      return document
        ? [
            {
              nodeId: `DOCUMENT:${targetId}`,
              kind: 'DOCUMENT',
              documentId: targetId,
              parentAlbumId,
              sortOrder: explicitOrder ?? membershipOrder,
              document,
            },
          ]
        : [];
    });
  }

  private albumDetails(albumIds: string[]) {
    const details = new Map<string, NavigationAlbumDetails>();
    if (!albumIds.length) return details;
    const placeholders = albumIds.map(() => '?').join(',');
    const albums = this.db
      .prepare(`SELECT id, title FROM albums WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
      .all(...albumIds) as JsonMap[];
    for (const album of albums) {
      details.set(text(album.id), {
        title: text(album.title),
        childCount: 0,
        descendantDocumentCount: 0,
        previewAssets: [],
      });
    }
    const counts = this.db
      .prepare(
        `SELECT member.album_id, COUNT(*) AS child_count
        FROM album_members member
        LEFT JOIN albums child_album ON member.target_type = 'ALBUM' AND child_album.id = member.target_id
          AND child_album.deleted_at IS NULL AND child_album.archived_at IS NULL
        LEFT JOIN documents child_document ON member.target_type = 'DOCUMENT' AND child_document.id = member.target_id
          AND child_document.deleted_at IS NULL AND child_document.status = 'ACTIVE'
        WHERE member.album_id IN (${placeholders}) AND member.deleted_at IS NULL
          AND (child_album.id IS NOT NULL OR child_document.id IS NOT NULL)
        GROUP BY member.album_id`,
      )
      .all(...albumIds) as JsonMap[];
    for (const count of counts) {
      const detail = details.get(text(count.album_id));
      if (detail) detail.childCount = Number(count.child_count);
    }
    const documentCounts = this.db
      .prepare(
        `WITH RECURSIVE album_tree(root_album_id, album_id) AS (
          SELECT id, id FROM albums
          WHERE id IN (${placeholders}) AND deleted_at IS NULL AND archived_at IS NULL
          UNION
          SELECT tree.root_album_id, child.id
          FROM album_tree tree
          JOIN album_members member ON member.album_id = tree.album_id
            AND member.target_type = 'ALBUM' AND member.deleted_at IS NULL
          JOIN albums child ON child.id = member.target_id
            AND child.deleted_at IS NULL AND child.archived_at IS NULL
        )
        SELECT tree.root_album_id AS album_id, COUNT(DISTINCT document.id) AS document_count
        FROM album_tree tree
        JOIN album_members member ON member.album_id = tree.album_id
          AND member.target_type = 'DOCUMENT' AND member.deleted_at IS NULL
        JOIN documents document ON document.id = member.target_id
          AND document.deleted_at IS NULL AND document.status = 'ACTIVE'
        GROUP BY tree.root_album_id`,
      )
      .all(...albumIds) as JsonMap[];
    for (const count of documentCounts) {
      const detail = details.get(text(count.album_id));
      if (detail) detail.descendantDocumentCount = Number(count.document_count);
    }
    const previews = this.db
      .prepare(
        `WITH RECURSIVE album_tree(root_album_id, album_id) AS (
          SELECT id, id FROM albums
          WHERE id IN (${placeholders}) AND deleted_at IS NULL AND archived_at IS NULL
          UNION
          SELECT tree.root_album_id, child.id
          FROM album_tree tree
          JOIN album_members child_member ON child_member.album_id = tree.album_id
            AND child_member.target_type = 'ALBUM' AND child_member.deleted_at IS NULL
          JOIN albums child ON child.id = child_member.target_id
            AND child.deleted_at IS NULL AND child.archived_at IS NULL
        ), document_previews AS (
          SELECT DISTINCT tree.root_album_id AS album_id, document.id AS document_id,
            document.updated_at,
            thumbnail_asset.id AS asset_id, thumbnail_asset.kind AS asset_kind,
            thumbnail_asset.origin_type AS origin_type, thumbnail_asset.width AS width,
            thumbnail_asset.height AS height, thumbnail_asset.mime_type AS mime_type,
            thumbnail_asset.byte_size AS byte_size, thumbnail_asset.created_at AS created_at
          FROM album_tree tree
          JOIN album_members member ON member.album_id = tree.album_id
            AND member.target_type = 'DOCUMENT' AND member.deleted_at IS NULL
          JOIN documents document ON document.id = member.target_id
            AND document.deleted_at IS NULL AND document.status = 'ACTIVE'
          JOIN document_thumbnails thumbnail ON thumbnail.document_id = document.id
          JOIN image_assets thumbnail_asset ON thumbnail_asset.id = thumbnail.image_asset_id
            AND thumbnail_asset.mime_type LIKE 'image/%' AND thumbnail_asset.deleted_at IS NULL
        ), ranked_previews AS (
          SELECT album_id, asset_id, asset_kind, origin_type, width, height, mime_type, byte_size, created_at,
            ROW_NUMBER() OVER (
              PARTITION BY album_id ORDER BY updated_at DESC, document_id
            ) AS preview_rank
          FROM document_previews
        )
        SELECT album_id, asset_id, asset_kind, origin_type, width, height, mime_type, byte_size, created_at
        FROM ranked_previews
        WHERE preview_rank <= 4
        ORDER BY album_id, preview_rank`,
      )
      .all(...albumIds) as JsonMap[];
    for (const preview of previews) {
      const detail = details.get(text(preview.album_id));
      if (!detail) continue;
      const assetId = text(preview.asset_id);
      detail.previewAssets.push({
        id: assetId,
        kind: text(preview.asset_kind) === 'GENERATED' ? 'GENERATED' : 'REFERENCE',
        originType: text(preview.origin_type),
        mediaUrl: mediaUrl(assetId),
        width: Number(preview.width),
        height: Number(preview.height),
        mimeType: text(preview.mime_type),
        byteSize: Number(preview.byte_size),
        createdAt: text(preview.created_at),
      });
    }
    return details;
  }

  private validTargetKeys(parentAlbumId: string | null, targets: VideoDocumentNavigationReorderInput['targets']) {
    const valid = new Set<string>();
    const albumIds = [...new Set(targets.filter((target) => target.kind === 'ALBUM').map((target) => target.targetId))];
    const documentIds = [
      ...new Set(targets.filter((target) => target.kind === 'DOCUMENT').map((target) => target.targetId)),
    ];
    if (albumIds.length) this.collectValidAlbumIds(valid, parentAlbumId, albumIds);
    if (documentIds.length) this.collectValidDocumentIds(valid, parentAlbumId, documentIds);
    return valid;
  }

  private collectValidAlbumIds(valid: Set<string>, parentAlbumId: string | null, albumIds: string[]) {
    const placeholders = albumIds.map(() => '?').join(',');
    const rows = parentAlbumId
      ? (this.db
          .prepare(
            `SELECT child.id FROM album_members member
            JOIN albums child ON child.id = member.target_id
              AND child.deleted_at IS NULL AND child.archived_at IS NULL
            WHERE member.album_id = ? AND member.target_type = 'ALBUM' AND member.deleted_at IS NULL
              AND child.id IN (${placeholders})`,
          )
          .all(parentAlbumId, ...albumIds) as JsonMap[])
      : (this.db
          .prepare(
            `SELECT album.id FROM albums album
            WHERE album.id IN (${placeholders}) AND album.deleted_at IS NULL AND album.archived_at IS NULL
              AND album.intent <> ? AND NOT EXISTS (
                SELECT 1 FROM album_members owner
                WHERE owner.target_type = 'ALBUM' AND owner.target_id = album.id AND owner.deleted_at IS NULL
              )`,
          )
          .all(...albumIds, MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[]);
    for (const row of rows) valid.add(`ALBUM:${text(row.id)}`);
  }

  private collectValidDocumentIds(valid: Set<string>, parentAlbumId: string | null, documentIds: string[]) {
    const placeholders = documentIds.map(() => '?').join(',');
    const rows = parentAlbumId
      ? (this.db
          .prepare(
            `SELECT document.id FROM album_members member
            JOIN documents document ON document.id = member.target_id
              AND document.deleted_at IS NULL AND document.status = 'ACTIVE'
            WHERE member.album_id = ? AND member.target_type = 'DOCUMENT' AND member.deleted_at IS NULL
              AND document.id IN (${placeholders})`,
          )
          .all(parentAlbumId, ...documentIds) as JsonMap[])
      : (this.db
          .prepare(
            `SELECT document.id FROM documents document
            WHERE document.id IN (${placeholders}) AND document.deleted_at IS NULL AND document.status = 'ACTIVE'
              AND NOT EXISTS (
                SELECT 1 FROM album_members placement
                WHERE placement.target_type = 'DOCUMENT' AND placement.target_id = document.id
                  AND placement.deleted_at IS NULL
              )`,
          )
          .all(...documentIds) as JsonMap[]);
    for (const row of rows) valid.add(`DOCUMENT:${text(row.id)}`);
  }

  private requireAlbum(albumId: string) {
    const album = this.db.prepare('SELECT archived_at FROM albums WHERE id = ? AND deleted_at IS NULL').get(albumId) as
      JsonMap | undefined;
    if (!album) throw new Error('Album not found');
    if (album.archived_at) throw new Error('Archived albums cannot receive documents');
  }
}
