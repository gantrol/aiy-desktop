import type { CreationVideoAttachmentDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';

export function creationDraftVideoMaterialIds(db: LibraryStorage['db'], draftId: string): string[] {
  return (
    db
      .prepare(
        `SELECT material.id FROM creation_draft_materials link
    JOIN materials material ON material.id = link.material_id
    WHERE link.creation_draft_id = ? AND material.kind = 'VIDEO' AND material.deleted_at IS NULL
    ORDER BY link.sort_order`,
      )
      .all(draftId) as JsonMap[]
  ).map((row) => text(row.id));
}

/** One bounded material lookup; ordering follows the caller's attachment list. */
export function creationVideoAttachments(
  db: LibraryStorage['db'],
  ids: readonly string[],
): CreationVideoAttachmentDto[] {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)];
  const rows = db
    .prepare(
      `SELECT asset.*, material.id AS material_id, video.duration_ms,
      metadata.display_name, metadata.original_name
    FROM materials material
    JOIN image_assets asset ON asset.id = material.image_asset_id
    JOIN video_assets video ON video.image_asset_id = asset.id
    LEFT JOIN external_material_metadata metadata ON metadata.material_id = material.id
    WHERE material.kind = 'VIDEO' AND material.deleted_at IS NULL AND asset.deleted_at IS NULL
      AND material.id IN (${uniqueIds.map(() => '?').join(', ')})`,
    )
    .all(...uniqueIds) as JsonMap[];
  const byId = new Map(
    rows.map((row): [string, CreationVideoAttachmentDto] => {
      const materialId = text(row.material_id);
      const id = text(row.id);
      return [
        materialId,
        {
          materialId,
          name: text(row.display_name) || text(row.original_name) || 'Video',
          durationMs: Number(row.duration_ms),
          asset: {
            id,
            kind: text(row.kind) as 'REFERENCE' | 'GENERATED',
            originType: text(row.origin_type),
            width: Number(row.width),
            height: Number(row.height),
            mimeType: text(row.mime_type),
            byteSize: Number(row.byte_size),
            mediaUrl: mediaUrl(id),
            createdAt: text(row.created_at),
          },
        },
      ];
    }),
  );
  return uniqueIds.flatMap((id) => byId.get(id) ?? []);
}
