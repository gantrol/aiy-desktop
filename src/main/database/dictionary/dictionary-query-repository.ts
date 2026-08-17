import type {
  AssetDto,
  DictionaryPageDto,
  DictionaryPageInput,
  DictionaryScopeContentsDto,
  DictionaryScopeResolveInput,
  DictionarySearchInput,
  Locale,
  TermCategoryDto,
  TermListItem,
  TermMediaItemDto,
  TermMediaPreviewDto,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';

const emptyMediaPreview = (): TermMediaPreviewDto => ({ totalCount: 0, items: [] });

type DictionaryFilters = Pick<DictionarySearchInput, 'excludeDrafts' | 'excludeUncited'> &
  Partial<
    Pick<
      DictionarySearchInput,
      | 'includeArchived'
      | 'termIds'
      | 'missingFacetSystemRoles'
      | 'classificationIds'
      | 'missingClassification'
      | 'packReleaseIds'
      | 'includeLocalTerms'
    >
  >;

interface TermRowDetails {
  aliasRows: JsonMap[];
  localizationRows: JsonMap[];
  expressionRows: JsonMap[];
  categories: JsonMap[];
  primaryDirectoryClassificationId: string | null;
  evidence: JsonMap;
  promptCount: JsonMap;
  pending: JsonMap;
}

export class DictionaryQueryRepository {
  constructor(protected readonly storage: LibraryStorage) {}

  protected get db() {
    return this.storage.db;
  }

  searchTerms(locale: Locale, query = '', facetValueIds: string[] = [], filters?: DictionaryFilters): TermListItem[] {
    const effectiveFilters = filters ?? {
      excludeDrafts: false,
      excludeUncited: false,
      includeArchived: false,
      termIds: [],
    };
    const { whereSql, params } = this.termSearchWhere(query, facetValueIds, effectiveFilters);
    const rows = this.db
      .prepare(
        `SELECT t.*, r.*,
        EXISTS(SELECT 1 FROM drafts d WHERE d.entity_type = 'TERM' AND d.entity_id = t.id) AS has_draft
        FROM terms t JOIN term_revisions r ON r.id = t.current_revision_id
        WHERE ${whereSql}
        ORDER BY EXISTS(
          SELECT 1 FROM term_media_links media
          WHERE media.term_id = t.id AND media.deleted_at IS NULL
        ) DESC, r.title COLLATE NOCASE, t.id`,
      )
      .all(...params) as JsonMap[];
    return this.mapTermRows(rows, locale);
  }

  searchTermsPage(input: DictionaryPageInput): DictionaryPageDto {
    const { whereSql, params } = this.termSearchWhere(input.query, input.facetValueIds, input);
    const totalRow = this.db
      .prepare(
        `SELECT count(*) AS total
        FROM terms t JOIN term_revisions r ON r.id = t.current_revision_id
        WHERE ${whereSql}`,
      )
      .get(...params) as JsonMap;
    const priorityOrder = input.prioritizeTermId ? 'CASE WHEN t.id = ? THEN 0 ELSE 1 END,' : '';
    const rows = this.db
      .prepare(
        `SELECT t.*, r.*,
        EXISTS(SELECT 1 FROM drafts d WHERE d.entity_type = 'TERM' AND d.entity_id = t.id) AS has_draft
        FROM terms t JOIN term_revisions r ON r.id = t.current_revision_id
        WHERE ${whereSql}
        ORDER BY ${priorityOrder} EXISTS(
          SELECT 1 FROM term_media_links media
          WHERE media.term_id = t.id AND media.deleted_at IS NULL
        ) DESC, r.title COLLATE NOCASE, t.id
        LIMIT ? OFFSET ?`,
      )
      .all(
        ...params,
        ...(input.prioritizeTermId ? [input.prioritizeTermId] : []),
        input.limit,
        input.offset,
      ) as JsonMap[];
    const total = Number(totalRow.total);
    const items = this.mapTermRows(rows, input.locale);
    return {
      items,
      total,
      offset: input.offset,
      limit: input.limit,
      hasMore: input.offset + items.length < total,
    };
  }

  resolveScope(input: DictionaryScopeResolveInput): DictionaryScopeContentsDto {
    const releaseIds = [...new Set(input.packReleaseIds)];
    const selectedMatch = releaseIds.length
      ? `EXISTS (SELECT 1 FROM pack_release_items selected_item
            JOIN pack_object_links selected_link
              ON selected_link.release_item_id = selected_item.id
             AND selected_link.deleted_at IS NULL
            WHERE selected_item.object_type = 'RECIPE_REVISION'
              AND selected_item.release_id IN (${releaseIds.map(() => '?').join(',')})
              AND selected_link.local_object_type = 'RECIPE'
              AND selected_link.local_object_id = palette.id
              AND selected_link.local_revision_id = palette.current_revision_id)`
      : '0 = 1';
    const localMatch = `NOT EXISTS (SELECT 1 FROM pack_release_items packaged_item
        JOIN pack_object_links packaged_link
          ON packaged_link.release_item_id = packaged_item.id
         AND packaged_link.deleted_at IS NULL
        WHERE packaged_item.object_type = 'RECIPE_REVISION'
          AND packaged_link.local_object_type = 'RECIPE'
          AND packaged_link.local_object_id = palette.id
          AND packaged_link.local_revision_id = palette.current_revision_id)`;
    const rows = this.db
      .prepare(
        `SELECT palette.current_revision_id FROM word_palettes palette
        WHERE palette.deleted_at IS NULL AND palette.archived_at IS NULL
          AND (${selectedMatch}${input.includeLocalTerms ? ` OR ${localMatch}` : ''})
        ORDER BY palette.id`,
      )
      .all(...releaseIds) as JsonMap[];
    return { paletteRevisionIds: rows.map((row) => text(row.current_revision_id)) };
  }

  private termSearchWhere(query: string, facetValueIds: string[], filters: DictionaryFilters) {
    const params: unknown[] = [];
    const where = filters.includeArchived ? ['1 = 1'] : ['t.archived_at IS NULL'];
    if (filters.excludeDrafts) where.push("t.editorial_state <> 'DRAFT'");
    if (filters.excludeUncited)
      where.push('EXISTS (SELECT 1 FROM prompt_term_bindings cited WHERE cited.term_id = t.id)');
    const termIds = filters.termIds ?? [];
    if (termIds.length) {
      where.push(`t.id IN (${termIds.map(() => '?').join(',')})`);
      params.push(...termIds);
    }
    if (filters.packReleaseIds !== undefined) {
      const releaseIds = [...new Set(filters.packReleaseIds)];
      const selectedMatch = releaseIds.length
        ? `EXISTS (SELECT 1 FROM pack_release_items selected_item
              JOIN pack_object_links selected_link
                ON selected_link.release_item_id = selected_item.id
               AND selected_link.deleted_at IS NULL
              WHERE selected_item.object_type = 'TERM_REVISION'
                AND selected_item.release_id IN (${releaseIds.map(() => '?').join(',')})
                AND selected_link.local_object_type = 'TERM'
                AND selected_link.local_object_id = t.id
                AND selected_link.local_revision_id = r.id)`
        : '0 = 1';
      const localMatch = `NOT EXISTS (SELECT 1 FROM pack_release_items packaged_item
          JOIN pack_object_links packaged_link
            ON packaged_link.release_item_id = packaged_item.id
           AND packaged_link.deleted_at IS NULL
          WHERE packaged_item.object_type = 'TERM_REVISION'
            AND packaged_link.local_object_type = 'TERM'
            AND packaged_link.local_object_id = t.id
            AND packaged_link.local_revision_id = r.id)`;
      where.push(`(${selectedMatch}${filters.includeLocalTerms ? ` OR ${localMatch}` : ''})`);
      params.push(...releaseIds);
    }
    if (query.trim()) {
      // Literal substring matching works for every content locale, including
      // scripts without whitespace.
      const like = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
      where.push(`(r.title LIKE ? ESCAPE '\\' OR r.definition LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM term_localizations ql WHERE ql.term_revision_id = r.id
            AND (ql.title LIKE ? ESCAPE '\\' OR ql.definition LIKE ? ESCAPE '\\'))
          OR EXISTS (SELECT 1 FROM term_aliases qa WHERE qa.term_revision_id = r.id AND qa.value LIKE ? ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM term_expressions qe WHERE qe.term_revision_id = r.id
            AND (qe.positive_expression LIKE ? ESCAPE '\\' OR qe.negative_expression LIKE ? ESCAPE '\\')))`);
      params.push(like, like, like, like, like, like, like);
    }
    const selectedRows = facetValueIds.length
      ? (this.db
          .prepare(
            `SELECT value.id, value.definition_id, definition.system_role
              FROM facet_values value
              JOIN facet_definitions definition ON definition.id = value.definition_id
              WHERE value.id IN (${facetValueIds.map(() => '?').join(',')})`,
          )
          .all(...facetValueIds) as JsonMap[])
      : [];
    const byDefinition = new Map<string, { ids: string[]; systemRole: string }>();
    for (const row of selectedRows) {
      const group = byDefinition.get(text(row.definition_id)) ?? { ids: [], systemRole: text(row.system_role) };
      group.ids.push(text(row.id));
      byDefinition.set(text(row.definition_id), group);
    }
    for (const group of byDefinition.values()) {
      if (group.systemRole === 'PRIMARY_CLASSIFICATION') {
        where.push(
          `EXISTS (SELECT 1 FROM term_revision_categories selected_membership
            JOIN term_categories selected_category ON selected_category.id = selected_membership.category_id
            WHERE selected_membership.term_revision_id = r.id
              AND selected_category.primary_facet_value_id IN (${group.ids.map(() => '?').join(',')}))`,
        );
      } else if (group.systemRole === 'SECONDARY_CLASSIFICATION') {
        where.push(
          `EXISTS (SELECT 1 FROM term_revision_categories selected_membership
            JOIN term_categories selected_category ON selected_category.id = selected_membership.category_id
            WHERE selected_membership.term_revision_id = r.id
              AND selected_category.secondary_facet_value_id IN (${group.ids.map(() => '?').join(',')}))`,
        );
      } else {
        where.push(
          `EXISTS (SELECT 1 FROM term_facet_assignments fa
            WHERE fa.term_revision_id = r.id
              AND fa.facet_value_id IN (${group.ids.map(() => '?').join(',')}))`,
        );
      }
      params.push(...group.ids);
    }
    for (const systemRole of filters.missingFacetSystemRoles ?? []) {
      if (systemRole === 'PRIMARY_CLASSIFICATION') {
        where.push(
          'NOT EXISTS (SELECT 1 FROM term_revision_categories missing_membership WHERE missing_membership.term_revision_id = r.id)',
        );
      } else {
        where.push(`NOT EXISTS (
            SELECT 1 FROM term_revision_categories selected_membership
            JOIN term_categories selected_category ON selected_category.id = selected_membership.category_id
            WHERE selected_membership.term_revision_id = r.id
              AND selected_category.secondary_facet_value_id IS NOT NULL
          )`);
      }
    }
    const classificationIds = [...new Set(filters.classificationIds ?? [])];
    if (classificationIds.length) {
      where.push(`EXISTS (
          WITH RECURSIVE selected_categories(id) AS (
            SELECT id FROM term_categories
            WHERE id IN (${classificationIds.map(() => '?').join(',')})
            UNION
            SELECT child.id FROM term_categories child
            JOIN selected_categories parent ON child.parent_id = parent.id
          )
          SELECT 1 FROM term_revision_categories membership
          JOIN selected_categories selected ON selected.id = membership.category_id
          WHERE membership.term_revision_id = r.id
        )`);
      params.push(...classificationIds);
    }
    if (filters.missingClassification) {
      where.push(
        'NOT EXISTS (SELECT 1 FROM term_revision_categories classification_membership WHERE classification_membership.term_revision_id = r.id)',
      );
    }
    return { whereSql: where.join(' AND '), params };
  }

  private mapTermRows(rows: JsonMap[], locale: Locale): TermListItem[] {
    const mediaByTerm = this.activeMediaByTerm(rows.map((row) => text(row.term_id)));
    const detailsByRevision = this.loadTermRowDetails(rows, locale);
    return rows.map((row) => {
      const media = mediaByTerm.get(text(row.term_id)) ?? [];
      const details = detailsByRevision.get(text(row.id));
      if (!details) throw new Error(`Term projection details are missing: ${text(row.term_id)}`);
      return this.termRow(row, locale, details, { totalCount: media.length, items: media.slice(0, 3) });
    });
  }

  protected loadTermRowDetails(rows: JsonMap[], locale: Locale): Map<string, TermRowDetails> {
    if (!rows.length) return new Map();
    const revisionIds = rows.map((row) => text(row.id));
    const termIds = rows.map((row) => text(row.term_id));
    const revisionPlaceholders = revisionIds.map(() => '?').join(',');
    const termPlaceholders = termIds.map(() => '?').join(',');
    const detailsByRevision = new Map<string, TermRowDetails>(
      rows.map((row) => [
        text(row.id),
        {
          aliasRows: [],
          localizationRows: [],
          expressionRows: [],
          categories: [],
          primaryDirectoryClassificationId: null,
          evidence: {},
          promptCount: {},
          pending: {},
        },
      ]),
    );
    const revisionByTerm = new Map(rows.map((row) => [text(row.term_id), text(row.id)]));

    const aliasRows = this.db
      .prepare(
        `SELECT term_revision_id, locale, value FROM term_aliases
        WHERE term_revision_id IN (${revisionPlaceholders})
        ORDER BY term_revision_id, value`,
      )
      .all(...revisionIds) as JsonMap[];
    for (const alias of aliasRows) {
      detailsByRevision.get(text(alias.term_revision_id))?.aliasRows.push(alias);
    }

    const localizationRows = this.db
      .prepare(
        `SELECT term_revision_id, locale, title, definition FROM term_localizations
        WHERE term_revision_id IN (${revisionPlaceholders})
        ORDER BY term_revision_id, locale`,
      )
      .all(...revisionIds) as JsonMap[];
    for (const localization of localizationRows) {
      detailsByRevision.get(text(localization.term_revision_id))?.localizationRows.push(localization);
    }

    const expressionRows = this.db
      .prepare(
        `SELECT expression.*, profile.stable_key AS context_key
        FROM term_expressions expression
        JOIN term_context_profile_revisions profile_revision
          ON profile_revision.id = expression.context_profile_revision_id
        JOIN term_context_profiles profile ON profile.id = profile_revision.context_profile_id
        WHERE expression.term_revision_id IN (${revisionPlaceholders})
        ORDER BY expression.term_revision_id, profile.stable_key, expression.model_key, expression.locale, expression.id`,
      )
      .all(...revisionIds) as JsonMap[];
    for (const expression of expressionRows) {
      detailsByRevision.get(text(expression.term_revision_id))?.expressionRows.push(expression);
    }

    const categoryRows = this.db
      .prepare(
        `WITH RECURSIVE category_paths AS (
            SELECT category.id, category.parent_id,
              COALESCE(
                (SELECT localization.name FROM term_category_localizations localization
                 WHERE localization.category_id = category.id AND localization.locale = ? LIMIT 1),
                CASE WHEN category.name_locale = ? THEN category.name END,
                category.name
              ) AS path,
              CASE WHEN category.state = 'ACTIVE' THEN 1 ELSE 0 END AS selectable
            FROM term_categories category
            WHERE category.parent_id IS NULL
            UNION ALL
            SELECT child.id, child.parent_id,
              parent.path || ' / ' || COALESCE(
                (SELECT localization.name FROM term_category_localizations localization
                 WHERE localization.category_id = child.id AND localization.locale = ? LIMIT 1),
                CASE WHEN child.name_locale = ? THEN child.name END,
                child.name
              ),
              CASE WHEN parent.selectable = 1 AND child.state = 'ACTIVE' THEN 1 ELSE 0 END
            FROM term_categories child
            JOIN category_paths parent ON parent.id = child.parent_id
          )
          SELECT revision.id AS term_revision_id, category.id, category.stable_key,
          category.parent_id, category.state, category_paths.path,
          category_paths.selectable,
          primary_value.id AS primary_value_id,
          primary_value.name_zh AS primary_name_zh,
          primary_value.name_en AS primary_name_en,
          secondary_value.id AS secondary_value_id,
          secondary_value.name_zh AS secondary_name_zh,
          secondary_value.name_en AS secondary_name_en
          FROM term_revisions revision
          JOIN term_revision_categories membership ON membership.term_revision_id = revision.id
          JOIN term_categories category ON category.id = membership.category_id
          JOIN category_paths ON category_paths.id = category.id
          JOIN facet_values primary_value ON primary_value.id = category.primary_facet_value_id
          LEFT JOIN facet_values secondary_value ON secondary_value.id = category.secondary_facet_value_id
          WHERE revision.id IN (${revisionPlaceholders})
          ORDER BY revision.id, membership.sort_order, category.id`,
      )
      .all(locale, locale, locale, locale, ...revisionIds) as JsonMap[];
    for (const category of categoryRows) {
      detailsByRevision.get(text(category.term_revision_id))!.categories.push(category);
    }

    const placementRows = this.db
      .prepare(
        `SELECT term_id, primary_category_id
          FROM term_directory_placements
          WHERE term_id IN (${termPlaceholders})`,
      )
      .all(...termIds) as JsonMap[];
    for (const placement of placementRows) {
      const revisionId = revisionByTerm.get(text(placement.term_id));
      if (revisionId) {
        detailsByRevision.get(revisionId)!.primaryDirectoryClassificationId = placement.primary_category_id
          ? text(placement.primary_category_id)
          : null;
      }
    }

    const evidenceRows = this.db
      .prepare(
        `SELECT term_id,
        SUM(CASE WHEN verdict = 'POSITIVE' THEN 1 ELSE 0 END) positive,
        SUM(CASE WHEN verdict = 'NEGATIVE' THEN 1 ELSE 0 END) negative,
        MAX(created_at) last_validated
        FROM term_evidence WHERE term_id IN (${termPlaceholders}) GROUP BY term_id`,
      )
      .all(...termIds) as JsonMap[];
    for (const evidence of evidenceRows) {
      const revisionId = revisionByTerm.get(text(evidence.term_id));
      if (revisionId) detailsByRevision.get(revisionId)!.evidence = evidence;
    }

    const promptCountRows = this.db
      .prepare(
        `SELECT b.term_id,
        count(*) citation_count, count(DISTINCT pv.series_id) series_count
        FROM prompt_term_bindings b JOIN prompt_versions pv ON pv.id = b.prompt_version_id
        WHERE b.term_id IN (${termPlaceholders}) GROUP BY b.term_id`,
      )
      .all(...termIds) as JsonMap[];
    for (const promptCount of promptCountRows) {
      const revisionId = revisionByTerm.get(text(promptCount.term_id));
      if (revisionId) detailsByRevision.get(revisionId)!.promptCount = promptCount;
    }

    const pendingRows = this.db
      .prepare(
        `SELECT b.term_id, count(*) count FROM annotations a
        JOIN generation_runs gr ON gr.result_asset_id = a.image_asset_id
        JOIN prompt_term_bindings b ON b.prompt_version_id = gr.prompt_version_id
        WHERE b.term_id IN (${termPlaceholders}) AND a.status = 'OPEN'
        GROUP BY b.term_id`,
      )
      .all(...termIds) as JsonMap[];
    for (const pending of pendingRows) {
      const revisionId = revisionByTerm.get(text(pending.term_id));
      if (revisionId) detailsByRevision.get(revisionId)!.pending = pending;
    }

    return detailsByRevision;
  }

  protected termRow(
    row: JsonMap,
    locale: Locale,
    details: TermRowDetails,
    mediaPreview = emptyMediaPreview(),
  ): TermListItem {
    const revisionId = text(row.id);
    const termId = text(row.term_id);
    const {
      aliasRows,
      localizationRows,
      expressionRows,
      categories,
      primaryDirectoryClassificationId,
      evidence,
      promptCount,
      pending,
    } = details;
    const titleLocale = text(row.title_locale);
    const categoryDtos: TermCategoryDto[] = categories.map((category) => {
      const categoryPrimaryName = text(category[locale === 'zh' ? 'primary_name_zh' : 'primary_name_en']);
      const categorySecondaryName = category.secondary_value_id
        ? text(category[locale === 'zh' ? 'secondary_name_zh' : 'secondary_name_en'])
        : null;
      const categoryPath = text(category.path);
      return {
        id: text(category.id),
        stableKey: text(category.stable_key),
        name: categoryPath,
        primaryValueId: text(category.primary_value_id),
        primaryName: categoryPrimaryName,
        secondaryValueId: category.secondary_value_id ? text(category.secondary_value_id) : null,
        secondaryName: categorySecondaryName,
        parentId: category.parent_id ? text(category.parent_id) : null,
        path: categoryPath,
        state: category.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
        selectable: Boolean(category.selectable),
      };
    });
    return {
      id: termId,
      stableKey: text(row.stable_key),
      title: text(row.title),
      titleLocale,
      definition: text(row.definition),
      aliases: aliasRows.filter((item) => text(item.locale) === titleLocale).map((item) => text(item.value)),
      localizations: localizationRows.map((item) => ({
        locale: text(item.locale),
        title: text(item.title),
        definition: text(item.definition),
        aliases: aliasRows
          .filter((alias) => text(alias.locale) === text(item.locale))
          .map((alias) => text(alias.value)),
      })),
      editorialState: text(row.editorial_state) as TermListItem['editorialState'],
      revisionNo: Number(row.revision_no),
      termRevisionId: revisionId,
      modelExpressions: expressionRows.map((item) => ({
        id: text(item.id),
        contextKey: text(item.context_key),
        modelKey: text(item.model_key),
        locale: text(item.locale),
        positive: text(item.positive_expression),
        negative: text(item.negative_expression),
      })),
      classificationIds: categoryDtos.map((category) => category.id),
      classifications: categoryDtos,
      primaryDirectoryClassificationId,
      hasDraft: Boolean(row.has_draft),
      mediaPreview,
      metrics: {
        citationCount: Number(promptCount.citation_count ?? 0),
        distinctPromptSeries: Number(promptCount.series_count ?? 0),
        positiveEvidence: Number(evidence.positive ?? 0),
        negativeEvidence: Number(evidence.negative ?? 0),
        pendingIssues: Number(pending.count ?? 0),
        lastValidatedAt: evidence.last_validated ? text(evidence.last_validated) : null,
      },
    };
  }

  private activeMediaByTerm(termIds?: string[]): Map<string, TermMediaItemDto[]> {
    if (termIds && !termIds.length) return new Map();
    const termFilter = termIds ? `AND l.term_id IN (${termIds.map(() => '?').join(',')})` : '';
    const rows = this.db
      .prepare(
        `SELECT l.*, a.kind AS asset_kind, a.origin_type AS asset_origin_type,
        a.width AS asset_width, a.height AS asset_height, a.mime_type AS asset_mime_type,
        a.byte_size AS asset_byte_size, a.created_at AS asset_created_at
        FROM term_media_links l JOIN image_assets a ON a.id = l.image_asset_id
        WHERE l.deleted_at IS NULL AND a.deleted_at IS NULL
        ${termFilter}
        ORDER BY l.term_id, CASE l.role WHEN 'COVER' THEN 0 ELSE 1 END, l.sort_order, l.created_at`,
      )
      .all(...(termIds ?? [])) as JsonMap[];
    const byTerm = new Map<string, TermMediaItemDto[]>();
    for (const row of rows) {
      const items = byTerm.get(text(row.term_id)) ?? [];
      items.push(this.termMediaItem(row));
      byTerm.set(text(row.term_id), items);
    }
    return byTerm;
  }

  protected termMediaItem(row: JsonMap): TermMediaItemDto {
    const asset: AssetDto = {
      id: text(row.image_asset_id),
      kind: text(row.asset_kind) as AssetDto['kind'],
      originType: text(row.asset_origin_type),
      width: Number(row.asset_width),
      height: Number(row.asset_height),
      mimeType: text(row.asset_mime_type),
      byteSize: Number(row.asset_byte_size),
      mediaUrl: mediaUrl(text(row.image_asset_id)),
      createdAt: text(row.asset_created_at),
    };
    return {
      id: text(row.id),
      role: text(row.role) as TermMediaItemDto['role'],
      sortOrder: Number(row.sort_order),
      focalX: Number(row.focal_x),
      focalY: Number(row.focal_y),
      asset,
    };
  }
}
