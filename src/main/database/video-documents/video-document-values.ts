import type { VideoDocumentSummaryDto } from '@/shared/contracts';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';

export const videoDocumentSelect = `SELECT document.id, document.title, document.title_locale, document.status,
  document.created_at, document.updated_at,
  source.id AS source_relation_id, source.material_id AS source_material_id,
  material.deleted_at AS source_material_deleted_at,
  asset.id AS source_asset_id, asset.kind AS source_asset_kind, asset.origin_type AS source_origin_type,
  asset.width AS source_width, asset.height AS source_height, asset.mime_type AS source_mime_type,
  asset.byte_size AS source_byte_size, asset.created_at AS source_asset_created_at,
  asset.deleted_at AS source_asset_deleted_at, video.duration_ms AS source_duration_ms,
  video.audio_status AS source_audio_status, video.audio_track_count AS source_audio_track_count,
  video.audio_primary_codec AS source_audio_primary_codec,
  video.audio_detected_at AS source_audio_detected_at, video.audio_error_code AS source_audio_error_code,
  metadata.display_name AS source_display_name, metadata.original_name AS source_original_name,
  metadata.source_url AS source_url,
  thumbnail_asset.id AS thumbnail_asset_id, thumbnail_asset.width AS thumbnail_width,
  thumbnail_asset.height AS thumbnail_height,
  placement.album_id, album.title AS album_title
FROM documents document
JOIN document_source_relations source ON source.document_id = document.id AND source.role = 'PRIMARY_VIDEO'
JOIN materials material ON material.id = source.material_id AND material.kind = 'VIDEO'
JOIN image_assets asset ON asset.id = material.image_asset_id
JOIN video_assets video ON video.image_asset_id = asset.id
LEFT JOIN external_material_metadata metadata ON metadata.material_id = material.id
LEFT JOIN document_thumbnails thumbnail ON thumbnail.document_id = document.id
LEFT JOIN image_assets thumbnail_asset
  ON thumbnail_asset.id = thumbnail.image_asset_id AND thumbnail_asset.deleted_at IS NULL
LEFT JOIN album_members placement ON placement.target_type = 'DOCUMENT'
  AND placement.target_id = document.id AND placement.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM albums placement_album
    WHERE placement_album.id = placement.album_id AND placement_album.deleted_at IS NULL
  )
LEFT JOIN albums album ON album.id = placement.album_id AND album.deleted_at IS NULL`;

export function videoDocumentSummaryDto(row: JsonMap): VideoDocumentSummaryDto {
  const assetId = text(row.source_asset_id);
  return {
    id: text(row.id),
    title: text(row.title),
    titleLocale: text(row.title_locale) === 'en' ? 'en' : 'zh',
    status: text(row.status) === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    albumId: row.album_id ? text(row.album_id) : null,
    albumTitle: row.album_title ? text(row.album_title) : null,
    thumbnail: row.thumbnail_asset_id
      ? {
          assetId: text(row.thumbnail_asset_id),
          mediaUrl: mediaUrl(text(row.thumbnail_asset_id)),
          width: Number(row.thumbnail_width),
          height: Number(row.thumbnail_height),
        }
      : null,
    source: {
      relationId: text(row.source_relation_id),
      materialId: text(row.source_material_id),
      displayName: text(row.source_display_name) || text(row.source_original_name),
      available: !row.source_material_deleted_at && !row.source_asset_deleted_at,
      sourceUrl: /^https:\/\//i.test(text(row.source_url)) ? text(row.source_url) : null,
      audio: {
        status:
          text(row.source_audio_status) === 'HAS_AUDIO'
            ? 'HAS_AUDIO'
            : text(row.source_audio_status) === 'NO_AUDIO'
              ? 'NO_AUDIO'
              : 'DETECTION_FAILED',
        trackCount: Number(row.source_audio_track_count),
        primaryCodec: row.source_audio_primary_codec ? text(row.source_audio_primary_codec) : null,
        detectedAt: row.source_audio_detected_at ? text(row.source_audio_detected_at) : null,
        errorCode: row.source_audio_error_code ? text(row.source_audio_error_code) : null,
      },
      asset: {
        id: assetId,
        kind: text(row.source_asset_kind) === 'GENERATED' ? 'GENERATED' : 'REFERENCE',
        originType: text(row.source_origin_type),
        width: Number(row.source_width),
        height: Number(row.source_height),
        mimeType: text(row.source_mime_type),
        byteSize: Number(row.source_byte_size),
        mediaUrl: mediaUrl(assetId),
        createdAt: text(row.source_asset_created_at),
        mediaKind: 'VIDEO',
        durationMs: Number(row.source_duration_ms),
      },
    },
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
