import type { AssetDto, CreationRelationFilter, GalleryAlbumScope } from '@/shared/contracts';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import { albumProjectedAssetPredicate } from '@/main/database/albums/album-projection-repository';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';

export const MATERIAL_ALBUM_CREATION_ROOT_ID = 'material-album:system:creation-root';

export const MATERIAL_ALBUM_CREATION_UNASSIGNED_ID = 'material-album:system:creation-unassigned';

export const MATERIAL_ALBUM_DICTIONARY_ID = 'material-album:system:dictionary';

// The virtual view id is stable across the terminology change from group to album.
export const MATERIAL_ALBUM_CREATION_ALBUM_PREFIX = 'material-album:system:creation-group:';

export const MATERIAL_ALBUM_CREATION_SERIES_PREFIX = 'material-album:system:creation-series:';

export const MATERIAL_ALBUM_DICTIONARY_DOMAIN_PREFIX = 'material-album:system:dictionary-domain:';

export const MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID = 'material-album:system:dictionary-uncategorized';

export function materialAlbumCreationAlbumId(sourceAlbumId: string) {
  return `${MATERIAL_ALBUM_CREATION_ALBUM_PREFIX}${sourceAlbumId}`;
}

export function materialAlbumCreationAlbumSourceId(materialAlbumId: string) {
  if (!materialAlbumId.startsWith(MATERIAL_ALBUM_CREATION_ALBUM_PREFIX)) return null;
  return materialAlbumId.slice(MATERIAL_ALBUM_CREATION_ALBUM_PREFIX.length) || null;
}

export function materialAlbumCreationSeriesId(sourceSeriesId: string) {
  return `${MATERIAL_ALBUM_CREATION_SERIES_PREFIX}${sourceSeriesId}`;
}

export function materialAlbumCreationSeriesSourceId(materialAlbumId: string) {
  if (!materialAlbumId.startsWith(MATERIAL_ALBUM_CREATION_SERIES_PREFIX)) return null;
  return materialAlbumId.slice(MATERIAL_ALBUM_CREATION_SERIES_PREFIX.length) || null;
}

export function materialAlbumDictionaryDomainId(facetValueId: string) {
  return `${MATERIAL_ALBUM_DICTIONARY_DOMAIN_PREFIX}${facetValueId}`;
}

export function materialAlbumDictionaryDomainSourceId(materialAlbumId: string) {
  if (!materialAlbumId.startsWith(MATERIAL_ALBUM_DICTIONARY_DOMAIN_PREFIX)) return null;
  return materialAlbumId.slice(MATERIAL_ALBUM_DICTIONARY_DOMAIN_PREFIX.length) || null;
}

export function isSystemMaterialAlbumId(materialAlbumId: string) {
  return (
    materialAlbumId === MATERIAL_ALBUM_CREATION_ROOT_ID ||
    materialAlbumId === MATERIAL_ALBUM_CREATION_UNASSIGNED_ID ||
    materialAlbumId === MATERIAL_ALBUM_DICTIONARY_ID ||
    materialAlbumId === MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID ||
    materialAlbumCreationAlbumSourceId(materialAlbumId) !== null ||
    materialAlbumCreationSeriesSourceId(materialAlbumId) !== null ||
    materialAlbumDictionaryDomainSourceId(materialAlbumId) !== null
  );
}

export interface CreationScopeSql {
  cte: string;
  parameters: string[];
}

interface CreationContentScopeSql {
  cte: string;
  parameters: string[];
}

export function creationRootScope(): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT form.entity_id
      FROM creation_forms form
      JOIN creation_items item ON item.id = form.creation_item_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
      JOIN prompt_series series ON series.id = form.entity_id
        AND series.deleted_at IS NULL AND series.archived_at IS NULL
      WHERE form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
        AND form.deleted_at IS NULL
    )`,
    parameters: [],
  };
}

export function creationAlbumScope(sourceAlbumId: string): CreationScopeSql {
  return {
    cte: `WITH RECURSIVE scoped_album_descendants(id) AS (
      SELECT id FROM albums WHERE id = ? AND deleted_at IS NULL AND intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
      UNION
      SELECT child.id
      FROM scoped_album_descendants parent
      JOIN album_members edge ON edge.album_id = parent.id
        AND edge.target_type = 'ALBUM' AND edge.deleted_at IS NULL
      JOIN albums child ON child.id = edge.target_id
        AND child.deleted_at IS NULL AND child.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
    ), scoped_creation_items(id) AS (
      SELECT DISTINCT member.target_id
      FROM scoped_album_descendants album
      JOIN album_members member ON member.album_id = album.id
        AND member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
      JOIN creation_items item ON item.id = member.target_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
    ), scoped_series(id) AS (
      SELECT DISTINCT form.entity_id
      FROM scoped_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
        AND form.deleted_at IS NULL
      JOIN prompt_series series ON series.id = form.entity_id
        AND series.deleted_at IS NULL AND series.archived_at IS NULL
    )`,
    parameters: [sourceAlbumId],
  };
}

export function creationSeriesScope(sourceSeriesId: string): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT series.id
      FROM creation_forms form
      JOIN creation_items item ON item.id = form.creation_item_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
      JOIN prompt_series series ON series.id = form.entity_id
      WHERE form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
        AND form.deleted_at IS NULL
        AND series.id = ? AND series.deleted_at IS NULL AND series.archived_at IS NULL
    )`,
    parameters: [sourceSeriesId],
  };
}

export function creationUnassignedScope(): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT series.id
      FROM creation_forms form
      JOIN creation_items item ON item.id = form.creation_item_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
      JOIN prompt_series series ON series.id = form.entity_id
      WHERE form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
        AND form.deleted_at IS NULL
        AND series.deleted_at IS NULL AND series.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM album_members member
          JOIN albums owner ON owner.id = member.album_id
            AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
          WHERE member.target_type = 'CREATION_ITEM' AND member.target_id = item.id
            AND member.deleted_at IS NULL
      )
    )`,
    parameters: [],
  };
}

function creationRootContentScope(): CreationContentScopeSql {
  return {
    cte: `WITH scoped_inspirations(id, input_json) AS (
      SELECT inspiration.id, inspiration.input_json
      FROM creation_forms form
      JOIN creation_items item ON item.id = form.creation_item_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
      JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id
      WHERE form.role = 'INSPIRATION' AND form.entity_type = 'INSPIRATION_STASH'
        AND form.deleted_at IS NULL
        AND inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
    ), scoped_social_posts(id, current_revision_id) AS (
      SELECT post.id, post.current_revision_id
      FROM creation_forms form
      JOIN creation_items item ON item.id = form.creation_item_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
      JOIN social_post_drafts post ON post.id = form.entity_id
      WHERE form.role = 'SOCIAL_POST' AND form.entity_type = 'SOCIAL_POST'
        AND form.deleted_at IS NULL AND post.status = 'ACTIVE' AND post.deleted_at IS NULL
    ), scoped_articles(id, current_revision_id) AS (
      SELECT article.id, article.current_revision_id
      FROM creation_forms form
      JOIN creation_items item ON item.id = form.creation_item_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
      JOIN articles article ON article.id = form.entity_id
      WHERE form.role = 'ARTICLE' AND form.entity_type = 'ARTICLE'
        AND form.deleted_at IS NULL AND article.status = 'ACTIVE' AND article.deleted_at IS NULL
    )`,
    parameters: [],
  };
}

function creationAlbumContentScope(sourceAlbumId: string): CreationContentScopeSql {
  return {
    cte: `WITH RECURSIVE scoped_album_descendants(id) AS (
      SELECT id FROM albums WHERE id = ? AND deleted_at IS NULL AND intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
      UNION
      SELECT child.id
      FROM scoped_album_descendants parent
      JOIN album_members edge ON edge.album_id = parent.id
        AND edge.target_type = 'ALBUM' AND edge.deleted_at IS NULL
      JOIN albums child ON child.id = edge.target_id
        AND child.deleted_at IS NULL AND child.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
    ), scoped_creation_items(id) AS (
      SELECT DISTINCT member.target_id
      FROM scoped_album_descendants album
      JOIN album_members member ON member.album_id = album.id
        AND member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
      JOIN creation_items item ON item.id = member.target_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
    ), scoped_inspirations(id, input_json) AS (
      SELECT inspiration.id, inspiration.input_json
      FROM scoped_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'INSPIRATION' AND form.entity_type = 'INSPIRATION_STASH'
        AND form.deleted_at IS NULL
      JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id
      WHERE inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
    ), scoped_social_posts(id, current_revision_id) AS (
      SELECT post.id, post.current_revision_id
      FROM scoped_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'SOCIAL_POST' AND form.entity_type = 'SOCIAL_POST'
        AND form.deleted_at IS NULL
      JOIN social_post_drafts post ON post.id = form.entity_id
      WHERE post.status = 'ACTIVE' AND post.deleted_at IS NULL
    ), scoped_articles(id, current_revision_id) AS (
      SELECT article.id, article.current_revision_id
      FROM scoped_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'ARTICLE' AND form.entity_type = 'ARTICLE'
        AND form.deleted_at IS NULL
      JOIN articles article ON article.id = form.entity_id
      WHERE article.status = 'ACTIVE' AND article.deleted_at IS NULL
    )`,
    parameters: [sourceAlbumId],
  };
}

function creationSeriesContentScope(sourceSeriesId: string): CreationContentScopeSql {
  return {
    cte: `WITH selected_creation_items(id) AS (
      SELECT item.id
      FROM creation_forms form
      JOIN creation_items item ON item.id = form.creation_item_id
        AND item.deleted_at IS NULL AND item.archived_at IS NULL
      WHERE form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
        AND form.entity_id = ? AND form.deleted_at IS NULL
    ),
    scoped_inspirations(id, input_json) AS (
      SELECT inspiration.id, inspiration.input_json
      FROM selected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'INSPIRATION' AND form.entity_type = 'INSPIRATION_STASH'
        AND form.deleted_at IS NULL
      JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id
      WHERE inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
    ), scoped_social_posts(id, current_revision_id) AS (
      SELECT post.id, post.current_revision_id
      FROM selected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'SOCIAL_POST' AND form.entity_type = 'SOCIAL_POST'
        AND form.deleted_at IS NULL
      JOIN social_post_drafts post ON post.id = form.entity_id
      WHERE post.status = 'ACTIVE' AND post.deleted_at IS NULL
    ), scoped_articles(id, current_revision_id) AS (
      SELECT article.id, article.current_revision_id
      FROM selected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'ARTICLE' AND form.entity_type = 'ARTICLE'
        AND form.deleted_at IS NULL
      JOIN articles article ON article.id = form.entity_id
      WHERE article.status = 'ACTIVE' AND article.deleted_at IS NULL
    )`,
    parameters: [sourceSeriesId],
  };
}

function creationUnassignedContentScope(): CreationContentScopeSql {
  return {
    cte: `WITH unassigned_creation_items(id) AS (
      SELECT item.id FROM creation_items item
      WHERE item.deleted_at IS NULL AND item.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM album_members member
          JOIN albums owner ON owner.id = member.album_id
            AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
          WHERE member.target_type = 'CREATION_ITEM' AND member.target_id = item.id
            AND member.deleted_at IS NULL
        )
    ), scoped_inspirations(id, input_json) AS (
      SELECT inspiration.id, inspiration.input_json
      FROM unassigned_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'INSPIRATION' AND form.entity_type = 'INSPIRATION_STASH'
        AND form.deleted_at IS NULL
      JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id
      WHERE inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
    ), scoped_social_posts(id, current_revision_id) AS (
      SELECT post.id, post.current_revision_id
      FROM unassigned_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'SOCIAL_POST' AND form.entity_type = 'SOCIAL_POST'
        AND form.deleted_at IS NULL
      JOIN social_post_drafts post ON post.id = form.entity_id
      WHERE post.status = 'ACTIVE' AND post.deleted_at IS NULL
    ), scoped_articles(id, current_revision_id) AS (
      SELECT article.id, article.current_revision_id
      FROM unassigned_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'ARTICLE' AND form.entity_type = 'ARTICLE'
        AND form.deleted_at IS NULL
      JOIN articles article ON article.id = form.entity_id
      WHERE article.status = 'ACTIVE' AND article.deleted_at IS NULL
    )`,
    parameters: [],
  };
}

export function creationScopeAssetFilter(
  scope: CreationScopeSql,
  relation: CreationRelationFilter,
): { predicate: string; parameters: string[] } {
  const output = `(
    NOT EXISTS (
      SELECT 1 FROM prompt_series_output_exclusions scoped_exclusion
      WHERE scoped_exclusion.series_id = scoped_series.id
        AND scoped_exclusion.image_asset_id = asset.id
    ) AND (
    EXISTS (
      SELECT 1 FROM generation_runs scoped_run
      JOIN prompt_versions scoped_version ON scoped_version.id = scoped_run.prompt_version_id
      WHERE scoped_version.series_id = scoped_series.id
        AND scoped_run.result_asset_id = asset.id AND scoped_run.status = 'SUCCEEDED'
        AND NOT EXISTS (
          SELECT 1 FROM generation_output_reviews scoped_review
          WHERE scoped_review.generation_run_id = scoped_run.id AND scoped_review.disposition = 'FAILED'
        )
    ) OR EXISTS (
      SELECT 1 FROM creation_output_imports scoped_import
      WHERE scoped_import.series_id = scoped_series.id
        AND scoped_import.image_asset_id = asset.id AND scoped_import.deleted_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM image_transform_runs scoped_transform
      WHERE scoped_transform.series_id = scoped_series.id
        AND scoped_transform.output_asset_id = asset.id AND scoped_transform.deleted_at IS NULL
    )
    )
  )`;
  const input = `(
    EXISTS (
      SELECT 1 FROM prompt_series scoped_input_series
      JOIN reference_bindings scoped_binding
        ON scoped_binding.prompt_version_id = scoped_input_series.current_version_id
        AND scoped_binding.source_type = 'DIRECT'
      WHERE scoped_input_series.id = scoped_series.id AND scoped_binding.image_asset_id = asset.id
    ) OR EXISTS (
      SELECT 1 FROM prompt_series scoped_source_series
      JOIN prompt_versions scoped_source_version
        ON scoped_source_version.id = scoped_source_series.current_version_id
      WHERE scoped_source_series.id = scoped_series.id
        AND scoped_source_version.source_image_id = asset.id
    )
  )`;
  const materialIdentity = `EXISTS (
    SELECT 1 FROM materials scoped_material
    WHERE scoped_material.kind = 'IMAGE' AND scoped_material.image_asset_id = asset.id
      AND scoped_material.deleted_at IS NULL AND scoped_material.archived_at IS NULL
  )`;
  const visibleInput = `(${input} AND ${materialIdentity})`;
  const relationship =
    relation === 'OUTPUT' ? output : relation === 'INPUT' ? visibleInput : `(${output} OR ${visibleInput})`;
  return {
    predicate: `EXISTS (
      ${scope.cte}
      SELECT 1 FROM scoped_series
      WHERE ${relationship}
    )`,
    parameters: scope.parameters,
  };
}

function creationContentAssetFilter(
  scope: CreationContentScopeSql,
  relation: CreationRelationFilter,
): { predicate: string; parameters: string[] } {
  const output = `(
    EXISTS (
      SELECT 1 FROM scoped_social_posts post
      JOIN social_post_revisions revision ON revision.id = post.current_revision_id
      JOIN json_each(revision.content_json, '$.mediaAssetIds') media
      WHERE media.value = asset.id
    ) OR EXISTS (
      SELECT 1 FROM scoped_articles article
      JOIN article_revisions revision ON revision.id = article.current_revision_id
      JOIN json_each(revision.content_json, '$.mediaBindings') binding
      WHERE json_extract(binding.value, '$.assetId') = asset.id
    )
  )`;
  const materialIdentity = `EXISTS (
    SELECT 1 FROM materials scoped_material
    WHERE scoped_material.kind = 'IMAGE' AND scoped_material.image_asset_id = asset.id
      AND scoped_material.deleted_at IS NULL AND scoped_material.archived_at IS NULL
  )`;
  const input = `(
    EXISTS (
      SELECT 1 FROM scoped_inspirations inspiration
      JOIN json_each(inspiration.input_json, '$.referenceAssetIds') reference
      WHERE reference.value = asset.id
    ) AND ${materialIdentity}
  )`;
  const relationship = relation === 'OUTPUT' ? output : relation === 'INPUT' ? input : `(${output} OR ${input})`;
  return {
    predicate: `EXISTS (
      ${scope.cte}
      SELECT 1 WHERE ${relationship}
    )`,
    parameters: scope.parameters,
  };
}

function combinedCreationAssetFilter(
  seriesScope: CreationScopeSql,
  contentScope: CreationContentScopeSql,
  relation: CreationRelationFilter,
) {
  const series = creationScopeAssetFilter(seriesScope, relation);
  const content = creationContentAssetFilter(contentScope, relation);
  return {
    predicate: `(${series.predicate} OR ${content.predicate})`,
    parameters: [...series.parameters, ...content.parameters],
  };
}

export const promptSeriesAssetPredicate = creationScopeAssetFilter(
  creationSeriesScope('__SERIES_ID__'),
  'OUTPUT',
).predicate;

export const dictionaryAssetPredicate = `EXISTS (
  SELECT 1 FROM term_media_links material_album_media
  JOIN terms material_album_term ON material_album_term.id = material_album_media.term_id
  WHERE material_album_media.image_asset_id = asset.id
    AND material_album_media.deleted_at IS NULL
    AND material_album_term.archived_at IS NULL
)`;

export const dictionaryDomainAssetPredicate = `EXISTS (
  SELECT 1 FROM term_media_links material_album_media
  JOIN terms material_album_term ON material_album_term.id = material_album_media.term_id
  JOIN term_facet_assignments material_album_assignment
    ON material_album_assignment.term_revision_id = material_album_term.current_revision_id
  JOIN facet_values material_album_value
    ON material_album_value.id = material_album_assignment.facet_value_id
  JOIN facet_definitions material_album_definition
    ON material_album_definition.id = material_album_value.definition_id
    AND material_album_definition.system_role = 'PRIMARY_CLASSIFICATION'
  WHERE material_album_media.image_asset_id = asset.id
    AND material_album_value.id = ?
    AND material_album_media.deleted_at IS NULL
    AND material_album_term.archived_at IS NULL
)`;

export const dictionaryUncategorizedAssetPredicate = `EXISTS (
  SELECT 1 FROM term_media_links material_album_media
  JOIN terms material_album_term ON material_album_term.id = material_album_media.term_id
  WHERE material_album_media.image_asset_id = asset.id
    AND material_album_media.deleted_at IS NULL
    AND material_album_term.archived_at IS NULL
) AND NOT EXISTS (
  SELECT 1 FROM term_media_links material_album_classified_media
  JOIN terms material_album_classified_term
    ON material_album_classified_term.id = material_album_classified_media.term_id
    AND material_album_classified_term.archived_at IS NULL
  JOIN term_facet_assignments material_album_classified_assignment
    ON material_album_classified_assignment.term_revision_id = material_album_classified_term.current_revision_id
  JOIN facet_values material_album_classified_value
    ON material_album_classified_value.id = material_album_classified_assignment.facet_value_id
  JOIN facet_definitions material_album_classified_definition
    ON material_album_classified_definition.id = material_album_classified_value.definition_id
    AND material_album_classified_definition.system_role = 'PRIMARY_CLASSIFICATION'
  WHERE material_album_classified_media.image_asset_id = asset.id
    AND material_album_classified_media.deleted_at IS NULL
)`;

export const userAlbumAssetPredicate = albumProjectedAssetPredicate;

export const directUserAlbumAssetPredicate = `EXISTS (
  SELECT 1 FROM album_members direct_member
  JOIN materials direct_material ON direct_material.id = direct_member.target_id
    AND direct_material.kind IN ('IMAGE', 'VIDEO') AND direct_material.deleted_at IS NULL
    AND direct_material.archived_at IS NULL
  WHERE direct_member.album_id = ? AND direct_member.target_type = 'MATERIAL'
    AND direct_member.deleted_at IS NULL AND direct_material.image_asset_id = asset.id
)`;

export const unfiledMaterialAssetPredicate = `NOT EXISTS (
  SELECT 1 FROM album_members organized_member
  JOIN albums organized_album ON organized_album.id = organized_member.album_id
    AND organized_album.deleted_at IS NULL AND organized_album.intent = '${MATERIAL_LIBRARY_ALBUM_INTENT}'
  JOIN materials organized_material ON organized_material.id = organized_member.target_id
    AND organized_material.kind IN ('IMAGE', 'VIDEO') AND organized_material.deleted_at IS NULL
    AND organized_material.archived_at IS NULL
  WHERE organized_member.target_type = 'MATERIAL' AND organized_member.deleted_at IS NULL
    AND organized_material.image_asset_id = asset.id
)`;

/** Assets represented by neither a user material album nor the live creation projection. */
export const unorganizedMaterialAssetPredicate = `(
  ${unfiledMaterialAssetPredicate}
  AND NOT (${combinedCreationAssetFilter(creationRootScope(), creationRootContentScope(), 'ALL').predicate})
)`;

export function materialAlbumAssetFilter(
  materialAlbumId: string,
  creationRelation: CreationRelationFilter = 'OUTPUT',
  albumScope: GalleryAlbumScope = 'TREE',
): { predicate: string; parameters: string[] } {
  if (materialAlbumId === MATERIAL_ALBUM_CREATION_ROOT_ID) {
    return combinedCreationAssetFilter(creationRootScope(), creationRootContentScope(), creationRelation);
  }
  if (materialAlbumId === MATERIAL_ALBUM_CREATION_UNASSIGNED_ID) {
    return combinedCreationAssetFilter(creationUnassignedScope(), creationUnassignedContentScope(), creationRelation);
  }
  if (materialAlbumId === MATERIAL_ALBUM_DICTIONARY_ID) {
    return { predicate: dictionaryAssetPredicate, parameters: [] };
  }
  if (materialAlbumId === MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID) {
    return { predicate: dictionaryUncategorizedAssetPredicate, parameters: [] };
  }
  const sourceDomainId = materialAlbumDictionaryDomainSourceId(materialAlbumId);
  if (sourceDomainId) {
    return { predicate: dictionaryDomainAssetPredicate, parameters: [sourceDomainId] };
  }
  const sourceAlbumId = materialAlbumCreationAlbumSourceId(materialAlbumId);
  if (sourceAlbumId) {
    return combinedCreationAssetFilter(
      creationAlbumScope(sourceAlbumId),
      creationAlbumContentScope(sourceAlbumId),
      creationRelation,
    );
  }
  const sourceSeriesId = materialAlbumCreationSeriesSourceId(materialAlbumId);
  if (sourceSeriesId) {
    return combinedCreationAssetFilter(
      creationSeriesScope(sourceSeriesId),
      creationSeriesContentScope(sourceSeriesId),
      creationRelation,
    );
  }
  if (albumScope === 'DIRECT') {
    return { predicate: directUserAlbumAssetPredicate, parameters: [materialAlbumId] };
  }
  return { predicate: userAlbumAssetPredicate, parameters: [materialAlbumId] };
}

export function normalizeTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error('Material album title is required');
  if (title.length > 200) throw new Error('Material album title is too long');
  return title;
}

export function normalizeCreationAlbumTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error('Creation album title is required');
  if (title.length > 200) throw new Error('Creation album title is too long');
  return title;
}

export function assetDto(row: JsonMap, prefix = ''): AssetDto {
  const field = (name: string) => row[`${prefix}${name}`];
  const id = text(field('id'));
  return {
    id,
    kind: text(field('kind')) as AssetDto['kind'],
    originType: text(field('origin_type')),
    width: Number(field('width')),
    height: Number(field('height')),
    mimeType: text(field('mime_type')),
    byteSize: Number(field('byte_size')),
    mediaUrl: mediaUrl(id),
    createdAt: text(field('created_at')),
  };
}

export interface SystemAlbumSummary {
  materialCount: number;
  previewAssets: AssetDto[];
}
