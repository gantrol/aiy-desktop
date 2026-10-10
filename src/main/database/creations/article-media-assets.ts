import type Database from 'better-sqlite3';
import type { AssetDto } from '@/shared/contracts';
import { mediaUrl, text, type JsonMap } from '@/main/database/core/values';

function assetDto(row: JsonMap): AssetDto {
  const id = text(row.id);
  return {
    id,
    kind: text(row.kind) as AssetDto['kind'],
    originType: text(row.origin_type),
    width: Number(row.width),
    height: Number(row.height),
    mimeType: text(row.mime_type),
    byteSize: Number(row.byte_size),
    mediaUrl: mediaUrl(id),
    createdAt: text(row.created_at),
  };
}

export function readArticleMediaAssets(db: Database.Database, ids: readonly string[]) {
  const byId = new Map<string, AssetDto>();
  const uniqueIds = [...new Set(ids)];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const chunk = uniqueIds.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT * FROM image_assets WHERE deleted_at IS NULL AND id IN (${placeholders})`)
      .all(...chunk) as JsonMap[];
    for (const row of rows) byId.set(text(row.id), assetDto(row));
  }
  return byId;
}
