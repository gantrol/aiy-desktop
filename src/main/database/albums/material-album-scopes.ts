import type { AssetDto, CreationRelationFilter } from '@/shared/contracts';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import { albumProjectedAssetPredicate } from '@/main/database/albums/album-projection-repository';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';

export const MATERIAL_ALBUM_CREATION_ROOT_ID = 'material-album:system:creation-root';

export const MATERIAL_ALBUM_CREATION_UNASSIGNED_ID = 'material-album:system:creation-unassigned';

export const MATERIAL_ALBUM_DICTIONARY_ID = 'material-album:system:dictionary';

export const MATERIAL_ALBUM_CREATION_GROUP_PREFIX = 'material-album:system:creation-group:';

export const MATERIAL_ALBUM_CREATION_SERIES_PREFIX = 'material-album:system:creation-series:';

export const MATERIAL_ALBUM_DICTIONARY_DOMAIN_PREFIX = 'material-album:system:dictionary-domain:';

export const MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID = 'material-album:system:dictionary-uncategorized';

export function materialAlbumCreationGroupId(sourceAlbumId: string) {
  return `${MATERIAL_ALBUM_CREATION_GROUP_PREFIX}${sourceAlbumId}`;
}

export function materialAlbumCreationGroupSourceId(materialAlbumId: string) {
  if (!materialAlbumId.startsWith(MATERIAL_ALBUM_CREATION_GROUP_PREFIX)) return null;
  return materialAlbumId.slice(MATERIAL_ALBUM_CREATION_GROUP_PREFIX.length) || null;
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
    materialAlbumCreationGroupSourceId(materialAlbumId) !== null ||
    materialAlbumCreationSeriesSourceId(materialAlbumId) !== null ||
    materialAlbumDictionaryDomainSourceId(materialAlbumId) !== null
  );
}

export interface CreationScopeSql {
  cte: string;
  parameters: string[];
}

export function creationRootScope(): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT id FROM prompt_series WHERE deleted_at IS NULL
    )`,
    parameters: [],
  };
}

export function creationGroupScope(sourceAlbumId: string): CreationScopeSql {
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
    ), scoped_series(id) AS (
      SELECT DISTINCT member.target_id
      FROM scoped_album_descendants album
      JOIN album_members member ON member.album_id = album.id
        AND member.target_type = 'SERIES' AND member.deleted_at IS NULL
      JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
    )`,
    parameters: [sourceAlbumId],
  };
}

export function creationSeriesScope(sourceSeriesId: string): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL
    )`,
    parameters: [sourceSeriesId],
  };
}

export function creationUnassignedScope(): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT series.id FROM prompt_series series
      WHERE series.deleted_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM album_members member
        JOIN albums owner ON owner.id = member.album_id
          AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
        WHERE member.target_type = 'SERIES' AND member.target_id = series.id
          AND member.deleted_at IS NULL
      )
    )`,
    parameters: [],
  };
}

export function creationScopeAssetFilter(
  scope: CreationScopeSql,
  relation: CreationRelationFilter,
): { predicate: string; parameters: string[] } {
  const output = `(
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
      AND scoped_material.deleted_at IS NULL
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

export function materialAlbumAssetFilter(
  materialAlbumId: string,
  creationRelation: CreationRelationFilter = 'OUTPUT',
): { predicate: string; parameters: string[] } {
  if (materialAlbumId === MATERIAL_ALBUM_CREATION_ROOT_ID) {
    return creationScopeAssetFilter(creationRootScope(), creationRelation);
  }
  if (materialAlbumId === MATERIAL_ALBUM_CREATION_UNASSIGNED_ID) {
    return creationScopeAssetFilter(creationUnassignedScope(), creationRelation);
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
  const sourceAlbumId = materialAlbumCreationGroupSourceId(materialAlbumId);
  if (sourceAlbumId) {
    return creationScopeAssetFilter(creationGroupScope(sourceAlbumId), creationRelation);
  }
  const sourceSeriesId = materialAlbumCreationSeriesSourceId(materialAlbumId);
  if (sourceSeriesId) {
    return creationScopeAssetFilter(creationSeriesScope(sourceSeriesId), creationRelation);
  }
  return { predicate: userAlbumAssetPredicate, parameters: [materialAlbumId] };
}

export function normalizeTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error('Material album title is required');
  if (title.length > 200) throw new Error('Material album title is too long');
  return title;
}

export function normalizeCreationGroupTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error('Creation group title is required');
  if (title.length > 200) throw new Error('Creation group title is too long');
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
