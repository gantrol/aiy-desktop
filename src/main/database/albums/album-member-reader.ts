import type Database from 'better-sqlite3';
import type { AlbumMemberDto, AssetDto, Locale } from '@/shared/contracts';
import { resolveStoredTitle, titleLocalizationsByOwner } from '@/main/database/core/title-localization';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';

function assetDto(row: JsonMap): AssetDto {
  const id = text(row.asset_id);
  return {
    id,
    kind: text(row.asset_kind) as AssetDto['kind'],
    originType: text(row.asset_origin_type),
    width: Number(row.asset_width),
    height: Number(row.asset_height),
    mimeType: text(row.asset_mime_type),
    byteSize: Number(row.asset_byte_size),
    mediaUrl: mediaUrl(id),
    createdAt: text(row.asset_created_at),
  };
}

export function albumMemberDtosByAlbum(
  db: Database.Database,
  albumId: string | null = null,
  locale: Locale = 'zh',
): Map<string, AlbumMemberDto[]> {
  const rows = db
    .prepare(
      `SELECT member.*,
        material.kind AS material_kind,
        material.text_content AS material_text,
        asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
        asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
        asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at,
        child_album.title AS child_album_title, child_album.title_locale AS child_album_title_locale
      FROM album_members member
      LEFT JOIN materials material ON member.target_type = 'MATERIAL'
        AND material.id = member.target_id AND material.deleted_at IS NULL AND material.archived_at IS NULL
      LEFT JOIN image_assets asset ON material.kind IN ('IMAGE', 'VIDEO')
        AND asset.id = material.image_asset_id AND asset.deleted_at IS NULL
      LEFT JOIN albums child_album ON member.target_type = 'ALBUM'
        AND child_album.id = member.target_id AND child_album.deleted_at IS NULL
      LEFT JOIN creation_items creation_item ON member.target_type = 'CREATION_ITEM'
        AND creation_item.id = member.target_id
        AND creation_item.archived_at IS NULL AND creation_item.deleted_at IS NULL
      JOIN albums owner_album ON owner_album.id = member.album_id AND owner_album.deleted_at IS NULL
      WHERE (? IS NULL OR member.album_id = ?) AND member.deleted_at IS NULL
        AND (
          (member.target_type = 'MATERIAL' AND material.id IS NOT NULL
            AND (material.kind = 'TEXT' OR asset.id IS NOT NULL))
          OR (member.target_type = 'ALBUM' AND child_album.id IS NOT NULL)
          OR (member.target_type = 'CREATION_ITEM' AND creation_item.id IS NOT NULL)
        )
      ORDER BY member.album_id, member.sort_order, member.id`,
    )
    .all(albumId, albumId) as JsonMap[];
  const childAlbumIds = rows.filter((row) => text(row.target_type) === 'ALBUM').map((row) => text(row.target_id));
  const albumLocalizations = titleLocalizationsByOwner(db, 'ALBUM', childAlbumIds);
  const result = new Map<string, AlbumMemberDto[]>();
  for (const row of rows) {
    const targetType = text(row.target_type) as AlbumMemberDto['targetType'];
    const memberAlbumId = text(row.album_id);
    const targetId = text(row.target_id);
    const member: AlbumMemberDto = {
      id: text(row.id),
      albumId: memberAlbumId,
      targetType,
      targetId,
      sortOrder: Number(row.sort_order),
      imageAsset: targetType === 'MATERIAL' && text(row.material_kind) !== 'TEXT' ? assetDto(row) : null,
      materialText: targetType === 'MATERIAL' && text(row.material_kind) === 'TEXT' ? text(row.material_text) : null,
      childAlbumTitle:
        targetType === 'ALBUM'
          ? resolveStoredTitle(
              { title: row.child_album_title, title_locale: row.child_album_title_locale },
              locale,
              albumLocalizations.get(targetId) ?? [],
            )
          : null,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
    const albumMembers = result.get(memberAlbumId);
    if (albumMembers) albumMembers.push(member);
    else result.set(memberAlbumId, [member]);
  }
  return result;
}
