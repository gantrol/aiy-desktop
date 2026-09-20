import type { PinSourceKind } from '@/shared/petal-source-kinds';
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

const articleSourceQuery = `SELECT a.id, COALESCE(json_extract(NULLIF(r.content_json,''),'$.title'),'') AS title,
  substr(COALESCE(json_extract(NULLIF(r.content_json,''),'$.markdown'),''),1,4000) AS preview,
  json_extract(NULLIF(r.content_json,''),'$.document') AS document_json,
  NULL AS asset_id, a.updated_at AS updated, a.deleted_at, a.status
  FROM articles a LEFT JOIN article_revisions r ON r.id=a.current_revision_id`;

/** Same eight columns for every source. Pinning creates a reference, never a material-to-note copy. */
export const pinSourceQueries: Record<PinSourceKind, string> = {
  ALBUM: albumSourceQuery(false),
  MATERIAL_ALBUM: albumSourceQuery(true),
  ARTICLE: articleSourceQuery,
  SOCIAL_POST: `SELECT a.id, COALESCE(json_extract(r.content_json,'$.title'),'') AS title,
    substr(COALESCE(json_extract(r.content_json,'$.body'),''),1,4000) AS preview,
    json_extract(r.content_json,'$.document') AS document_json,
    NULL AS asset_id, a.updated_at AS updated, a.deleted_at, a.status
    FROM social_post_drafts a LEFT JOIN social_post_revisions r ON r.id=a.current_revision_id`,
  MATERIAL: `SELECT material.id,
    COALESCE(NULLIF(metadata.display_name,''),NULLIF(metadata.original_name,''),substr(material.text_content,1,120),'') AS title,
    substr(COALESCE(material.text_content,''),1,4000) AS preview, NULL AS document_json,
    asset.id AS asset_id, material.created_at AS updated, material.deleted_at,
    CASE WHEN material.archived_at IS NULL AND
      (material.image_asset_id IS NULL OR (asset.id IS NOT NULL AND asset.deleted_at IS NULL))
      THEN 'ACTIVE' ELSE 'ARCHIVED' END AS status
    FROM materials material LEFT JOIN external_material_metadata metadata ON metadata.material_id=material.id
    LEFT JOIN image_assets asset ON asset.id=material.image_asset_id`,
  // Preserve the released wire/database key. The actual MIME determines rendering and opening.
  IMAGE: `SELECT asset.id, COALESCE((SELECT COALESCE(NULLIF(metadata.display_name,''),metadata.original_name)
    FROM materials material JOIN external_material_metadata metadata ON metadata.material_id=material.id
    WHERE material.image_asset_id=asset.id AND material.deleted_at IS NULL AND material.archived_at IS NULL
    ORDER BY material.created_at DESC,material.id LIMIT 1),'') AS title,
    '' AS preview, NULL AS document_json, asset.id AS asset_id, asset.created_at AS updated,
    asset.deleted_at, 'ACTIVE' AS status FROM image_assets asset
    WHERE asset.mime_type LIKE 'image/%' OR asset.mime_type LIKE 'video/%' OR asset.mime_type LIKE 'audio/%'`,
  // Series have no updated_at column in the released schema. Their current revision owns its timestamp.
  PROMPT_SERIES: `SELECT series.id,series.title,'' AS preview,NULL AS document_json,NULL AS asset_id,
    COALESCE(revision.created_at,series.created_at) AS updated,series.deleted_at,
    CASE WHEN series.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END AS status
    FROM prompt_series series LEFT JOIN prompt_versions revision ON revision.id=series.current_version_id`,
  CREATION_DRAFT: `SELECT id,title,substr(text_content,1,4000) AS preview,NULL AS document_json,NULL AS asset_id,
    updated_at AS updated,deleted_at,CASE WHEN consumed_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END AS status
    FROM creation_drafts`,
  // Inspiration is a filtered article view; legacy stash rows were migrated with the same IDs.
  INSPIRATION_STASH: `${articleSourceQuery}
    WHERE json_type(NULLIF(r.content_json,''),'$.creationInput')='object'`,
  VIDEO_DOCUMENT: `SELECT document.id,document.title,'' AS preview,NULL AS document_json,
    (SELECT material.image_asset_id FROM document_source_relations relation JOIN materials material ON material.id=relation.material_id
      WHERE relation.document_id=document.id AND relation.role='PRIMARY_VIDEO' AND material.deleted_at IS NULL
      AND material.archived_at IS NULL LIMIT 1) AS asset_id,
    document.updated_at AS updated,document.deleted_at,document.status FROM documents document`,
  GIF_DOCUMENT: `SELECT id,title,'' AS preview,NULL AS document_json,NULL AS asset_id,
    updated_at AS updated,deleted_at,status FROM gif_documents WHERE purpose='GIF'`,
};

export const pinSourceProjection = Object.entries(pinSourceQueries)
  .map(([kind, query]) => `SELECT '${kind}' AS kind, source.* FROM (${query}) source`)
  .join(' UNION ALL ');
