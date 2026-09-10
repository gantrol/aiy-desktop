import type { PinSource } from '@/shared/contracts/petal-board';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';

function albumSourceQuery(material: boolean) {
  return `WITH RECURSIVE unavailable_albums(id) AS (
    SELECT id FROM albums WHERE deleted_at IS NOT NULL OR archived_at IS NOT NULL
    UNION
    SELECT member.target_id FROM unavailable_albums parent
    JOIN album_members member ON member.album_id=parent.id
      AND member.target_type='ALBUM' AND member.deleted_at IS NULL
  ) SELECT album.id, album.title, '' AS preview, NULL AS document_json, NULL AS asset_id,
    album.updated_at AS updated, album.deleted_at,
    CASE WHEN unavailable.id IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END AS status
    FROM albums album LEFT JOIN unavailable_albums unavailable ON unavailable.id=album.id
    WHERE album.intent ${material ? '=' : '<>'} '${MATERIAL_LIBRARY_ALBUM_INTENT}'`;
}
/**
 * Source projections share the same columns; only selected rows have their block documents
 * converted to bounded previews. Archived revision packs are deliberately not read here.
 * Add a new kind here and in the navigation adapter together.
 * Values interpolated into SQL below are this closed registry, never renderer input.
 */
export const pinSourceQueries: Record<PinSource['kind'], string> = {
  ALBUM: albumSourceQuery(false),
  MATERIAL_ALBUM: albumSourceQuery(true),
  ARTICLE: `SELECT a.id, COALESCE(json_extract(NULLIF(r.content_json,''),'$.title'),'') AS title,
    substr(COALESCE(json_extract(NULLIF(r.content_json,''),'$.markdown'),''),1,4000) AS preview,
    json_extract(NULLIF(r.content_json,''),'$.document') AS document_json,
    NULL AS asset_id, a.updated_at AS updated, a.deleted_at, a.status
    FROM articles a LEFT JOIN article_revisions r ON r.id=a.current_revision_id`,
  SOCIAL_POST: `SELECT a.id, COALESCE(json_extract(r.content_json,'$.title'),'') AS title,
    substr(COALESCE(json_extract(r.content_json,'$.body'),''),1,4000) AS preview,
    json_extract(r.content_json,'$.document') AS document_json,
    NULL AS asset_id, a.updated_at AS updated, a.deleted_at, a.status
    FROM social_post_drafts a LEFT JOIN social_post_revisions r ON r.id=a.current_revision_id`,
  IMAGE: `SELECT asset.id, COALESCE((SELECT COALESCE(NULLIF(metadata.display_name,''),metadata.original_name)
    FROM materials material JOIN external_material_metadata metadata ON metadata.material_id=material.id
    WHERE material.image_asset_id=asset.id AND material.deleted_at IS NULL AND material.archived_at IS NULL
    ORDER BY material.created_at DESC,material.id LIMIT 1),'') AS title,
    '' AS preview, NULL AS document_json, asset.id AS asset_id, asset.created_at AS updated,
    asset.deleted_at, 'ACTIVE' AS status FROM image_assets asset WHERE asset.mime_type LIKE 'image/%'`,
};
export const pinSourceProjection = Object.entries(pinSourceQueries)
  .map(([kind, query]) => `SELECT '${kind}' AS kind, source.* FROM (${query}) source`)
  .join(' UNION ALL ');
