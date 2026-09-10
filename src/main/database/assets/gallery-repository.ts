import {
  creationOutputCandidatesSql,
  creationRelationshipsCte,
} from '@/main/database/assets/gallery-creation-relationships-sql';
import path from 'node:path';
import type {
  ExternalMaterialMetadataDto,
  GalleryItemDto,
  GalleryListInput,
  GalleryPageDto,
  GallerySourceFilter,
  ImageRatingDimension,
  ImageRatingDto,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { isSystemMaterialAlbumId, materialAlbumAssetFilter } from '@/main/database/albums/material-album-repository';
import {
  unfiledMaterialAssetPredicate,
  unorganizedMaterialAssetPredicate,
} from '@/main/database/albums/material-album-scopes';
import { creationOutputNotExcluded } from '@/main/database/creations/creation-output-presentation-sql';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';
import { resolveStoredTitle, titleLocalizationsByOwner } from '@/main/database/core/title-localization';

interface GalleryCursor {
  createdAt: string;
  id: string;
}

export interface TransitionPreviewSource {
  assetId: string;
  sourcePath: string;
  width: number;
  height: number;
}

const evaluatorKey = 'LOCAL_OWNER';
const ratingAliases: Record<ImageRatingDimension, string> = {
  AESTHETIC: 'aesthetic_rating',
  REALISM: 'realism_rating',
};

function encodeCursor(cursor: GalleryCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null): GalleryCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<GalleryCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || !parsed.createdAt || !parsed.id) {
      throw new Error('Invalid gallery cursor');
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error('Invalid gallery cursor');
  }
}

function sourcePredicate(source: GallerySourceFilter) {
  if (source === 'CREATION') return 'creation.is_output = 1';
  if (source === 'DICTIONARY') return 'dictionary.asset_id IS NOT NULL';
  if (source === 'FAVORITE') return 'favorite.asset_id IS NOT NULL';
  if (source === 'MATERIAL') return 'gallery_material.id IS NOT NULL';
  if (source === 'LIBRARY') return '(gallery_material.id IS NOT NULL OR creation.is_output = 1)';
  if (source === 'IMPORT') return 'gallery_material.id IS NOT NULL AND COALESCE(creation.is_output, 0) = 0';
  return '1 = 1';
}

function materialAlbumFilter(input: GalleryListInput) {
  if (!input.albumId) return { clause: '', parameters: [] as string[] };
  const filter = materialAlbumAssetFilter(
    input.albumId,
    input.creationRelation ?? 'OUTPUT',
    input.albumScope ?? 'TREE',
  );
  return { clause: `AND ${filter.predicate}`, parameters: filter.parameters };
}

function materialPlacementClause(placement: GalleryListInput['placement']) {
  if (placement === 'UNFILED') return `AND ${unfiledMaterialAssetPredicate}`;
  if (placement === 'UNORGANIZED') return `AND ${unorganizedMaterialAssetPredicate}`;
  return '';
}

const dictionaryAssetTerms = `
  SELECT link.image_asset_id AS asset_id, link.term_id
  FROM term_media_links link
  WHERE link.deleted_at IS NULL
  UNION
  SELECT evidence.image_asset_id AS asset_id, evidence.term_id
  FROM term_evidence evidence
  WHERE evidence.image_asset_id IS NOT NULL
`;

function dictionaryFilter(input: GalleryListInput['dictionary']) {
  if (!input) return { predicate: '', parameters: [] as string[] };
  const conditions = ['scoped_dictionary.asset_id = asset.id', 'scoped_term.archived_at IS NULL'];
  const parameters: string[] = [];
  if (input.termId) {
    conditions.push('scoped_term.id = ?');
    parameters.push(input.termId);
  }
  for (const facetValueId of [...new Set(input.facetValueIds ?? [])]) {
    conditions.push(`EXISTS (
      SELECT 1 FROM term_facet_assignments scoped_assignment
      WHERE scoped_assignment.term_revision_id = scoped_term.current_revision_id
        AND scoped_assignment.facet_value_id = ?
    )`);
    parameters.push(facetValueId);
  }
  for (const systemRole of [...new Set(input.missingFacetSystemRoles ?? [])]) {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM term_facet_assignments scoped_missing_assignment
      JOIN facet_values scoped_missing_value
        ON scoped_missing_value.id = scoped_missing_assignment.facet_value_id
      JOIN facet_definitions scoped_missing_definition
        ON scoped_missing_definition.id = scoped_missing_value.definition_id
      WHERE scoped_missing_assignment.term_revision_id = scoped_term.current_revision_id
        AND scoped_missing_definition.system_role = ?
    )`);
    parameters.push(systemRole);
  }
  if (input.packReleaseIds !== undefined) {
    const releaseIds = [...new Set(input.packReleaseIds)];
    const selectedMatch = releaseIds.length
      ? `EXISTS (
          SELECT 1 FROM pack_release_items scoped_pack_item
          JOIN pack_object_links scoped_pack_link
            ON scoped_pack_link.release_item_id = scoped_pack_item.id
           AND scoped_pack_link.deleted_at IS NULL
          WHERE scoped_pack_item.object_type = 'TERM_REVISION'
            AND scoped_pack_item.release_id IN (${releaseIds.map(() => '?').join(', ')})
            AND scoped_pack_link.local_object_type = 'TERM'
            AND scoped_pack_link.local_object_id = scoped_term.id
            AND scoped_pack_link.local_revision_id = scoped_term.current_revision_id
        )`
      : '0 = 1';
    const localMatch = `NOT EXISTS (
      SELECT 1 FROM pack_release_items scoped_any_pack_item
      JOIN pack_object_links scoped_any_pack_link
        ON scoped_any_pack_link.release_item_id = scoped_any_pack_item.id
       AND scoped_any_pack_link.deleted_at IS NULL
      WHERE scoped_any_pack_item.object_type = 'TERM_REVISION'
        AND scoped_any_pack_link.local_object_type = 'TERM'
        AND scoped_any_pack_link.local_object_id = scoped_term.id
        AND scoped_any_pack_link.local_revision_id = scoped_term.current_revision_id
    )`;
    conditions.push(`(${selectedMatch}${input.includeLocalTerms ? ` OR ${localMatch}` : ''})`);
    parameters.push(...releaseIds);
  }
  return {
    predicate: `AND EXISTS (
      SELECT 1 FROM (${dictionaryAssetTerms}) scoped_dictionary
      JOIN terms scoped_term ON scoped_term.id = scoped_dictionary.term_id
      WHERE ${conditions.join('\n        AND ')}
    )`,
    parameters,
  };
}

const creationSortExpression = `CASE
  WHEN creation.creation_created_at IS NOT NULL AND creation.creation_created_at > asset.created_at
    THEN creation.creation_created_at
  ELSE asset.created_at
END`;

const gallerySearchPredicate = `(
  LOWER(COALESCE(asset.origin_type, '')) LIKE ? ESCAPE '\\'
  OR LOWER(COALESCE(asset.mime_type, '')) LIKE ? ESCAPE '\\'
  OR EXISTS (
    SELECT 1 FROM materials search_material
    JOIN external_material_metadata search_metadata ON search_metadata.material_id = search_material.id
    WHERE search_material.image_asset_id = asset.id
      AND search_material.kind IN ('IMAGE', 'VIDEO') AND search_material.deleted_at IS NULL AND search_material.archived_at IS NULL
      AND (
        LOWER(COALESCE(search_metadata.display_name, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(search_metadata.original_name, '')) LIKE ? ESCAPE '\\'
      )
  )
  OR EXISTS (
    SELECT 1 FROM prompt_series search_series
    WHERE search_series.deleted_at IS NULL AND search_series.archived_at IS NULL
      AND (
        LOWER(COALESCE(search_series.title, '')) LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM prompt_series_localizations search_series_localization
          WHERE search_series_localization.prompt_series_id = search_series.id
            AND LOWER(search_series_localization.title) LIKE ? ESCAPE '\\'
        )
      )
      AND (
        EXISTS (
          SELECT 1 FROM generation_runs search_run
          JOIN prompt_versions search_version ON search_version.id = search_run.prompt_version_id
          WHERE search_version.series_id = search_series.id
            AND search_run.result_asset_id = asset.id AND search_run.status = 'SUCCEEDED'
            AND ${creationOutputNotExcluded('search_series.id', 'asset.id')}
            AND NOT EXISTS (
              SELECT 1 FROM generation_output_reviews search_review
              WHERE search_review.generation_run_id = search_run.id
                AND search_review.disposition = 'FAILED'
            )
        ) OR EXISTS (
          SELECT 1 FROM creation_output_imports search_imported
          WHERE search_imported.series_id = search_series.id
            AND search_imported.image_asset_id = asset.id AND search_imported.deleted_at IS NULL
            AND ${creationOutputNotExcluded('search_series.id', 'asset.id')}
        ) OR EXISTS (
          SELECT 1 FROM image_transform_runs search_transform
          WHERE search_transform.series_id = search_series.id
            AND search_transform.output_asset_id = asset.id AND search_transform.deleted_at IS NULL
            AND ${creationOutputNotExcluded('search_series.id', 'asset.id')}
        ) OR EXISTS (
          SELECT 1 FROM reference_bindings search_binding
          WHERE search_binding.prompt_version_id = search_series.current_version_id
            AND search_binding.source_type = 'DIRECT' AND search_binding.image_asset_id = asset.id
        ) OR EXISTS (
          SELECT 1 FROM prompt_versions search_source_version
          WHERE search_source_version.id = search_series.current_version_id
            AND search_source_version.source_image_id = asset.id
        )
      )
  )
  OR EXISTS (
    SELECT 1 FROM (${dictionaryAssetTerms}) search_dictionary
    JOIN terms search_term ON search_term.id = search_dictionary.term_id
    JOIN term_revisions search_revision ON search_revision.id = search_term.current_revision_id
    WHERE search_dictionary.asset_id = asset.id AND search_term.archived_at IS NULL
      AND (
        LOWER(COALESCE(search_revision.title, '')) LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM term_localizations search_localization
          WHERE search_localization.term_revision_id = search_revision.id
            AND LOWER(search_localization.title) LIKE ? ESCAPE '\\'
        )
      )
  )
)`;

const galleryFailedOutputVisibilityPredicate = `(
  NOT EXISTS (
    SELECT 1 FROM generation_runs failed_run
    JOIN generation_output_reviews failed_review
      ON failed_review.generation_run_id = failed_run.id
      AND failed_review.disposition = 'FAILED'
    WHERE failed_run.result_asset_id = asset.id
  )
  OR creation.is_output = 1
  OR dictionary.asset_id IS NOT NULL
  OR favorite.asset_id IS NOT NULL
  OR gallery_material.id IS NOT NULL
)`;

const transitionPreviewDictionaryReachabilityPredicate = `EXISTS (
  SELECT 1 FROM (${dictionaryAssetTerms}) transition_dictionary
  JOIN terms transition_term ON transition_term.id = transition_dictionary.term_id
  WHERE transition_dictionary.asset_id = asset.id AND transition_term.archived_at IS NULL
)`;

const transitionPreviewMaterialReachabilityPredicate = `EXISTS (
  SELECT 1 FROM materials transition_material
  WHERE transition_material.image_asset_id = asset.id
    AND transition_material.kind IN ('IMAGE', 'VIDEO') AND transition_material.deleted_at IS NULL AND transition_material.archived_at IS NULL
)`;

const transitionPreviewOwnerRatingReachabilityPredicate = `EXISTS (
  SELECT 1 FROM image_ratings transition_owner_rating
  WHERE transition_owner_rating.image_asset_id = asset.id
    AND transition_owner_rating.evaluator_key = 'LOCAL_OWNER'
    AND transition_owner_rating.deleted_at IS NULL
)`;

const transitionPreviewVisibilityPredicate = `(
  NOT EXISTS (
    SELECT 1 FROM generation_runs failed_run
    JOIN generation_output_reviews failed_review
      ON failed_review.generation_run_id = failed_run.id
      AND failed_review.disposition = 'FAILED'
    WHERE failed_run.result_asset_id = asset.id
  )
  OR creation.is_output = 1
  OR ${transitionPreviewDictionaryReachabilityPredicate}
  OR ${transitionPreviewMaterialReachabilityPredicate}
)`;

// origin_type is open-ended producer provenance, not a visibility boundary. Requiring a
// user-facing relationship makes document evidence and every future private/derived origin
// fail closed until another feature deliberately promotes the asset.
const transitionPreviewReachabilityPredicate = `(
  creation.asset_id IS NOT NULL
  OR ${transitionPreviewDictionaryReachabilityPredicate}
  OR ${transitionPreviewMaterialReachabilityPredicate}
  OR ${transitionPreviewOwnerRatingReachabilityPredicate}
)`;

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class GalleryRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  /** Score-weighted, session-diverse previews rank outputs, dictionary images, and owner-rated images first. */
  listTransitionPreviewSources(limit = 24): TransitionPreviewSource[] {
    const normalizedLimit = Math.max(1, Math.min(24, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `WITH ${creationRelationshipsCte},
        transition_series_sessions AS (
          SELECT slot.series_id,
            CASE batch.scope_kind
              WHEN 'SERIES' THEN 'series:' || batch.scope_id
              ELSE 'experiment:' || batch.id
            END AS session_key,
            ROW_NUMBER() OVER (
              PARTITION BY slot.series_id
              ORDER BY batch.created_at DESC, batch.id DESC
            ) AS position
          FROM style_exploration_slots slot
          JOIN style_exploration_batches batch ON batch.id = slot.batch_id
        ),
        transition_preview_candidates AS MATERIALIZED (
          SELECT asset.id, asset.relative_path, asset.width, asset.height,
            COALESCE(
              transition_session.session_key,
              CASE WHEN creation.series_id IS NOT NULL THEN 'series:' || creation.series_id END,
              'asset:' || asset.id
            ) AS session_key,
            CASE WHEN creation.is_output = 1 OR ${transitionPreviewDictionaryReachabilityPredicate} OR ${transitionPreviewOwnerRatingReachabilityPredicate} THEN 0 WHEN creation.asset_id IS NOT NULL THEN 1 ELSE 2 END AS presentation_tier,
            -ln(
              (CAST(random() AS REAL) + 9223372036854775809.0) / 18446744073709551618.0
            ) / COALESCE(AVG(CAST(transition_rating.score AS REAL)), 0.5) AS selection_key
          FROM image_assets asset
          LEFT JOIN creation ON creation.asset_id = asset.id
          LEFT JOIN transition_series_sessions transition_session
            ON transition_session.series_id = creation.series_id AND transition_session.position = 1
          LEFT JOIN image_ratings transition_rating ON transition_rating.image_asset_id = asset.id
            AND transition_rating.evaluator_key = 'LOCAL_OWNER' AND transition_rating.deleted_at IS NULL
          WHERE asset.deleted_at IS NULL
            AND asset.width > 0 AND asset.height > 0
            AND ${transitionPreviewVisibilityPredicate}
            AND ${transitionPreviewReachabilityPredicate}
          GROUP BY asset.id, transition_session.session_key, creation.series_id
        ),
        transition_preview_ranked AS (
          SELECT candidate.*,
            ROW_NUMBER() OVER (
              PARTITION BY candidate.session_key
              ORDER BY candidate.presentation_tier, candidate.selection_key, candidate.id
            ) AS position
          FROM transition_preview_candidates candidate
        )
        SELECT id, relative_path, width, height FROM transition_preview_ranked
        ORDER BY position, presentation_tier, selection_key, id
        LIMIT ?`,
      )
      .all(normalizedLimit) as JsonMap[];
    const libraryRoot = path.resolve(this.storage.libraryRoot);
    const pathBoundary = `${libraryRoot}${path.sep}`;
    return rows.flatMap((row) => {
      const sourcePath = path.resolve(libraryRoot, text(row.relative_path));
      const [width, height] = [Number(row.width), Number(row.height)];
      if (!sourcePath.startsWith(pathBoundary) || !Number.isInteger(width) || !Number.isInteger(height)) return [];
      return [{ assetId: text(row.id), sourcePath, width, height }];
    });
  }

  list(input: GalleryListInput): GalleryPageDto {
    const limit = Math.max(1, Math.min(60, Math.trunc(input.limit)));
    const cursor = decodeCursor(input.cursor);
    const albumId = input.albumId;
    const userAlbumIsAllSource = input.source === 'ALL' && Boolean(albumId) && !isSystemMaterialAlbumId(albumId!);
    const predicate = userAlbumIsAllSource ? '1 = 1' : sourcePredicate(input.source);
    const assetKinds = [...new Set(input.assetKinds ?? [])];
    const assetKindClause = assetKinds.length ? `AND asset.kind IN (${assetKinds.map(() => '?').join(', ')})` : '';
    const { clause: materialAlbumClause, parameters: materialAlbumParameters } = materialAlbumFilter(input);
    const placementClause = materialPlacementClause(input.placement);
    const scopedDictionary = dictionaryFilter(input.dictionary);
    const favoriteOnlyClause =
      input.favoriteOnly && input.source !== 'FAVORITE' ? 'AND favorite.asset_id IS NOT NULL' : '';
    const query = input.query?.trim().toLowerCase() ?? '';
    const searchPattern = query ? `%${escapeLikePattern(query)}%` : '';
    const searchParameters = query ? new Array<string>(8).fill(searchPattern) : [];
    const searchClause = query ? `AND ${gallerySearchPredicate}` : '';
    const unratedDimensions = [...new Set(input.unratedDimensions)];
    const unratedClause = unratedDimensions.length
      ? `AND (${unratedDimensions.map((dimension) => `${ratingAliases[dimension]}.id IS NULL`).join(' OR ')})`
      : '';
    const cursorClause = cursor
      ? `AND (${creationSortExpression} < ? OR (${creationSortExpression} = ? AND asset.id < ?))`
      : '';
    const rows = this.db
      .prepare(
        `
      WITH ${creationRelationshipsCte},
      dictionary_relationships AS (
        SELECT link.image_asset_id AS asset_id, link.term_id,
          CASE link.role WHEN 'COVER' THEN 0 ELSE 1 END AS relationship_priority,
          link.sort_order, link.created_at, link.id
        FROM term_media_links link
        WHERE link.deleted_at IS NULL
        UNION ALL
        SELECT evidence.image_asset_id AS asset_id, evidence.term_id,
          2 AS relationship_priority, 0 AS sort_order,
          MIN(evidence.created_at) AS created_at, MIN(evidence.id) AS id
        FROM term_evidence evidence
        WHERE evidence.image_asset_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM term_media_links active_link
            WHERE active_link.image_asset_id = evidence.image_asset_id
              AND active_link.term_id = evidence.term_id AND active_link.deleted_at IS NULL
          )
        GROUP BY evidence.image_asset_id, evidence.term_id
      ),
      dictionary_ranked AS (
        SELECT relationship.asset_id, term.id AS term_id,
          COALESCE((
            SELECT localized.title FROM term_localizations localized
            WHERE localized.term_revision_id = revision.id AND localized.locale = '${input.locale}'
          ), revision.title) AS term_title,
          COUNT(*) OVER (PARTITION BY relationship.asset_id) AS term_count,
          ROW_NUMBER() OVER (
            PARTITION BY relationship.asset_id
            ORDER BY relationship.relationship_priority, relationship.sort_order,
              relationship.created_at, relationship.id
          ) AS position
        FROM dictionary_relationships relationship
        JOIN terms term ON term.id = relationship.term_id
        JOIN term_revisions revision ON revision.id = term.current_revision_id
        WHERE term.archived_at IS NULL
      ),
      dictionary AS (
        SELECT * FROM dictionary_ranked WHERE position = 1
      ),
      favorite_ranked AS (
        SELECT material.image_asset_id AS asset_id, material.id AS material_id,
          favorite.created_at AS favorite_created_at,
          ROW_NUMBER() OVER (
            PARTITION BY material.image_asset_id ORDER BY favorite.created_at DESC, favorite.id DESC
          ) AS position
        FROM material_favorites favorite
        JOIN materials material ON material.id = favorite.material_id
        WHERE favorite.deleted_at IS NULL AND material.deleted_at IS NULL AND material.archived_at IS NULL
          AND material.kind IN ('IMAGE', 'VIDEO') AND material.image_asset_id IS NOT NULL
      ),
      favorite AS (
        SELECT * FROM favorite_ranked WHERE position = 1
      )
      SELECT asset.id, asset.kind AS asset_kind, asset.origin_type, asset.width, asset.height,
        asset.mime_type, asset.byte_size, asset.created_at, ${creationSortExpression} AS sort_created_at,
        CASE
          WHEN gallery_material.kind = 'VIDEO' OR asset.mime_type LIKE 'video/%' THEN 'VIDEO'
          ELSE 'IMAGE'
        END AS material_kind,
        creation.run_id, creation.imported_output_id, creation.creation_created_at,
        creation.is_output AS creation_is_output, creation.relation_roles AS creation_relation_roles,
        creation.version_no, creation.series_id,
        creation.title AS series_title, creation.title_locale AS series_title_locale, dictionary.term_id,
        dictionary.term_title, dictionary.term_count,
        favorite.material_id, favorite.favorite_created_at,
        gallery_material.id AS gallery_material_id,
        external_metadata.original_name AS metadata_original_name,
        external_metadata.display_name AS metadata_display_name,
        external_metadata.note AS metadata_note, external_metadata.source_url AS metadata_source_url,
        external_metadata.ai_generated_status AS metadata_ai_generated_status,
        external_metadata.model_key AS metadata_model_key, external_metadata.model_name AS metadata_model_name,
        external_metadata.model_provider AS metadata_model_provider,
        external_metadata.model_version AS metadata_model_version,
        external_metadata.generation_text_type AS metadata_generation_text_type,
        external_metadata.generation_text AS metadata_generation_text,
        external_metadata.provenance_confidence AS metadata_provenance_confidence,
        external_metadata.updated_at AS metadata_updated_at,
        aesthetic_rating.id AS aesthetic_rating_id, aesthetic_rating.score AS aesthetic_score,
        aesthetic_rating.updated_at AS aesthetic_updated_at,
        realism_rating.id AS realism_rating_id, realism_rating.score AS realism_score,
        realism_rating.updated_at AS realism_updated_at
      FROM image_assets asset
      LEFT JOIN creation ON creation.asset_id = asset.id
      LEFT JOIN dictionary ON dictionary.asset_id = asset.id
      LEFT JOIN favorite ON favorite.asset_id = asset.id
      LEFT JOIN materials gallery_material ON gallery_material.image_asset_id = asset.id
        AND gallery_material.kind IN ('IMAGE', 'VIDEO') AND gallery_material.deleted_at IS NULL AND gallery_material.archived_at IS NULL
      LEFT JOIN external_material_metadata external_metadata
        ON external_metadata.material_id = gallery_material.id
      LEFT JOIN image_ratings aesthetic_rating ON aesthetic_rating.image_asset_id = asset.id
        AND aesthetic_rating.evaluator_key = ? AND aesthetic_rating.dimension = 'AESTHETIC'
        AND aesthetic_rating.deleted_at IS NULL
      LEFT JOIN image_ratings realism_rating ON realism_rating.image_asset_id = asset.id
        AND realism_rating.evaluator_key = ? AND realism_rating.dimension = 'REALISM'
        AND realism_rating.deleted_at IS NULL
      WHERE asset.deleted_at IS NULL AND ${predicate}
        AND ${galleryFailedOutputVisibilityPredicate}
        ${favoriteOnlyClause} ${assetKindClause} ${materialAlbumClause} ${placementClause}
        ${scopedDictionary.predicate} ${searchClause} ${unratedClause} ${cursorClause}
      ORDER BY ${creationSortExpression} DESC, asset.id DESC
      LIMIT ?
    `,
      )
      .all(
        evaluatorKey,
        evaluatorKey,
        ...assetKinds,
        ...materialAlbumParameters,
        ...scopedDictionary.parameters,
        ...searchParameters,
        ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        limit + 1,
      ) as JsonMap[];

    const unratedCountClause = unratedDimensions.length
      ? `AND (${unratedDimensions
          .map(
            (dimension) => `NOT EXISTS (
        SELECT 1 FROM image_ratings selected_rating
        WHERE selected_rating.image_asset_id = asset.id
          AND selected_rating.evaluator_key = ? AND selected_rating.dimension = '${dimension}'
          AND selected_rating.deleted_at IS NULL
      )`,
          )
          .join(' OR ')})`
      : '';
    const failedOutputCountVisibilityClause = `AND (
      NOT EXISTS (
        SELECT 1 FROM generation_runs failed_run
        JOIN generation_output_reviews failed_review
          ON failed_review.generation_run_id = failed_run.id
          AND failed_review.disposition = 'FAILED'
        WHERE failed_run.result_asset_id = asset.id
      )
      OR ${this.countPredicate('CREATION')}
      OR ${this.countPredicate('DICTIONARY')}
      OR ${this.countPredicate('FAVORITE')}
      OR EXISTS (
        SELECT 1 FROM materials visible_material
        WHERE visible_material.image_asset_id = asset.id
          AND visible_material.kind IN ('IMAGE', 'VIDEO')
          AND visible_material.deleted_at IS NULL AND visible_material.archived_at IS NULL
      )
    )`;
    const total =
      (input.cursor === null ? undefined : input.knownTotal) ??
      Number(
        (
          this.db
            .prepare(
              `
      SELECT COUNT(*) AS count FROM image_assets asset
      WHERE asset.deleted_at IS NULL AND ${userAlbumIsAllSource ? '1 = 1' : this.countPredicate(input.source)}
        ${failedOutputCountVisibilityClause}
        ${input.favoriteOnly && input.source !== 'FAVORITE' ? `AND ${this.countPredicate('FAVORITE')}` : ''}
        ${assetKindClause} ${materialAlbumClause} ${placementClause}
        ${scopedDictionary.predicate} ${searchClause} ${unratedCountClause}
    `,
            )
            .get(
              ...assetKinds,
              ...materialAlbumParameters,
              ...scopedDictionary.parameters,
              ...searchParameters,
              ...unratedDimensions.map(() => evaluatorKey),
            ) as JsonMap
        ).count,
      );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const seriesTitleLocalizations = titleLocalizationsByOwner(
      this.db,
      'PROMPT_SERIES',
      pageRows.map((row) => text(row.series_id)).filter(Boolean),
    );
    const items = pageRows.map((row) => this.toItem(row, input, seriesTitleLocalizations));
    const last = pageRows.at(-1);

    return {
      items,
      total,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: text(last.sort_created_at), id: text(last.id) }) : null,
    };
  }

  private countPredicate(source: GallerySourceFilter) {
    const creation = `asset.id IN (
      SELECT candidate.asset_id FROM (${creationOutputCandidatesSql}) candidate
      WHERE candidate.series_deleted_at IS NULL AND candidate.series_archived_at IS NULL
        AND candidate.asset_id IS NOT NULL
    )`;
    const dictionary = `asset.id IN (
      SELECT selected_dictionary.asset_id FROM (${dictionaryAssetTerms}) selected_dictionary
      JOIN terms term ON term.id = selected_dictionary.term_id
      WHERE term.archived_at IS NULL AND selected_dictionary.asset_id IS NOT NULL
    )`;
    const favorite = `EXISTS (
      SELECT 1 FROM materials material
      JOIN material_favorites selected_favorite ON selected_favorite.material_id = material.id
      WHERE material.image_asset_id = asset.id AND material.kind IN ('IMAGE', 'VIDEO')
        AND material.deleted_at IS NULL AND material.archived_at IS NULL
        AND selected_favorite.deleted_at IS NULL
    )`;
    const material = `EXISTS (
      SELECT 1 FROM materials selected_material
      WHERE selected_material.image_asset_id = asset.id AND selected_material.kind IN ('IMAGE', 'VIDEO')
        AND selected_material.deleted_at IS NULL AND selected_material.archived_at IS NULL
    )`;
    if (source === 'CREATION') return creation;
    if (source === 'DICTIONARY') return dictionary;
    if (source === 'FAVORITE') return favorite;
    if (source === 'MATERIAL') return material;
    if (source === 'LIBRARY') return `(${material} OR ${creation})`;
    if (source === 'IMPORT') return `(${material} AND NOT ${creation})`;
    return '1 = 1';
  }

  private toItem(
    row: JsonMap,
    input: GalleryListInput,
    seriesTitleLocalizations: ReadonlyMap<string, Array<{ locale: string; title: string }>>,
  ): GalleryItemDto {
    const hasCreation = Boolean(row.series_id);
    const hasCreationOutput = Number(row.creation_is_output) === 1;
    const hasDictionary = Boolean(row.term_id);
    const hasFavorite = Boolean(row.material_id);
    const rating = (dimension: ImageRatingDto['dimension'], prefix: 'aesthetic' | 'realism'): ImageRatingDto | null =>
      row[`${prefix}_rating_id`]
        ? {
            id: text(row[`${prefix}_rating_id`]),
            imageAssetId: text(row.id),
            dimension,
            score: Number(row[`${prefix}_score`]),
            updatedAt: text(row[`${prefix}_updated_at`]),
          }
        : null;
    const seriesTitle = row.series_id
      ? resolveStoredTitle(
          { title: row.series_title, title_locale: row.series_title_locale },
          input.locale,
          seriesTitleLocalizations.get(text(row.series_id)) ?? [],
        )
      : '';

    return {
      id: text(row.id),
      materialId: row.gallery_material_id ? text(row.gallery_material_id) : null,
      materialKind: text(row.material_kind) === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      source:
        hasCreationOutput && hasDictionary
          ? 'BOTH'
          : hasCreationOutput
            ? 'CREATION'
            : hasDictionary
              ? 'DICTIONARY'
              : hasFavorite
                ? 'FAVORITE'
                : 'MATERIAL',
      createdAt: text(row.created_at),
      asset: {
        id: text(row.id),
        kind: text(row.asset_kind) as GalleryItemDto['asset']['kind'],
        originType: text(row.origin_type),
        width: Number(row.width),
        height: Number(row.height),
        mimeType: text(row.mime_type),
        byteSize: Number(row.byte_size),
        mediaUrl: mediaUrl(text(row.id)),
        createdAt: text(row.created_at),
      },
      creation: hasCreation
        ? {
            runId: row.run_id ? text(row.run_id) : null,
            importedOutputId: row.imported_output_id ? text(row.imported_output_id) : null,
            seriesId: text(row.series_id),
            seriesTitle,
            versionNo: row.version_no == null ? null : Number(row.version_no),
            roles: text(row.creation_relation_roles)
              .split(',')
              .filter(
                (role): role is NonNullable<GalleryItemDto['creation']>['roles'][number] =>
                  role === 'INPUT' || role === 'SOURCE' || role === 'OUTPUT',
              )
              .sort(
                (left, right) =>
                  ['INPUT', 'SOURCE', 'OUTPUT'].indexOf(left) - ['INPUT', 'SOURCE', 'OUTPUT'].indexOf(right),
              ),
          }
        : null,
      dictionary: hasDictionary
        ? {
            termId: text(row.term_id),
            termName: text(row.term_title),
            additionalTermCount: Math.max(0, Number(row.term_count) - 1),
          }
        : null,
      favorite: hasFavorite
        ? {
            materialId: text(row.material_id),
            createdAt: text(row.favorite_created_at),
          }
        : null,
      metadata: row.metadata_updated_at
        ? {
            materialId: text(row.gallery_material_id),
            originalName: text(row.metadata_original_name),
            displayName: text(row.metadata_display_name),
            note: text(row.metadata_note),
            sourceUrl: text(row.metadata_source_url),
            aiGeneratedStatus: text(
              row.metadata_ai_generated_status,
            ) as ExternalMaterialMetadataDto['aiGeneratedStatus'],
            executionRouteKey: row.metadata_model_key ? text(row.metadata_model_key) : null,
            modelName: text(row.metadata_model_name),
            modelProvider: text(row.metadata_model_provider),
            modelVersion: text(row.metadata_model_version),
            generationTextType: text(
              row.metadata_generation_text_type,
            ) as ExternalMaterialMetadataDto['generationTextType'],
            generationText: text(row.metadata_generation_text),
            provenanceConfidence: text(row.metadata_provenance_confidence) as 'DECLARED' | 'UNKNOWN',
            updatedAt: text(row.metadata_updated_at),
          }
        : null,
      ratings: {
        aesthetic: rating('AESTHETIC', 'aesthetic'),
        realism: rating('REALISM', 'realism'),
      },
    };
  }
}
