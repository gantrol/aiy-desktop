import type {
  AssetDto,
  CreationAlbumDto,
  Locale,
  MaterialAlbumDto,
  MaterialAlbumListInput,
  MaterialAlbumMemberDto,
  MaterialAlbumSystemKey,
} from '@/shared/contracts';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import { AlbumRepository } from '@/main/database/albums/album-repository';
import { creationSeriesMaterialSummariesSql } from '@/main/database/albums/creation-series-material-summaries-sql';
import {
  MATERIAL_ALBUM_CREATION_ROOT_ID,
  MATERIAL_ALBUM_CREATION_UNASSIGNED_ID,
  MATERIAL_ALBUM_DICTIONARY_ID,
  MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID,
  type SystemAlbumSummary,
  assetDto,
  materialAlbumAssetFilter,
  materialAlbumCreationAlbumId,
  materialAlbumCreationSeriesId,
  materialAlbumDictionaryDomainId,
} from '@/main/database/albums/material-album-scopes';
import type { LibraryStorage } from '@/main/database/core/storage';
import { resolveStoredTitle, titleLocalizationsByOwner } from '@/main/database/core/title-localization';
import { type JsonMap, text } from '@/main/database/core/values';
import { creationItemCoverSortOrder } from '@/main/database/creations/creation-output-presentation-sql';

function creationAlbumItemTargetType(value: unknown): CreationAlbumDto['items'][number]['targetType'] {
  const targetType = text(value);
  if (targetType === 'MATERIAL' || targetType === 'ALBUM' || targetType === 'CREATION_ITEM') {
    return targetType;
  }
  throw new Error('Creation album member is invalid');
}

export class MaterialAlbumReader {
  protected readonly db: LibraryStorage['db'];
  protected readonly albums: AlbumRepository;

  constructor(protected readonly storage: LibraryStorage) {
    this.db = storage.db;
    this.albums = new AlbumRepository(storage);
  }

  list(input: MaterialAlbumListInput = { locale: 'zh' }): MaterialAlbumDto[] {
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
    const creationAlbumRows = this.db
      .prepare(
        `WITH RECURSIVE unavailable_album(id) AS (
          SELECT id FROM albums WHERE deleted_at IS NOT NULL
          UNION
          SELECT member.target_id
          FROM unavailable_album unavailable
          JOIN album_members member ON member.album_id = unavailable.id
            AND member.target_type = 'ALBUM' AND member.deleted_at IS NULL
        )
        SELECT album.id, album.title, album.title_locale, album.created_at, parent.album_id AS parent_album_id
        FROM albums album
        LEFT JOIN album_members parent ON parent.target_type = 'ALBUM'
          AND parent.target_id = album.id AND parent.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM albums parent_album
            WHERE parent_album.id = parent.album_id AND parent_album.deleted_at IS NULL
              AND parent_album.intent <> ?
          )
        WHERE album.deleted_at IS NULL AND album.archived_at IS NULL AND album.intent <> ?
          AND NOT EXISTS (SELECT 1 FROM unavailable_album unavailable WHERE unavailable.id = album.id)
          AND EXISTS (
          SELECT 1 FROM album_members member
          WHERE member.album_id = album.id AND member.deleted_at IS NULL
            AND member.target_type IN ('CREATION_ITEM', 'ALBUM')
        )
        ORDER BY album.pinned DESC, album.created_at, album.id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT, MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const creationAlbumSummaries = this.creationAlbumSummaries();
    const creationAlbumIds = new Set(creationAlbumRows.map((row) => text(row.id)));
    const creationAlbumLocalizations = titleLocalizationsByOwner(this.db, 'ALBUM', [...creationAlbumIds]);
    const creationAlbums = creationAlbumRows.map((row) =>
      this.systemAlbum(
        materialAlbumCreationAlbumId(text(row.id)),
        'CREATION_GROUP',
        resolveStoredTitle(row, input.locale, creationAlbumLocalizations.get(text(row.id)) ?? []),
        row.parent_album_id && creationAlbumIds.has(text(row.parent_album_id))
          ? materialAlbumCreationAlbumId(text(row.parent_album_id))
          : MATERIAL_ALBUM_CREATION_ROOT_ID,
        text(row.id),
        text(row.created_at),
        creationAlbumSummaries.get(text(row.id)) ?? { materialCount: 0, previewAssets: [] },
      ),
    );
    const seriesRows = this.db
      .prepare(
        `SELECT series.id, series.title, series.title_locale, series.created_at,
            member.album_id AS source_album_id, member.sort_order,
            root_order.sort_order AS root_sort_order
          FROM creation_items item
          JOIN creation_forms form ON form.creation_item_id = item.id
            AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
            AND form.deleted_at IS NULL
          JOIN prompt_series series ON series.id = form.entity_id
          LEFT JOIN album_members member ON member.target_type = 'CREATION_ITEM'
            AND member.target_id = item.id AND member.deleted_at IS NULL
            AND EXISTS (
              SELECT 1 FROM albums owner
              WHERE owner.id = member.album_id AND owner.deleted_at IS NULL AND owner.intent <> ?
            )
          LEFT JOIN sidebar_root_order root_order ON root_order.scope = 'CREATOR'
            AND root_order.target_type = 'CREATION_ITEM' AND root_order.target_id = item.id
          WHERE item.deleted_at IS NULL AND item.archived_at IS NULL
            AND series.deleted_at IS NULL AND series.archived_at IS NULL
          ORDER BY member.album_id IS NULL, member.album_id, member.sort_order,
            root_order.sort_order IS NULL, root_order.sort_order, series.created_at, series.id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const seriesLocalizations = titleLocalizationsByOwner(
      this.db,
      'PROMPT_SERIES',
      seriesRows.map((row) => text(row.id)),
    );
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
      const localizedTitle = resolveStoredTitle(row, input.locale, seriesLocalizations.get(seriesId) ?? []);
      return this.systemAlbum(
        materialAlbumCreationSeriesId(seriesId),
        'CREATION_SERIES',
        localizedTitle,
        sourceAlbumId && creationAlbumIds.has(sourceAlbumId)
          ? materialAlbumCreationAlbumId(sourceAlbumId)
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
        `WITH RECURSIVE unavailable_album(id) AS (
          SELECT id FROM albums WHERE deleted_at IS NOT NULL
          UNION
          SELECT member.target_id
          FROM unavailable_album unavailable
          JOIN album_members member ON member.album_id = unavailable.id
            AND member.target_type = 'ALBUM' AND member.deleted_at IS NULL
        )
        SELECT * FROM albums album
        WHERE album.deleted_at IS NULL AND album.archived_at IS NULL AND album.intent = ?
          AND NOT EXISTS (SELECT 1 FROM unavailable_album unavailable WHERE unavailable.id = album.id)
        ORDER BY album.created_at, album.id`,
      )
      .all(MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap[];
    const userAlbums = this.userAlbumDtos(userAlbumRows, input.locale);
    return [root, ...creationAlbums, ...unassigned, ...creationSeries, dictionary, ...dictionaryDomains, ...userAlbums];
  }

  private creationAlbumSummaries() {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE
          album_roots(id) AS (
            SELECT album.id FROM albums album
            WHERE album.deleted_at IS NULL AND album.archived_at IS NULL AND album.intent <> ? AND EXISTS (
              SELECT 1 FROM album_members member
              WHERE member.album_id = album.id AND member.deleted_at IS NULL
                AND member.target_type IN ('CREATION_ITEM', 'ALBUM')
            )
          ),
          descendants(root_id, id) AS (
            SELECT id, id FROM album_roots
            UNION
            SELECT descendants.root_id, child.id
            FROM descendants
            JOIN album_members edge ON edge.album_id = descendants.id
              AND edge.target_type = 'ALBUM' AND edge.deleted_at IS NULL
            JOIN albums child ON child.id = edge.target_id
              AND child.deleted_at IS NULL AND child.archived_at IS NULL
          ),
          album_creation_items(root_id, creation_item_id) AS (
            SELECT DISTINCT descendants.root_id, member.target_id
            FROM descendants
            JOIN album_members member ON member.album_id = descendants.id
              AND member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
            JOIN creation_items item ON item.id = member.target_id
              AND item.deleted_at IS NULL AND item.archived_at IS NULL
          ),
          album_series(root_id, series_id) AS (
            SELECT DISTINCT item.root_id, form.entity_id
            FROM album_creation_items item
            JOIN creation_forms form ON form.creation_item_id = item.creation_item_id
              AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
              AND form.deleted_at IS NULL
            JOIN prompt_series series ON series.id = form.entity_id
              AND series.deleted_at IS NULL AND series.archived_at IS NULL
          ),
          album_relationships(root_id, series_id, asset_id, relationship_role) AS (
            SELECT album_series.root_id, album_series.series_id, run.result_asset_id, 'OUTPUT'
            FROM album_series
            JOIN prompt_versions version ON version.series_id = album_series.series_id
            JOIN generation_runs run ON run.prompt_version_id = version.id
              AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM generation_output_reviews review
                WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
              )
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = album_series.series_id
                  AND exclusion.image_asset_id = run.result_asset_id
              )
            UNION
            SELECT album_series.root_id, album_series.series_id, imported.image_asset_id, 'OUTPUT'
            FROM album_series
            JOIN creation_output_imports imported ON imported.series_id = album_series.series_id
              AND imported.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = album_series.series_id
                  AND exclusion.image_asset_id = imported.image_asset_id
              )
            UNION
            SELECT album_series.root_id, album_series.series_id, transform.output_asset_id, 'OUTPUT'
            FROM album_series
            JOIN image_transform_runs transform ON transform.series_id = album_series.series_id
              AND transform.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = album_series.series_id
                  AND exclusion.image_asset_id = transform.output_asset_id
              )
            UNION
            SELECT album_series.root_id, album_series.series_id, binding.image_asset_id, 'INPUT'
            FROM album_series
            JOIN prompt_series series ON series.id = album_series.series_id
            JOIN reference_bindings binding ON binding.prompt_version_id = series.current_version_id
              AND binding.source_type = 'DIRECT'
            UNION
            SELECT album_series.root_id, album_series.series_id, version.source_image_id, 'INPUT'
            FROM album_series
            JOIN prompt_series series ON series.id = album_series.series_id
            JOIN prompt_versions version ON version.id = series.current_version_id
            WHERE version.source_image_id IS NOT NULL
          ), album_assets(root_id, series_id, asset_id) AS (
            SELECT DISTINCT relationship.root_id, relationship.series_id, relationship.asset_id
            FROM album_relationships relationship
            WHERE relationship.relationship_role = 'OUTPUT' OR EXISTS (
              SELECT 1 FROM materials material
              WHERE material.image_asset_id = relationship.asset_id AND material.kind = 'IMAGE'
                AND material.deleted_at IS NULL AND material.archived_at IS NULL
            )
          ), album_content_assets(root_id, content_id, asset_id, content_preview_rank, activity_at) AS (
            SELECT item.root_id, 'INSPIRATION_STASH:' || inspiration.id,
              reference.value, CAST(reference.key AS INTEGER) + 1, inspiration.updated_at
            FROM album_creation_items item
            JOIN creation_forms form ON form.creation_item_id = item.creation_item_id
              AND form.role = 'INSPIRATION' AND form.entity_type = 'INSPIRATION_STASH'
              AND form.deleted_at IS NULL
            JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id
              AND inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
            JOIN json_each(inspiration.input_json, '$.referenceAssetIds') reference
            WHERE EXISTS (
              SELECT 1 FROM materials material
              WHERE material.image_asset_id = reference.value AND material.kind = 'IMAGE'
                AND material.deleted_at IS NULL AND material.archived_at IS NULL
            )
            UNION ALL
            SELECT item.root_id, 'SOCIAL_POST:' || post.id, media.value,
              CASE
                WHEN media.value = json_extract(revision.content_json, '$.coverAssetId') THEN 0
                ELSE CAST(media.key AS INTEGER) + 1
              END,
              post.updated_at
            FROM album_creation_items item
            JOIN creation_forms form ON form.creation_item_id = item.creation_item_id
              AND form.role = 'SOCIAL_POST' AND form.entity_type = 'SOCIAL_POST'
              AND form.deleted_at IS NULL
            JOIN social_post_drafts post ON post.id = form.entity_id
              AND post.status = 'ACTIVE' AND post.deleted_at IS NULL
            JOIN social_post_revisions revision ON revision.id = post.current_revision_id
            JOIN json_each(revision.content_json, '$.mediaAssetIds') media
            UNION ALL
            SELECT item.root_id, 'ARTICLE:' || article.id,
              json_extract(binding.value, '$.assetId'),
              CASE
                WHEN json_extract(binding.value, '$.assetId') = json_extract(revision.content_json, '$.coverAssetId')
                  THEN 0
                ELSE CAST(binding.key AS INTEGER) + 1
              END,
              article.updated_at
            FROM album_creation_items item
            JOIN creation_forms form ON form.creation_item_id = item.creation_item_id
              AND form.role = 'ARTICLE' AND form.entity_type = 'ARTICLE'
              AND form.deleted_at IS NULL
            JOIN articles article ON article.id = form.entity_id
              AND article.status = 'ACTIVE' AND article.deleted_at IS NULL
            JOIN article_revisions revision ON revision.id = article.current_revision_id
            JOIN json_each(revision.content_json, '$.mediaBindings') binding
          ),
          ranked_per_creation AS (
            SELECT album_assets.root_id, album_assets.series_id, asset.*,
              row_number() OVER (
                PARTITION BY album_assets.root_id, album_assets.series_id
                ORDER BY COALESCE(
                    ${creationItemCoverSortOrder('album_assets.series_id', 'asset.id')},
                    2147483647
                  ),
                  asset.created_at DESC, asset.id DESC
              ) AS creation_preview_rank
            FROM album_assets
            JOIN prompt_series series ON series.id = album_assets.series_id
            JOIN image_assets asset ON asset.id = album_assets.asset_id AND asset.deleted_at IS NULL
          ), ranked_assets AS (
            SELECT root_id, id, MIN(creation_preview_rank) AS creation_preview_rank, MAX(activity_at) AS activity_at
            FROM (
              SELECT root_id, id, creation_preview_rank, created_at AS activity_at
              FROM ranked_per_creation
              UNION ALL
              SELECT content.root_id, asset.id, content.content_preview_rank, content.activity_at
              FROM album_content_assets content
              JOIN image_assets asset ON asset.id = content.asset_id AND asset.deleted_at IS NULL
            ) candidates
            GROUP BY root_id, id
          ), ranked AS (
            SELECT ranked_assets.root_id, asset.*,
              count(*) OVER (PARTITION BY ranked_assets.root_id) AS material_count,
              row_number() OVER (
                PARTITION BY ranked_assets.root_id
                ORDER BY ranked_assets.creation_preview_rank,
                  ranked_assets.activity_at DESC, ranked_assets.id DESC
              ) AS preview_rank
            FROM ranked_assets
            JOIN image_assets asset ON asset.id = ranked_assets.id AND asset.deleted_at IS NULL
          )
          SELECT * FROM ranked WHERE preview_rank <= 5
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

  private creationSeriesSummaries() {
    const rows = this.db.prepare(creationSeriesMaterialSummariesSql).all() as JsonMap[];
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

  protected getUserAlbumDto(albumId: string, locale: Locale = 'zh'): MaterialAlbumDto {
    const row = this.db
      .prepare(
        `SELECT * FROM albums
        WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL AND intent = ?`,
      )
      .get(albumId, MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap | undefined;
    if (!row) throw new Error('Material album not found');
    return this.userAlbumDto(row, locale);
  }

  private userAlbumDtos(rows: JsonMap[], locale: Locale): MaterialAlbumDto[] {
    if (!rows.length) return [];
    const parentRows = this.db
      .prepare(
        `SELECT edge.target_id AS child_id, edge.album_id AS parent_id
          FROM album_members edge
          JOIN albums child ON child.id = edge.target_id
            AND child.deleted_at IS NULL AND child.archived_at IS NULL AND child.intent = ?
          JOIN albums parent ON parent.id = edge.album_id
            AND parent.deleted_at IS NULL AND parent.archived_at IS NULL
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
            AND owner.deleted_at IS NULL AND owner.archived_at IS NULL AND owner.intent = ?
          JOIN materials material ON material.id = member.target_id
            AND material.deleted_at IS NULL AND material.archived_at IS NULL
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
    const localizations = titleLocalizationsByOwner(
      this.db,
      'ALBUM',
      rows.map((row) => text(row.id)),
    );
    return rows.map((row) => {
      const albumId = text(row.id);
      return this.userAlbumDtoFromParts(
        row,
        parentByAlbumId.get(albumId) ?? null,
        membersByAlbumId.get(albumId) ?? [],
        locale,
        localizations.get(albumId) ?? [],
      );
    });
  }

  private userAlbumDto(row: JsonMap, locale: Locale): MaterialAlbumDto {
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
        JOIN materials material ON material.id = member.target_id
          AND material.deleted_at IS NULL AND material.archived_at IS NULL
        LEFT JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
        WHERE member.album_id = ? AND member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
          AND (material.kind = 'TEXT' OR asset.id IS NOT NULL)
        ORDER BY member.sort_order, member.id`,
        )
        .all(albumId) as JsonMap[]
    ).map((member) => this.materialAlbumMemberDto(member));
    const albumIdLocalizations = titleLocalizationsByOwner(this.db, 'ALBUM', [albumId]).get(albumId) ?? [];
    return this.userAlbumDtoFromParts(
      row,
      parent ? text(parent.album_id) : null,
      members,
      locale,
      albumIdLocalizations,
    );
  }

  private materialAlbumMemberDto(member: JsonMap): MaterialAlbumMemberDto {
    const kind = text(member.material_kind) as MaterialAlbumMemberDto['kind'];
    return {
      id: text(member.id),
      albumId: text(member.album_id),
      materialId: text(member.target_id),
      kind,
      imageAsset: kind !== 'TEXT' ? assetDto(member, 'asset_') : null,
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
    locale: Locale,
    localizations: Array<{ locale: string; title: string }>,
  ): MaterialAlbumDto {
    const albumId = text(row.id);
    return {
      id: albumId,
      kind: 'USER',
      systemKey: null,
      sourceAlbumId: null,
      sourceSeriesId: null,
      title: resolveStoredTitle(row, locale, localizations),
      materialCount: members.length,
      previewAssets: members.flatMap((member) => (member.imageAsset ? [member.imageAsset] : [])).slice(0, 4),
      readOnly: false,
      parentId,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      members,
    };
  }

  protected getCreationAlbumDto(creationAlbumId: string, locale: Locale = 'zh'): CreationAlbumDto {
    const album = this.db
      .prepare(
        `SELECT id, title, title_locale FROM albums
        WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
      )
      .get(creationAlbumId) as JsonMap | undefined;
    if (!album) throw new Error('Creation album not found');
    const items = (
      this.db
        .prepare(
          `SELECT item.* FROM album_members item
        WHERE item.album_id = ? AND item.deleted_at IS NULL AND (
          (item.target_type = 'MATERIAL' AND EXISTS (
            SELECT 1 FROM materials material
            WHERE material.id = item.target_id
              AND material.deleted_at IS NULL AND material.archived_at IS NULL
          )) OR
          (item.target_type = 'ALBUM' AND EXISTS (
            SELECT 1 FROM albums child
            WHERE child.id = item.target_id AND child.deleted_at IS NULL AND child.archived_at IS NULL
          )) OR
          (item.target_type = 'CREATION_ITEM' AND EXISTS (
            SELECT 1 FROM creation_items creation_item
            WHERE creation_item.id = item.target_id
              AND creation_item.archived_at IS NULL AND creation_item.deleted_at IS NULL
          ))
        )
        ORDER BY item.sort_order, item.id`,
        )
        .all(creationAlbumId) as JsonMap[]
    ).map((item) => {
      return {
        id: text(item.id),
        targetType: creationAlbumItemTargetType(item.target_type),
        targetId: text(item.target_id),
      };
    });
    const localizations = titleLocalizationsByOwner(this.db, 'ALBUM', [creationAlbumId]).get(creationAlbumId) ?? [];
    return { id: text(album.id), title: resolveStoredTitle(album, locale, localizations), items };
  }
}
