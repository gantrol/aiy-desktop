import { ulid } from 'ulid';
import type {
  AssetDto,
  CreateMaterialCollectionFromSourceInput,
  CreateMaterialCollectionFromSourceResult,
  CreationRelationFilter,
  CreationGroupDto,
  MaterialAlbumAddManyInput,
  MaterialAlbumCreateInput,
  MaterialAlbumDto,
  MaterialAlbumListInput,
  MaterialAlbumMemberDto,
  MaterialAlbumRemoveInput,
  MaterialAlbumRenameInput,
  MaterialAlbumSystemKey,
  MaterialCollectionDto,
  RenameCreationGroupInput,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { albumProjectedAssetPredicate } from '@/main/database/album-projection-repository';
import { AlbumRepository } from '@/main/database/album-repository';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/album-intents';
import {
  databaseBatches as batches,
  ensureImageMaterials,
  sqlPlaceholders as placeholders,
} from '@/main/database/image-material-batch';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/values';

export const MATERIAL_ALBUM_CREATION_ROOT_ID = 'material-album:system:creation-root';
export const MATERIAL_ALBUM_CREATION_UNASSIGNED_ID = 'material-album:system:creation-unassigned';
export const MATERIAL_ALBUM_DICTIONARY_ID = 'material-album:system:dictionary';
const MATERIAL_ALBUM_CREATION_GROUP_PREFIX = 'material-album:system:creation-group:';
const MATERIAL_ALBUM_CREATION_SERIES_PREFIX = 'material-album:system:creation-series:';
const MATERIAL_ALBUM_DICTIONARY_DOMAIN_PREFIX = 'material-album:system:dictionary-domain:';
const MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID = 'material-album:system:dictionary-uncategorized';

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

interface CreationScopeSql {
  cte: string;
  parameters: string[];
}

function creationRootScope(): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT id FROM prompt_series WHERE deleted_at IS NULL
    )`,
    parameters: [],
  };
}

function creationGroupScope(sourceAlbumId: string): CreationScopeSql {
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

function creationSeriesScope(sourceSeriesId: string): CreationScopeSql {
  return {
    cte: `WITH scoped_series(id) AS (
      SELECT id FROM prompt_series WHERE id = ? AND deleted_at IS NULL
    )`,
    parameters: [sourceSeriesId],
  };
}

function creationUnassignedScope(): CreationScopeSql {
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

function creationScopeAssetFilter(
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

const promptSeriesAssetPredicate = creationScopeAssetFilter(creationSeriesScope('__SERIES_ID__'), 'OUTPUT').predicate;

const dictionaryAssetPredicate = `EXISTS (
  SELECT 1 FROM term_media_links material_album_media
  JOIN terms material_album_term ON material_album_term.id = material_album_media.term_id
  WHERE material_album_media.image_asset_id = asset.id
    AND material_album_media.deleted_at IS NULL
    AND material_album_term.archived_at IS NULL
)`;

const dictionaryDomainAssetPredicate = `EXISTS (
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

const dictionaryUncategorizedAssetPredicate = `EXISTS (
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

const userAlbumAssetPredicate = albumProjectedAssetPredicate;

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

function normalizeTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error('Material album title is required');
  if (title.length > 200) throw new Error('Material album title is too long');
  return title;
}

function normalizeCreationGroupTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error('Creation group title is required');
  if (title.length > 200) throw new Error('Creation group title is too long');
  return title;
}

function assetDto(row: JsonMap, prefix = ''): AssetDto {
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

interface SystemAlbumSummary {
  materialCount: number;
  previewAssets: AssetDto[];
}

export class MaterialAlbumRepository {
  private readonly db: LibraryStorage['db'];
  private readonly albums: AlbumRepository;

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
    this.albums = new AlbumRepository(storage);
  }

  list(input: MaterialAlbumListInput): MaterialAlbumDto[] {
    const creationTreeSummaries = this.creationSeriesSummaries();
    const root = this.systemAlbum(
      MATERIAL_ALBUM_CREATION_ROOT_ID,
      'CREATION_ROOT',
      input.locale === 'zh' ? '创作' : 'Creation',
      null,
      null,
      null,
      creationTreeSummaries.root,
    );
    // Only albums that actually hold creations get a read-only outputs view;
    // pure material albums would just repeat their `userAlbums` entry here.
    const creationGroupRows = this.db
      .prepare(
        `SELECT album.id, album.title, album.created_at, parent.album_id AS parent_album_id
      FROM albums album
      LEFT JOIN album_members parent ON parent.target_type = 'ALBUM'
        AND parent.target_id = album.id AND parent.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM albums parent_album
          WHERE parent_album.id = parent.album_id AND parent_album.deleted_at IS NULL
            AND parent_album.intent <> ?
        )
      WHERE album.deleted_at IS NULL AND album.intent <> ? AND EXISTS (
        SELECT 1 FROM album_members member
        WHERE member.album_id = album.id AND member.deleted_at IS NULL
          AND member.target_type IN ('SERIES', 'ALBUM')
      )
      ORDER BY album.pinned DESC, album.created_at, album.id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT, MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const creationGroupSummaries = this.creationGroupSummaries();
    const creationGroupIds = new Set(creationGroupRows.map((row) => text(row.id)));
    const creationGroups = creationGroupRows.map((row) =>
      this.systemAlbum(
        materialAlbumCreationGroupId(text(row.id)),
        'CREATION_GROUP',
        text(row.title),
        row.parent_album_id && creationGroupIds.has(text(row.parent_album_id))
          ? materialAlbumCreationGroupId(text(row.parent_album_id))
          : MATERIAL_ALBUM_CREATION_ROOT_ID,
        text(row.id),
        text(row.created_at),
        creationGroupSummaries.get(text(row.id)) ?? { materialCount: 0, previewAssets: [] },
      ),
    );
    const seriesRows = this.db
      .prepare(
        `SELECT series.id, series.title, series.title_zh, series.title_en, series.created_at,
          member.album_id AS source_album_id, member.sort_order,
          root_order.sort_order AS root_sort_order
        FROM prompt_series series
        LEFT JOIN album_members member ON member.target_type = 'SERIES'
          AND member.target_id = series.id AND member.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM albums owner
            WHERE owner.id = member.album_id AND owner.deleted_at IS NULL AND owner.intent <> ?
          )
        LEFT JOIN sidebar_root_order root_order ON root_order.scope = 'CREATOR'
          AND root_order.target_type = 'SERIES' AND root_order.target_id = series.id
        WHERE series.deleted_at IS NULL
        ORDER BY member.album_id IS NULL, member.album_id, member.sort_order,
          root_order.sort_order IS NULL, root_order.sort_order, series.created_at, series.id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const hasUnassignedSeries = seriesRows.some((row) => !row.source_album_id);
    const unassigned = hasUnassignedSeries
      ? [
          this.systemAlbum(
            MATERIAL_ALBUM_CREATION_UNASSIGNED_ID,
            'CREATION_UNASSIGNED',
            input.locale === 'zh' ? '未归图集' : 'Unassigned',
            MATERIAL_ALBUM_CREATION_ROOT_ID,
            null,
            null,
            creationTreeSummaries.unassigned,
          ),
        ]
      : [];
    const creationSeries = seriesRows.map((row) => {
      const seriesId = text(row.id);
      const sourceAlbumId = row.source_album_id ? text(row.source_album_id) : null;
      const localizedTitle =
        input.locale === 'zh' ? text(row.title_zh) || text(row.title) : text(row.title_en) || text(row.title);
      return this.systemAlbum(
        materialAlbumCreationSeriesId(seriesId),
        'CREATION_SERIES',
        localizedTitle,
        sourceAlbumId && creationGroupIds.has(sourceAlbumId)
          ? materialAlbumCreationGroupId(sourceAlbumId)
          : MATERIAL_ALBUM_CREATION_UNASSIGNED_ID,
        null,
        text(row.created_at),
        creationTreeSummaries.bySeries.get(seriesId) ?? { materialCount: 0, previewAssets: [] },
        seriesId,
      );
    });
    const dictionary = this.systemAlbum(
      MATERIAL_ALBUM_DICTIONARY_ID,
      'DICTIONARY',
      input.locale === 'zh' ? '词典' : 'Dictionary',
      null,
      null,
    );
    const dictionaryDomains = this.dictionaryDomainAlbums(input.locale);
    const uncategorized = this.systemAlbum(
      MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID,
      'DICTIONARY_DOMAIN',
      input.locale === 'zh' ? '未分类' : 'Uncategorized',
      MATERIAL_ALBUM_DICTIONARY_ID,
      null,
    );
    if (uncategorized.materialCount > 0) dictionaryDomains.push(uncategorized);
    const userAlbumRows = this.db
      .prepare(
        `SELECT * FROM albums
      WHERE deleted_at IS NULL AND intent = ? ORDER BY created_at, id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const userAlbums = this.userAlbumDtos(userAlbumRows);
    return [root, ...creationGroups, ...unassigned, ...creationSeries, dictionary, ...dictionaryDomains, ...userAlbums];
  }

  create(input: MaterialAlbumCreateInput): MaterialAlbumDto {
    const title = normalizeTitle(input.title);
    const id = ulid();
    const timestamp = now();
    this.db
      .transaction(() => {
        if (input.parentAlbumId) this.assertMutableAlbum(input.parentAlbumId);
        this.db
          .prepare(
            `INSERT INTO albums
        (id, title, intent, defaults_json, pinned, created_at, updated_at)
        VALUES (?, ?, ?, '{}', 0, ?, ?)`,
          )
          .run(id, title, MATERIAL_LIBRARY_ALBUM_INTENT, timestamp, timestamp);
        this.storage.recordChange('ALBUM', id, 'CREATE', { title });
        if (input.parentAlbumId) {
          this.attachChildAlbum(input.parentAlbumId, id, timestamp);
        }
      })
      .immediate();
    return this.getUserAlbumDto(id);
  }

  createCollectionFromSource(
    input: CreateMaterialCollectionFromSourceInput,
    snapshotAssetIds: readonly string[],
  ): CreateMaterialCollectionFromSourceResult {
    const source = this.resolveCollectionSource(input);
    const title = input.title === undefined ? source.title : normalizeTitle(input.title);
    const imageAssetIds = [...new Set(snapshotAssetIds)];
    if (imageAssetIds.length === 0) throw new Error('Material collection source has no materials');

    const collectionId = this.db
      .transaction(() => {
        this.assertAssetsMatchSource(imageAssetIds, source.filter);
        const materialIds = ensureImageMaterials(this.storage, imageAssetIds);
        const collectionId = ulid();
        const timestamp = now();
        this.db
          .prepare(
            `INSERT INTO albums
        (id, title, intent, defaults_json, pinned, created_at, updated_at)
        VALUES (?, ?, ?, '{}', 0, ?, ?)`,
          )
          .run(collectionId, title, MATERIAL_LIBRARY_ALBUM_INTENT, timestamp, timestamp);
        this.storage.recordChange('ALBUM', collectionId, 'CREATE', {
          title,
          source: input.source,
        });

        const insertMember = this.db.prepare(
          `INSERT INTO album_members
        (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, 'MATERIAL', ?, ?, ?, ?, NULL)`,
        );
        for (const [sortOrder, materialId] of materialIds.entries()) {
          const memberId = ulid();
          insertMember.run(memberId, collectionId, materialId, sortOrder, timestamp, timestamp);
          this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
            albumId: collectionId,
            materialId,
            sortOrder,
          });
        }
        return collectionId;
      })
      .immediate();

    return {
      source: input.source,
      collection: this.getUserAlbumDto(collectionId) as MaterialCollectionDto,
      capturedMaterialCount: imageAssetIds.length,
    };
  }

  renameCreationGroup(input: RenameCreationGroupInput): CreationGroupDto {
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare(
            `SELECT title FROM albums
        WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(input.creationGroupId) as JsonMap | undefined;
        if (!existing) throw new Error('Creation group not found');
        const title = normalizeCreationGroupTitle(input.title);
        if (text(existing.title) !== title) {
          this.albums.rename({ albumId: input.creationGroupId, title });
        }
        return this.getCreationGroupDto(input.creationGroupId);
      })
      .immediate();
  }

  rename(input: MaterialAlbumRenameInput): MaterialAlbumDto {
    const title = normalizeTitle(input.title);
    this.assertMutableAlbum(input.albumId);
    this.db
      .transaction(() => {
        const current = this.db
          .prepare(
            `SELECT title FROM albums
        WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(input.albumId) as JsonMap;
        if (text(current.title) === title) return;
        const timestamp = now();
        this.db
          .prepare('UPDATE albums SET title = ?, updated_at = ? WHERE id = ?')
          .run(title, timestamp, input.albumId);
        this.storage.recordChange('ALBUM', input.albumId, 'RENAME', { title });
      })
      .immediate();
    return this.getUserAlbumDto(input.albumId);
  }

  delete(albumId: string): void {
    this.assertMutableAlbum(albumId);
    this.db
      .transaction(() => {
        const deletedAt = now();
        const result = this.db
          .prepare(
            `UPDATE albums SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(deletedAt, deletedAt, albumId);
        if (!result.changes) throw new Error('Material album not found');
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), albumId, deletedAt);
        this.storage.recordChange('ALBUM', albumId, 'DELETE', {});
      })
      .immediate();
  }

  addMany(input: MaterialAlbumAddManyInput): MaterialAlbumDto;
  addMany(input: MaterialAlbumAddManyInput, options: { returnDto: false }): void;
  addMany(input: MaterialAlbumAddManyInput, options?: { returnDto: false }): MaterialAlbumDto | void {
    this.assertMutableAlbum(input.albumId);
    return this.db
      .transaction(() => {
        const requestedMaterialIds = [
          ...new Set(input.targets.flatMap((target) => (target.kind === 'MATERIAL' ? [target.materialId] : []))),
        ];
        const requestedAssetIds = [
          ...new Set(input.targets.flatMap((target) => (target.kind === 'IMAGE_ASSET' ? [target.imageAssetId] : []))),
        ];
        this.requireMaterials(requestedMaterialIds);
        const assetMaterialIds = ensureImageMaterials(this.storage, requestedAssetIds);
        const materialByAssetId = new Map(
          requestedAssetIds.map((assetId, index) => [assetId, assetMaterialIds[index]]),
        );
        const materialIds: string[] = [];
        const seen = new Set<string>();
        for (const target of input.targets) {
          const materialId =
            target.kind === 'MATERIAL' ? target.materialId : (materialByAssetId.get(target.imageAssetId) as string);
          if (seen.has(materialId)) continue;
          seen.add(materialId);
          materialIds.push(materialId);
        }
        let sortOrder = Number(
          (
            this.db
              .prepare(
                `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
        FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
              )
              .get(input.albumId) as JsonMap
          ).next_order,
        );
        const membershipsByMaterialId = new Map<string, JsonMap>();
        for (const batch of batches(materialIds)) {
          const rows = this.db
            .prepare(
              `SELECT id, target_id, deleted_at FROM album_members
            WHERE album_id = ? AND target_type = 'MATERIAL'
              AND target_id IN (${placeholders(batch.length)})`,
            )
            .all(input.albumId, ...batch) as JsonMap[];
          for (const row of rows) membershipsByMaterialId.set(text(row.target_id), row);
        }
        const restoreMembership = this.db.prepare(
          `UPDATE album_members
        SET sort_order = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`,
        );
        const insertMembership = this.db.prepare(
          `INSERT INTO album_members
        (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, 'MATERIAL', ?, ?, ?, ?, NULL)`,
        );
        for (const materialId of materialIds) {
          const existing = membershipsByMaterialId.get(materialId);
          if (existing && !existing.deleted_at) continue;
          const timestamp = now();
          if (existing) {
            const memberId = text(existing.id);
            restoreMembership.run(sortOrder, timestamp, memberId);
            this.storage.recordChange('ALBUM_MEMBER', memberId, 'RESTORE', {
              albumId: input.albumId,
              materialId,
              sortOrder,
            });
          } else {
            const memberId = ulid();
            insertMembership.run(memberId, input.albumId, materialId, sortOrder, timestamp, timestamp);
            this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
              albumId: input.albumId,
              materialId,
              sortOrder,
            });
          }
          sortOrder += 1;
        }
        this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), input.albumId);
        if (options?.returnDto === false) return;
        return this.getUserAlbumDto(input.albumId);
      })
      .immediate();
  }

  remove(input: MaterialAlbumRemoveInput): MaterialAlbumDto {
    this.assertMutableAlbum(input.albumId);
    return this.db
      .transaction(() => {
        const materialIds = [...new Set(input.materialIds)];
        const membershipsByMaterialId = new Map<string, string>();
        for (const batch of batches(materialIds)) {
          const rows = this.db
            .prepare(
              `SELECT id, target_id FROM album_members
              WHERE album_id = ? AND target_type = 'MATERIAL'
                AND target_id IN (${placeholders(batch.length)}) AND deleted_at IS NULL`,
            )
            .all(input.albumId, ...batch) as JsonMap[];
          for (const row of rows) membershipsByMaterialId.set(text(row.target_id), text(row.id));
        }
        const deleteMembership = this.db.prepare(
          'UPDATE album_members SET updated_at = ?, deleted_at = ? WHERE id = ?',
        );
        const insertTombstone = this.db.prepare(
          "INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')",
        );
        for (const materialId of materialIds) {
          const memberId = membershipsByMaterialId.get(materialId);
          if (!memberId) continue;
          const deletedAt = now();
          deleteMembership.run(deletedAt, deletedAt, memberId);
          insertTombstone.run(ulid(), memberId, deletedAt);
          this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
            albumId: input.albumId,
            materialId,
          });
        }
        this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), input.albumId);
        return this.getUserAlbumDto(input.albumId);
      })
      .immediate();
  }

  /** Summarize every creation group with one recursive, set-oriented query. */
  private creationGroupSummaries() {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE
        group_roots(id) AS (
          SELECT album.id FROM albums album
          WHERE album.deleted_at IS NULL AND album.intent <> ? AND EXISTS (
            SELECT 1 FROM album_members member
            WHERE member.album_id = album.id AND member.deleted_at IS NULL
              AND member.target_type IN ('SERIES', 'ALBUM')
          )
        ),
        descendants(root_id, id) AS (
          SELECT id, id FROM group_roots
          UNION
          SELECT descendants.root_id, child.id
          FROM descendants
          JOIN album_members edge ON edge.album_id = descendants.id
            AND edge.target_type = 'ALBUM' AND edge.deleted_at IS NULL
          JOIN albums child ON child.id = edge.target_id AND child.deleted_at IS NULL
        ),
        grouped_series(root_id, series_id) AS (
          SELECT DISTINCT descendants.root_id, member.target_id
          FROM descendants
          JOIN album_members member ON member.album_id = descendants.id
            AND member.target_type = 'SERIES' AND member.deleted_at IS NULL
          JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
        ),
        group_relationships(root_id, asset_id, relationship_role) AS (
          SELECT grouped_series.root_id, run.result_asset_id, 'OUTPUT'
          FROM grouped_series
          JOIN prompt_versions version ON version.series_id = grouped_series.series_id
          JOIN generation_runs run ON run.prompt_version_id = version.id
            AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM generation_output_reviews review
              WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
            )
          UNION
          SELECT grouped_series.root_id, imported.image_asset_id, 'OUTPUT'
          FROM grouped_series
          JOIN creation_output_imports imported ON imported.series_id = grouped_series.series_id
            AND imported.deleted_at IS NULL
          UNION
          SELECT grouped_series.root_id, transform.output_asset_id, 'OUTPUT'
          FROM grouped_series
          JOIN image_transform_runs transform ON transform.series_id = grouped_series.series_id
            AND transform.deleted_at IS NULL
          UNION
          SELECT grouped_series.root_id, binding.image_asset_id, 'INPUT'
          FROM grouped_series
          JOIN prompt_series series ON series.id = grouped_series.series_id
          JOIN reference_bindings binding ON binding.prompt_version_id = series.current_version_id
            AND binding.source_type = 'DIRECT'
          UNION
          SELECT grouped_series.root_id, version.source_image_id, 'INPUT'
          FROM grouped_series
          JOIN prompt_series series ON series.id = grouped_series.series_id
          JOIN prompt_versions version ON version.id = series.current_version_id
          WHERE version.source_image_id IS NOT NULL
        ), group_assets(root_id, asset_id) AS (
          SELECT DISTINCT relationship.root_id, relationship.asset_id
          FROM group_relationships relationship
          WHERE relationship.relationship_role = 'OUTPUT' OR EXISTS (
            SELECT 1 FROM materials material
            WHERE material.image_asset_id = relationship.asset_id AND material.kind = 'IMAGE'
              AND material.deleted_at IS NULL
          )
        ),
        ranked AS (
          SELECT group_assets.root_id, asset.*,
            count(*) OVER (PARTITION BY group_assets.root_id) AS material_count,
            row_number() OVER (
              PARTITION BY group_assets.root_id
              ORDER BY asset.created_at DESC, asset.id DESC
            ) AS preview_rank
          FROM group_assets
          JOIN image_assets asset ON asset.id = group_assets.asset_id AND asset.deleted_at IS NULL
        )
        SELECT * FROM ranked WHERE preview_rank <= 4
        ORDER BY root_id, preview_rank`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const summaries = new Map<string, SystemAlbumSummary>();
    for (const row of rows) {
      const rootId = text(row.root_id);
      const summary = summaries.get(rootId) ?? {
        materialCount: Number(row.material_count),
        previewAssets: [],
      };
      summary.previewAssets.push(assetDto(row));
      summaries.set(rootId, summary);
    }
    return summaries;
  }

  /** Summarize every creation leaf in one set query; inputs are current-version only. */
  private creationSeriesSummaries() {
    const rows = this.db
      .prepare(
        `WITH series_relationships(series_id, asset_id, relationship_role) AS (
          SELECT version.series_id, run.result_asset_id, 'OUTPUT'
          FROM prompt_versions version
          JOIN prompt_series series ON series.id = version.series_id AND series.deleted_at IS NULL
          JOIN generation_runs run ON run.prompt_version_id = version.id
            AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM generation_output_reviews review
              WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
            )
          UNION
          SELECT imported.series_id, imported.image_asset_id, 'OUTPUT'
          FROM creation_output_imports imported
          JOIN prompt_series series ON series.id = imported.series_id AND series.deleted_at IS NULL
          WHERE imported.deleted_at IS NULL
          UNION
          SELECT transform.series_id, transform.output_asset_id, 'OUTPUT'
          FROM image_transform_runs transform
          JOIN prompt_series series ON series.id = transform.series_id AND series.deleted_at IS NULL
          WHERE transform.deleted_at IS NULL
          UNION
          SELECT series.id, binding.image_asset_id, 'INPUT'
          FROM prompt_series series
          JOIN reference_bindings binding ON binding.prompt_version_id = series.current_version_id
            AND binding.source_type = 'DIRECT'
          WHERE series.deleted_at IS NULL
          UNION
          SELECT series.id, version.source_image_id, 'INPUT'
          FROM prompt_series series
          JOIN prompt_versions version ON version.id = series.current_version_id
          WHERE series.deleted_at IS NULL AND version.source_image_id IS NOT NULL
        ), series_assets(series_id, asset_id) AS (
          SELECT DISTINCT relationship.series_id, relationship.asset_id
          FROM series_relationships relationship
          WHERE relationship.relationship_role = 'OUTPUT' OR EXISTS (
            SELECT 1 FROM materials material
            WHERE material.image_asset_id = relationship.asset_id AND material.kind = 'IMAGE'
              AND material.deleted_at IS NULL
          )
        ), scoped_assets(scope_id, asset_id) AS (
          SELECT 'SERIES:' || series_assets.series_id, series_assets.asset_id FROM series_assets
          UNION
          SELECT 'ROOT', series_assets.asset_id FROM series_assets
          UNION
          SELECT 'UNASSIGNED', series_assets.asset_id
          FROM series_assets
          WHERE NOT EXISTS (
            SELECT 1 FROM album_members member
            JOIN albums owner ON owner.id = member.album_id
              AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
            WHERE member.target_type = 'SERIES' AND member.target_id = series_assets.series_id
              AND member.deleted_at IS NULL
          )
        ), ranked AS (
          SELECT scoped_assets.scope_id, asset.*,
            count(*) OVER (PARTITION BY scoped_assets.scope_id) AS material_count,
            row_number() OVER (
              PARTITION BY scoped_assets.scope_id
              ORDER BY asset.created_at DESC, asset.id DESC
            ) AS preview_rank
          FROM scoped_assets
          JOIN image_assets asset ON asset.id = scoped_assets.asset_id AND asset.deleted_at IS NULL
        )
        SELECT * FROM ranked WHERE preview_rank <= 4
        ORDER BY scope_id, preview_rank`,
      )
      .all() as JsonMap[];
    const bySeries = new Map<string, SystemAlbumSummary>();
    const root: SystemAlbumSummary = { materialCount: 0, previewAssets: [] };
    const unassigned: SystemAlbumSummary = { materialCount: 0, previewAssets: [] };
    for (const row of rows) {
      const scopeId = text(row.scope_id);
      const summary =
        scopeId === 'ROOT'
          ? root
          : scopeId === 'UNASSIGNED'
            ? unassigned
            : (bySeries.get(scopeId.slice('SERIES:'.length)) ?? {
                materialCount: Number(row.material_count),
                previewAssets: [],
              });
      summary.materialCount = Number(row.material_count);
      summary.previewAssets.push(assetDto(row));
      if (scopeId.startsWith('SERIES:')) bySeries.set(scopeId.slice('SERIES:'.length), summary);
    }
    return { bySeries, root, unassigned };
  }

  /** Summarize all populated primary dictionary domains in one query. */
  private dictionaryDomainAlbums(locale: MaterialAlbumListInput['locale']) {
    const nameColumn = locale === 'zh' ? 'name_zh' : 'name_en';
    const rows = this.db
      .prepare(
        `WITH domain_assets(domain_id, asset_id) AS (
          SELECT DISTINCT value.id, asset.id
          FROM facet_definitions definition
          JOIN facet_values value ON value.definition_id = definition.id
          JOIN term_facet_assignments assignment ON assignment.facet_value_id = value.id
          JOIN terms term ON term.current_revision_id = assignment.term_revision_id
            AND term.archived_at IS NULL
          JOIN term_media_links media ON media.term_id = term.id AND media.deleted_at IS NULL
          JOIN image_assets asset ON asset.id = media.image_asset_id AND asset.deleted_at IS NULL
          WHERE definition.system_role = 'PRIMARY_CLASSIFICATION'
        ),
        ranked AS (
          SELECT domain_assets.domain_id, value.${nameColumn} AS domain_title,
            value.sort_order AS domain_sort_order, asset.*,
            count(*) OVER (PARTITION BY domain_assets.domain_id) AS material_count,
            row_number() OVER (
              PARTITION BY domain_assets.domain_id
              ORDER BY asset.created_at DESC, asset.id DESC
            ) AS preview_rank
          FROM domain_assets
          JOIN facet_values value ON value.id = domain_assets.domain_id
          JOIN image_assets asset ON asset.id = domain_assets.asset_id
        )
        SELECT * FROM ranked WHERE preview_rank <= 4
        ORDER BY domain_sort_order, domain_id, preview_rank`,
      )
      .all() as JsonMap[];
    const summaries = new Map<string, { title: string; summary: SystemAlbumSummary }>();
    for (const row of rows) {
      const domainId = text(row.domain_id);
      const value = summaries.get(domainId) ?? {
        title: text(row.domain_title),
        summary: { materialCount: Number(row.material_count), previewAssets: [] },
      };
      value.summary.previewAssets.push(assetDto(row));
      summaries.set(domainId, value);
    }
    return [...summaries].map(([domainId, value]) =>
      this.systemAlbum(
        materialAlbumDictionaryDomainId(domainId),
        'DICTIONARY_DOMAIN',
        value.title,
        MATERIAL_ALBUM_DICTIONARY_ID,
        null,
        null,
        value.summary,
      ),
    );
  }

  private systemAlbum(
    id: string,
    systemKey: MaterialAlbumSystemKey,
    title: string,
    parentId: string | null,
    sourceAlbumId: string | null,
    createdAt: string | null = null,
    summary?: SystemAlbumSummary,
    sourceSeriesId: string | null = null,
  ): MaterialAlbumDto {
    let materialCount: number;
    let previewAssets: AssetDto[];
    if (summary) {
      materialCount = summary.materialCount;
      previewAssets = summary.previewAssets;
    } else {
      const filter = materialAlbumAssetFilter(
        id,
        systemKey === 'CREATION_ROOT' ||
          systemKey === 'CREATION_GROUP' ||
          systemKey === 'CREATION_UNASSIGNED' ||
          systemKey === 'CREATION_SERIES'
          ? 'ALL'
          : 'OUTPUT',
      );
      materialCount = Number(
        (
          this.db
            .prepare(
              `SELECT COUNT(*) AS count FROM image_assets asset
        WHERE asset.deleted_at IS NULL AND ${filter.predicate}`,
            )
            .get(...filter.parameters) as JsonMap
        ).count,
      );
      previewAssets = (
        this.db
          .prepare(
            `SELECT asset.* FROM image_assets asset
        WHERE asset.deleted_at IS NULL AND ${filter.predicate}
        ORDER BY asset.created_at DESC, asset.id DESC LIMIT 4`,
          )
          .all(...filter.parameters) as JsonMap[]
      ).map((row) => assetDto(row));
    }
    return {
      id,
      kind: 'SYSTEM',
      systemKey,
      sourceAlbumId,
      sourceSeriesId,
      title,
      materialCount,
      previewAssets,
      readOnly: true,
      parentId,
      createdAt,
      updatedAt: null,
      members: [],
    };
  }

  private getUserAlbumDto(albumId: string): MaterialAlbumDto {
    const row = this.db
      .prepare(
        `SELECT * FROM albums
      WHERE id = ? AND deleted_at IS NULL AND intent = ?`,
      )
      .get(albumId, MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap | undefined;
    if (!row) throw new Error('Material album not found');
    return this.userAlbumDto(row);
  }

  /** Load every user album's hierarchy and members in two shared queries. */
  private userAlbumDtos(rows: JsonMap[]): MaterialAlbumDto[] {
    if (!rows.length) return [];
    const parentRows = this.db
      .prepare(
        `SELECT edge.target_id AS child_id, edge.album_id AS parent_id
        FROM album_members edge
        JOIN albums child ON child.id = edge.target_id
          AND child.deleted_at IS NULL AND child.intent = ?
        WHERE edge.target_type = 'ALBUM' AND edge.deleted_at IS NULL
        ORDER BY edge.target_id, edge.updated_at DESC, edge.id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const parentByAlbumId = new Map<string, string>();
    for (const parent of parentRows) {
      const childId = text(parent.child_id);
      if (!parentByAlbumId.has(childId)) parentByAlbumId.set(childId, text(parent.parent_id));
    }

    const memberRows = this.db
      .prepare(
        `SELECT member.*, material.kind AS material_kind,
        material.text_content AS material_text,
        asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
        asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
        asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
        FROM album_members member
        JOIN albums owner ON owner.id = member.album_id
          AND owner.deleted_at IS NULL AND owner.intent = ?
        JOIN materials material ON material.id = member.target_id AND material.deleted_at IS NULL
        LEFT JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
        WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
          AND (material.kind = 'TEXT' OR asset.id IS NOT NULL)
        ORDER BY member.album_id, member.sort_order, member.id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const membersByAlbumId = new Map<string, MaterialAlbumMemberDto[]>();
    for (const member of memberRows) {
      const albumId = text(member.album_id);
      const members = membersByAlbumId.get(albumId) ?? [];
      members.push(this.materialAlbumMemberDto(member));
      membersByAlbumId.set(albumId, members);
    }
    return rows.map((row) => {
      const albumId = text(row.id);
      return this.userAlbumDtoFromParts(row, parentByAlbumId.get(albumId) ?? null, membersByAlbumId.get(albumId) ?? []);
    });
  }

  private userAlbumDto(row: JsonMap): MaterialAlbumDto {
    const albumId = text(row.id);
    const parent = this.db
      .prepare(
        `SELECT album_id FROM album_members
      WHERE target_type = 'ALBUM' AND target_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, id LIMIT 1`,
      )
      .get(albumId) as JsonMap | undefined;
    const members = (
      this.db
        .prepare(
          `SELECT member.*, material.kind AS material_kind,
        material.text_content AS material_text,
        asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
        asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
        asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at
      FROM album_members member
      JOIN materials material ON material.id = member.target_id AND material.deleted_at IS NULL
      LEFT JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
      WHERE member.album_id = ? AND member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
        AND (material.kind = 'TEXT' OR asset.id IS NOT NULL)
      ORDER BY member.sort_order, member.id`,
        )
        .all(albumId) as JsonMap[]
    ).map((member) => this.materialAlbumMemberDto(member));
    return this.userAlbumDtoFromParts(row, parent ? text(parent.album_id) : null, members);
  }

  private materialAlbumMemberDto(member: JsonMap): MaterialAlbumMemberDto {
    const kind = text(member.material_kind) as MaterialAlbumMemberDto['kind'];
    return {
      id: text(member.id),
      albumId: text(member.album_id),
      materialId: text(member.target_id),
      kind,
      imageAsset: kind === 'IMAGE' ? assetDto(member, 'asset_') : null,
      text: kind === 'TEXT' ? text(member.material_text) : null,
      sortOrder: Number(member.sort_order),
      createdAt: text(member.created_at),
      updatedAt: text(member.updated_at),
    };
  }

  private userAlbumDtoFromParts(
    row: JsonMap,
    parentId: string | null,
    members: MaterialAlbumMemberDto[],
  ): MaterialAlbumDto {
    const albumId = text(row.id);
    return {
      id: albumId,
      kind: 'USER',
      systemKey: null,
      sourceAlbumId: null,
      sourceSeriesId: null,
      title: text(row.title),
      materialCount: members.length,
      previewAssets: members.flatMap((member) => (member.imageAsset ? [member.imageAsset] : [])).slice(0, 4),
      readOnly: false,
      parentId,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      members,
    };
  }

  private assertAssetsMatchSource(
    imageAssetIds: readonly string[],
    filter: { predicate: string; parameters: readonly string[] },
  ) {
    const matched = new Set<string>();
    for (const batch of batches(imageAssetIds)) {
      const rows = this.db
        .prepare(
          `SELECT asset.id FROM image_assets asset
          WHERE asset.id IN (${placeholders(batch.length)})
            AND asset.deleted_at IS NULL AND ${filter.predicate}`,
        )
        .all(...batch, ...filter.parameters) as JsonMap[];
      for (const row of rows) matched.add(text(row.id));
    }
    if (matched.size !== imageAssetIds.length) {
      throw new Error('Material collection snapshot contains an asset outside its source');
    }
  }

  private resolveCollectionSource(input: CreateMaterialCollectionFromSourceInput) {
    if (input.source.kind === 'MATERIAL_VIEW') {
      const viewId = input.source.viewId;
      if (viewId === MATERIAL_ALBUM_CREATION_ROOT_ID) {
        return { title: input.locale === 'zh' ? '创作' : 'Creation', filter: materialAlbumAssetFilter(viewId) };
      }
      if (viewId === MATERIAL_ALBUM_DICTIONARY_ID) {
        return { title: input.locale === 'zh' ? '词典' : 'Dictionary', filter: materialAlbumAssetFilter(viewId) };
      }
      if (viewId === MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID) {
        return { title: input.locale === 'zh' ? '未分类' : 'Uncategorized', filter: materialAlbumAssetFilter(viewId) };
      }
      const domainId = materialAlbumDictionaryDomainSourceId(viewId);
      if (domainId) {
        const nameColumn = input.locale === 'zh' ? 'name_zh' : 'name_en';
        const domain = this.db
          .prepare(
            `SELECT value.${nameColumn} AS title FROM facet_values value
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE value.id = ? AND definition.system_role = 'PRIMARY_CLASSIFICATION'`,
          )
          .get(domainId) as JsonMap | undefined;
        if (!domain) throw new Error('Material view not found');
        return { title: text(domain.title), filter: materialAlbumAssetFilter(viewId) };
      }
      const sourceAlbumId = materialAlbumCreationGroupSourceId(viewId);
      if (sourceAlbumId) {
        const sourceAlbum = this.db
          .prepare('SELECT title FROM albums WHERE id = ? AND deleted_at IS NULL')
          .get(sourceAlbumId) as JsonMap | undefined;
        if (!sourceAlbum) throw new Error('Material view not found');
        return { title: text(sourceAlbum.title), filter: materialAlbumAssetFilter(viewId) };
      }
      throw new Error('Material view not found');
    }
    if (input.source.kind === 'CREATION_GROUP') {
      const creationGroup = this.db
        .prepare(
          `SELECT id, title FROM albums
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .get(input.source.creationGroupId) as JsonMap | undefined;
      if (!creationGroup) throw new Error('Creation group not found');
      const viewId = materialAlbumCreationGroupId(text(creationGroup.id));
      return { title: text(creationGroup.title), filter: materialAlbumAssetFilter(viewId) };
    }
    const series = this.db
      .prepare(
        `SELECT id, title, title_zh, title_en FROM prompt_series
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(input.source.seriesId) as JsonMap | undefined;
    if (!series) throw new Error('Prompt series not found');
    const title = text(series.title);
    return {
      title,
      filter: {
        predicate: promptSeriesAssetPredicate,
        parameters: [text(series.id)],
      },
    };
  }

  private getCreationGroupDto(creationGroupId: string): CreationGroupDto {
    const group = this.db
      .prepare(
        `SELECT id, title FROM albums
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(creationGroupId) as JsonMap | undefined;
    if (!group) throw new Error('Creation group not found');
    const items = (
      this.db
        .prepare(
          `SELECT item.* FROM album_members item
      WHERE item.album_id = ? AND item.deleted_at IS NULL AND (
        (item.target_type = 'SERIES' AND EXISTS (
          SELECT 1 FROM prompt_series series
          WHERE series.id = item.target_id AND series.deleted_at IS NULL
        )) OR
        (item.target_type = 'ALBUM' AND EXISTS (
          SELECT 1 FROM albums child
          WHERE child.id = item.target_id AND child.deleted_at IS NULL
        ))
      )
      ORDER BY item.sort_order, item.id`,
        )
        .all(creationGroupId) as JsonMap[]
    ).map((item) => ({
      id: text(item.id),
      targetType: text(item.target_type) === 'ALBUM' ? ('ALBUM' as const) : ('PROMPT_SERIES' as const),
      targetId: text(item.target_id),
    }));
    return { id: text(group.id), title: text(group.title), items };
  }

  private assertMutableAlbum(albumId: string) {
    if (isSystemMaterialAlbumId(albumId)) throw new Error('System material albums are read-only');
    if (
      !this.db
        .prepare('SELECT 1 FROM albums WHERE id = ? AND deleted_at IS NULL AND intent = ?')
        .get(albumId, MATERIAL_LIBRARY_ALBUM_INTENT)
    ) {
      throw new Error('Material album not found');
    }
  }

  private attachChildAlbum(parentAlbumId: string, childAlbumId: string, timestamp: string) {
    const nextOrder = Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
          FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
          )
          .get(parentAlbumId) as JsonMap
      ).next_order,
    );
    const memberId = ulid();
    this.db
      .prepare(
        `INSERT INTO album_members
        (id, album_id, target_type, target_id, sort_order, created_at, updated_at)
        VALUES (?, ?, 'ALBUM', ?, ?, ?, ?)`,
      )
      .run(memberId, parentAlbumId, childAlbumId, nextOrder, timestamp, timestamp);
    this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(timestamp, parentAlbumId);
    this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
      albumId: parentAlbumId,
      targetType: 'ALBUM',
      targetId: childAlbumId,
    });
  }

  private requireMaterials(materialIds: readonly string[]) {
    const found = new Set<string>();
    for (const batch of batches(materialIds)) {
      const rows = this.db
        .prepare(
          `SELECT material.id FROM materials material
          LEFT JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
          WHERE material.id IN (${placeholders(batch.length)}) AND material.deleted_at IS NULL
            AND (material.kind = 'TEXT' OR (material.kind = 'IMAGE' AND asset.id IS NOT NULL))`,
        )
        .all(...batch) as JsonMap[];
      for (const row of rows) found.add(text(row.id));
    }
    if (found.size !== materialIds.length) throw new Error('Material not found');
  }
}
