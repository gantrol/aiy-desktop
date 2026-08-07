import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  AddTermMediaInput,
  AssetDto,
  CreateWordPaletteInput,
  DictionaryPageDto,
  DictionaryPageInput,
  DictionarySearchInput,
  DictionaryScopeContentsDto,
  DictionaryScopeResolveInput,
  FacetDefinitionDto,
  Locale,
  NewTermInput,
  ReorderTermMediaInput,
  TermCategoryDto,
  TermDraftInput,
  TermEditorDto,
  TermListItem,
  TermMediaItemDto,
  TermMediaPreviewDto,
  UpdateWordPaletteInput,
  WordPaletteDto,
} from '@/shared/contracts';
import {
  archiveWordPalette,
  createWordPalette,
  deleteWordPalette,
  listWordPalettes,
  updateWordPalette,
} from '@/main/word-palettes';
import type { LibraryStorage } from '@/main/database/storage';
import { parsePersistedTermDraft, termDraftSchema } from '@/main/database/term-draft-schema';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/values';

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

export class DictionaryRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  getFacets(locale: Locale): FacetDefinitionDto[] {
    const definitions = this.db
      .prepare('SELECT * FROM facet_definitions WHERE system_role IS NOT NULL ORDER BY sort_order')
      .all() as JsonMap[];
    const valueRows = this.db
      .prepare(
        `SELECT v.*,
      (SELECT count(*)
       FROM terms t
       JOIN term_revision_categories membership ON membership.term_revision_id = t.current_revision_id
       JOIN term_categories category ON category.id = membership.category_id
       WHERE t.archived_at IS NULL AND (
         (definition.system_role = 'PRIMARY_CLASSIFICATION' AND category.primary_facet_value_id = v.id)
         OR (definition.system_role = 'SECONDARY_CLASSIFICATION' AND category.secondary_facet_value_id = v.id)
       )) AS usage_count
      FROM facet_values v
      JOIN facet_definitions definition ON definition.id = v.definition_id
      WHERE definition.system_role IS NOT NULL
      ORDER BY v.sort_order`,
      )
      .all() as JsonMap[];
    return definitions.map((definition) => ({
      id: text(definition.id),
      stableKey: text(definition.stable_key),
      systemRole:
        definition.system_role === 'PRIMARY_CLASSIFICATION' || definition.system_role === 'SECONDARY_CLASSIFICATION'
          ? definition.system_role
          : null,
      name: text(definition[locale === 'zh' ? 'name_zh' : 'name_en']),
      values: valueRows
        .filter((row) => row.definition_id === definition.id)
        .map((row) => ({
          id: text(row.id),
          stableKey: text(row.stable_key),
          name: text(row[locale === 'zh' ? 'name_zh' : 'name_en']),
          count: Number(row.usage_count),
        })),
    }));
  }

  getCategories(locale: Locale): TermCategoryDto[] {
    const rows = this.db
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
        SELECT category.id, category.stable_key, category.parent_id, category.state,
        category_paths.path, category_paths.selectable,
        primary_value.id AS primary_value_id,
        primary_value.name_zh AS primary_name_zh,
        primary_value.name_en AS primary_name_en,
        secondary_value.id AS secondary_value_id,
        secondary_value.name_zh AS secondary_name_zh,
        secondary_value.name_en AS secondary_name_en
        FROM term_categories category
        JOIN category_paths ON category_paths.id = category.id
        JOIN facet_values primary_value ON primary_value.id = category.primary_facet_value_id
        LEFT JOIN facet_values secondary_value ON secondary_value.id = category.secondary_facet_value_id
        ORDER BY category_paths.path COLLATE NOCASE, category.stable_key`,
      )
      .all(locale, locale, locale, locale) as JsonMap[];
    return rows.map((row) => {
      const primaryName = text(row[locale === 'zh' ? 'primary_name_zh' : 'primary_name_en']);
      const secondaryName = row.secondary_value_id
        ? text(row[locale === 'zh' ? 'secondary_name_zh' : 'secondary_name_en'])
        : null;
      return {
        id: text(row.id),
        stableKey: text(row.stable_key),
        name: text(row.path),
        primaryValueId: text(row.primary_value_id),
        primaryName,
        secondaryValueId: row.secondary_value_id ? text(row.secondary_value_id) : null,
        secondaryName,
        parentId: row.parent_id ? text(row.parent_id) : null,
        path: text(row.path),
        state: row.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
        selectable: Boolean(row.selectable),
      };
    });
  }

  getWordPalettes(locale: Locale, sourceTerms?: TermListItem[]): WordPaletteDto[] {
    const paletteTermIds = sourceTerms
      ? []
      : (
          this.db
            .prepare(
              `SELECT DISTINCT term_id FROM (
      SELECT rt.term_id
      FROM word_palette_revision_terms rt
      JOIN word_palette_revisions revision ON revision.id = rt.palette_revision_id
      JOIN word_palettes palette ON palette.id = revision.palette_id
      WHERE palette.deleted_at IS NULL
      UNION ALL
      SELECT node.term_id
      FROM word_palette_revision_content_nodes node
      JOIN word_palette_revisions revision ON revision.id = node.palette_revision_id
      JOIN word_palettes palette ON palette.id = revision.palette_id
      WHERE node.term_id IS NOT NULL AND palette.deleted_at IS NULL
      UNION ALL
      SELECT content.term_id
      FROM word_palette_revision_option_contents content
      JOIN word_palette_revision_parameter_options option ON option.id = content.option_id
      JOIN word_palette_revision_parameters parameter ON parameter.id = option.parameter_revision_id
      JOIN word_palette_revisions revision ON revision.id = parameter.palette_revision_id
      JOIN word_palettes palette ON palette.id = revision.palette_id
      WHERE content.term_id IS NOT NULL AND palette.deleted_at IS NULL
    )`,
            )
            .all() as JsonMap[]
        ).map((row) => text(row.term_id));
    const resolvedTerms =
      sourceTerms ??
      (paletteTermIds.length
        ? this.searchTerms(locale, '', [], {
            excludeDrafts: false,
            excludeUncited: false,
            includeArchived: true,
            termIds: paletteTermIds,
          })
        : []);
    const terms = new Map(resolvedTerms.map((term) => [term.id, term]));
    return listWordPalettes(this.db, locale, (termId) => {
      const term = terms.get(termId);
      if (!term) throw new Error(`Palette term not found: ${termId}`);
      return term;
    });
  }

  createWordPalette(input: CreateWordPaletteInput): WordPaletteDto {
    const paletteId = createWordPalette(this.db, input, now());
    this.storage.recordChange('WORD_PALETTE', paletteId, 'CREATE', input);
    const created = this.getWordPalette(paletteId, input.locale);
    if (!created) throw new Error('Created word palette could not be loaded');
    return created;
  }

  updateWordPalette(input: UpdateWordPaletteInput): WordPaletteDto {
    const updatedAt = now();
    updateWordPalette(this.db, input, updatedAt);
    this.storage.recordChange('WORD_PALETTE', input.paletteId, 'UPDATE', input);
    const updated = this.getWordPalette(input.paletteId, input.locale);
    if (!updated) throw new Error('Updated word palette could not be loaded');
    return updated;
  }

  private getWordPalette(paletteId: string, locale: Locale): WordPaletteDto | undefined {
    const termIds = (
      this.db
        .prepare(
          `SELECT DISTINCT term_id FROM (
      SELECT rt.term_id
      FROM word_palette_revision_terms rt
      JOIN word_palette_revisions revision ON revision.id = rt.palette_revision_id
      WHERE revision.palette_id = ?
      UNION ALL
      SELECT node.term_id
      FROM word_palette_revision_content_nodes node
      JOIN word_palette_revisions revision ON revision.id = node.palette_revision_id
      WHERE node.term_id IS NOT NULL AND revision.palette_id = ?
      UNION ALL
      SELECT content.term_id
      FROM word_palette_revision_option_contents content
      JOIN word_palette_revision_parameter_options option ON option.id = content.option_id
      JOIN word_palette_revision_parameters parameter ON parameter.id = option.parameter_revision_id
      JOIN word_palette_revisions revision ON revision.id = parameter.palette_revision_id
      WHERE content.term_id IS NOT NULL AND revision.palette_id = ?
    )`,
        )
        .all(paletteId, paletteId, paletteId) as JsonMap[]
    ).map((row) => text(row.term_id));
    const sourceTerms = termIds.length
      ? this.searchTerms(locale, '', [], {
          excludeDrafts: false,
          excludeUncited: false,
          includeArchived: true,
          termIds,
        })
      : [];
    const terms = new Map(sourceTerms.map((term) => [term.id, term]));
    return listWordPalettes(
      this.db,
      locale,
      (termId) => {
        const term = terms.get(termId);
        if (!term) throw new Error(`Palette term not found: ${termId}`);
        return term;
      },
      paletteId,
    )[0];
  }

  setWordPaletteArchived(paletteId: string, archived: boolean) {
    this.db.transaction(() => {
      const changedAt = now();
      archiveWordPalette(this.db, paletteId, archived, changedAt);
      this.storage.recordChange('WORD_PALETTE', paletteId, archived ? 'ARCHIVE' : 'UNARCHIVE', { archived });
    })();
  }

  deleteWordPalette(paletteId: string) {
    this.db.transaction(() => {
      const deletedAt = now();
      deleteWordPalette(this.db, paletteId, deletedAt);
      this.db
        .prepare("INSERT INTO tombstones VALUES (?, 'WORD_PALETTE', ?, ?, 'LOCAL_ONLY')")
        .run(ulid(), paletteId, deletedAt);
      this.storage.recordChange('WORD_PALETTE', paletteId, 'DELETE', {});
    })();
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

  private loadTermRowDetails(rows: JsonMap[], locale: Locale): Map<string, TermRowDetails> {
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

  private termRow(
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

  getTerm(termId: string, locale: Locale): TermEditorDto {
    const row = this.db
      .prepare(
        `SELECT t.*, r.*,
      EXISTS(SELECT 1 FROM drafts d WHERE d.entity_type = 'TERM' AND d.entity_id = t.id) AS has_draft
      FROM terms t JOIN term_revisions r ON r.id = t.current_revision_id WHERE t.id = ?`,
      )
      .get(termId) as JsonMap | undefined;
    if (!row) throw new Error('Term not found');
    const media = this.listTermMedia(termId);
    const details = this.loadTermRowDetails([row], locale).get(text(row.id));
    if (!details) throw new Error(`Term projection details are missing: ${termId}`);
    const base = this.termRow(row, locale, details, { totalCount: media.length, items: media.slice(0, 3) });
    const draft = this.db
      .prepare("SELECT payload, updated_at FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?")
      .get(termId) as JsonMap | undefined;
    const approved: TermDraftInput = {
      termId,
      title: base.title,
      titleLocale: base.titleLocale,
      definition: base.definition,
      aliases: base.aliases,
      localizations: base.localizations,
      classificationIds: base.classificationIds,
      primaryDirectoryClassificationId: base.primaryDirectoryClassificationId,
      expressions: base.modelExpressions.map(({ contextKey, modelKey, locale, positive, negative }) => ({
        contextKey,
        modelKey,
        locale,
        positive,
        negative,
      })),
    };
    const values = draft ? parsePersistedTermDraft(text(draft.payload)) : approved;
    const classifications = draft
      ? (() => {
          const categoriesById = new Map(this.getCategories(locale).map((category) => [category.id, category]));
          return values.classificationIds
            .map((classificationId) => categoriesById.get(classificationId))
            .filter((category): category is TermCategoryDto => Boolean(category));
        })()
      : base.classifications;
    return {
      ...base,
      ...values,
      classifications,
      modelExpressions: values.expressions.map((expression, index) => ({
        id: base.modelExpressions[index]?.id ?? `draft-expression-${index}`,
        ...expression,
      })),
      media,
      draftUpdatedAt: draft ? text(draft.updated_at) : null,
    };
  }

  listTermMedia(termId: string): TermMediaItemDto[] {
    return (
      this.db
        .prepare(
          `SELECT l.*, a.kind AS asset_kind, a.origin_type AS asset_origin_type,
      a.width AS asset_width, a.height AS asset_height, a.mime_type AS asset_mime_type,
      a.byte_size AS asset_byte_size, a.created_at AS asset_created_at
      FROM term_media_links l JOIN image_assets a ON a.id = l.image_asset_id
      WHERE l.term_id = ? AND l.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY CASE l.role WHEN 'COVER' THEN 0 ELSE 1 END, l.sort_order, l.created_at`,
        )
        .all(termId) as JsonMap[]
    ).map((row) => this.termMediaItem(row));
  }

  addTermMedia(input: AddTermMediaInput): TermMediaItemDto[];
  addTermMedia(input: AddTermMediaInput, options: { returnItems: false }): void;
  addTermMedia(input: AddTermMediaInput, options?: { returnItems: false }): TermMediaItemDto[] | void {
    const assetIds = [...new Set(input.assetIds)];
    if (!this.db.prepare('SELECT 1 FROM terms WHERE id = ? AND archived_at IS NULL').get(input.termId)) {
      throw new Error('Active term not found');
    }
    this.db
      .transaction(() => {
        const hasCover = Boolean(
          this.db
            .prepare(
              `SELECT 1 FROM term_media_links
        WHERE term_id = ? AND role = 'COVER' AND deleted_at IS NULL`,
            )
            .get(input.termId),
        );
        const maximum = this.db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) AS maximum FROM term_media_links
        WHERE term_id = ? AND deleted_at IS NULL`,
          )
          .get(input.termId) as JsonMap;
        let sortOrder = Number(maximum.maximum) + 1;
        let coverAssigned = hasCover || Number(maximum.maximum) >= 0;
        const slots = assetIds.map(() => '?').join(', ');
        const availableAssetIds = new Set(
          (assetIds.length
            ? (this.db
                .prepare(`SELECT id FROM image_assets WHERE id IN (${slots}) AND deleted_at IS NULL`)
                .all(...assetIds) as JsonMap[])
            : []
          ).map((row) => text(row.id)),
        );
        if (availableAssetIds.size !== assetIds.length) throw new Error('Image asset not found');
        const linkedAssetIds = new Set(
          (assetIds.length
            ? (this.db
                .prepare(
                  `SELECT image_asset_id FROM term_media_links
                  WHERE term_id = ? AND image_asset_id IN (${slots}) AND deleted_at IS NULL`,
                )
                .all(input.termId, ...assetIds) as JsonMap[])
            : []
          ).map((row) => text(row.image_asset_id)),
        );
        const insertLink = this.db.prepare(
          `INSERT INTO term_media_links
          (id, term_id, image_asset_id, role, sort_order, focal_x, focal_y, created_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, 0.5, 0.5, ?, NULL)`,
        );
        for (const assetId of assetIds) {
          if (linkedAssetIds.has(assetId)) continue;
          const mediaId = ulid();
          const role = coverAssigned ? 'RELATED' : 'COVER';
          coverAssigned = true;
          insertLink.run(mediaId, input.termId, assetId, role, sortOrder++, now());
          this.storage.recordChange('TERM_MEDIA_LINK', mediaId, 'CREATE', { termId: input.termId, assetId, role });
        }
      })
      .immediate();
    if (options?.returnItems === false) return;
    return this.listTermMedia(input.termId);
  }

  setTermMediaCover(mediaId: string): TermMediaItemDto[] {
    const row = this.db
      .prepare(
        `SELECT l.term_id, l.role FROM term_media_links l
      JOIN terms t ON t.id = l.term_id
      JOIN image_assets a ON a.id = l.image_asset_id
      WHERE l.id = ? AND l.deleted_at IS NULL AND t.archived_at IS NULL AND a.deleted_at IS NULL`,
      )
      .get(mediaId) as JsonMap | undefined;
    if (!row) throw new Error('Active term image not found');
    const termId = text(row.term_id);
    if (row.role === 'COVER') return this.listTermMedia(termId);
    const orderedIds = this.listTermMedia(termId).map((item) => item.id);
    return this.reorderTermMedia({ termId, mediaIds: [mediaId, ...orderedIds.filter((id) => id !== mediaId)] });
  }

  removeTermMedia(mediaId: string): TermMediaItemDto[] {
    const row = this.db
      .prepare(
        `SELECT term_id FROM term_media_links
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(mediaId) as JsonMap | undefined;
    if (!row) throw new Error('Term image not found');
    const termId = text(row.term_id);
    this.db.transaction(() => {
      const deletedAt = now();
      this.db.prepare('UPDATE term_media_links SET deleted_at = ? WHERE id = ?').run(deletedAt, mediaId);
      this.db
        .prepare("INSERT INTO tombstones VALUES (?, 'TERM_MEDIA_LINK', ?, ?, 'LOCAL_ONLY')")
        .run(ulid(), mediaId, deletedAt);
      this.storage.recordChange('TERM_MEDIA_LINK', mediaId, 'DELETE', { termId });
      const remaining = this.db
        .prepare(
          `SELECT id FROM term_media_links
        WHERE term_id = ? AND deleted_at IS NULL
        ORDER BY CASE role WHEN 'COVER' THEN 0 ELSE 1 END, sort_order, created_at`,
        )
        .all(termId) as JsonMap[];
      const updateLink = this.db.prepare('UPDATE term_media_links SET role = ?, sort_order = ? WHERE id = ?');
      for (const [sortOrder, item] of remaining.entries()) {
        const id = text(item.id);
        const role = sortOrder === 0 ? 'COVER' : 'RELATED';
        updateLink.run(role, sortOrder, id);
        this.storage.recordChange('TERM_MEDIA_LINK', id, 'REORDER', { termId, sortOrder, role });
      }
    })();
    return this.listTermMedia(termId);
  }

  reorderTermMedia(input: ReorderTermMediaInput): TermMediaItemDto[] {
    const mediaIds = [...new Set(input.mediaIds)];
    const active = this.db
      .prepare(
        `SELECT l.id FROM term_media_links l
      JOIN image_assets a ON a.id = l.image_asset_id
      WHERE l.term_id = ? AND l.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY CASE l.role WHEN 'COVER' THEN 0 ELSE 1 END, l.sort_order, l.created_at`,
      )
      .all(input.termId) as JsonMap[];
    const activeIds = active.map((row) => text(row.id));
    if (mediaIds.length !== activeIds.length || activeIds.some((id) => !mediaIds.includes(id))) {
      throw new Error('Term image order is incomplete');
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE term_media_links SET role = 'RELATED'
        WHERE term_id = ? AND deleted_at IS NULL`,
        )
        .run(input.termId);
      const updateLink = this.db.prepare('UPDATE term_media_links SET role = ?, sort_order = ? WHERE id = ?');
      for (const [sortOrder, mediaId] of mediaIds.entries()) {
        const role = sortOrder === 0 ? 'COVER' : 'RELATED';
        updateLink.run(role, sortOrder, mediaId);
        this.storage.recordChange('TERM_MEDIA_LINK', mediaId, 'REORDER', { termId: input.termId, sortOrder, role });
      }
    })();
    return this.listTermMedia(input.termId);
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

  private termMediaItem(row: JsonMap): TermMediaItemDto {
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

  private normalizeDraft(input: TermDraftInput): TermDraftInput {
    const locale = input.titleLocale.trim().toLowerCase();
    const title = input.title.trim();
    if (!title) throw new Error('Title is required');
    if (!locale) throw new Error('Title language is required');
    const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    const localizationLocales = new Set<string>();
    const localizations = input.localizations.map((item) => {
      const itemLocale = item.locale.trim().toLowerCase();
      if (!itemLocale || !item.title.trim()) throw new Error('Each localization needs a language and title');
      if (itemLocale === locale) throw new Error('The primary title language cannot also be a localization');
      if (localizationLocales.has(itemLocale)) throw new Error(`Duplicate localization language: ${itemLocale}`);
      localizationLocales.add(itemLocale);
      return {
        locale: itemLocale,
        title: item.title.trim(),
        definition: item.definition.trim(),
        aliases: unique(item.aliases),
      };
    });
    const expressionKeys = new Set<string>();
    const expressions = input.expressions
      .map((item) => ({
        contextKey: item.contextKey.trim().toLocaleLowerCase(),
        modelKey: item.modelKey.trim(),
        locale: item.locale.trim().toLowerCase(),
        positive: item.positive.trim(),
        negative: item.negative.trim(),
      }))
      .filter((item) => item.contextKey || item.modelKey || item.locale || item.positive || item.negative)
      .map((item) => {
        if (!item.contextKey || !item.modelKey || !item.locale) {
          throw new Error('Each model expression needs a context, model, and language');
        }
        if (!/^[a-z][a-z0-9._-]{1,63}$/.test(item.contextKey)) {
          throw new Error(`Invalid expression context key: ${item.contextKey}`);
        }
        const key = `${item.contextKey}\u0000${item.modelKey}\u0000${item.locale}`;
        if (expressionKeys.has(key)) {
          throw new Error(`Duplicate model expression: ${item.contextKey} / ${item.modelKey} / ${item.locale}`);
        }
        expressionKeys.add(key);
        return item;
      });
    const classificationIds = unique(input.classificationIds);
    const primaryDirectoryClassificationId = input.primaryDirectoryClassificationId?.trim() || null;
    return {
      termId: input.termId,
      title,
      titleLocale: locale,
      definition: input.definition.trim(),
      aliases: unique(input.aliases),
      localizations,
      classificationIds,
      primaryDirectoryClassificationId,
      expressions,
    };
  }

  saveTermDraft(input: TermDraftInput, locale: Locale): TermEditorDto {
    if (!this.db.prepare('SELECT 1 FROM terms WHERE id = ? AND archived_at IS NULL').get(input.termId))
      throw new Error('Active term not found');
    const payload = this.normalizeDraft(termDraftSchema.parse(input));
    this.db
      .prepare(
        `INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      )
      .run(ulid(), input.termId, JSON.stringify(payload), now());
    return this.getTerm(input.termId, locale);
  }

  createTerm(input: NewTermInput): TermEditorDto {
    const title = input.title.trim();
    const titleLocale = input.titleLocale.trim().toLowerCase();
    const classificationId = input.classificationId?.trim() || null;
    if (!title) throw new Error('Title is required');
    if (!titleLocale) throw new Error('Title language is required');
    const initialCategory = classificationId
      ? (this.db
          .prepare(
            `SELECT id, primary_facet_value_id, secondary_facet_value_id
            FROM term_categories WHERE id = ? AND state = 'ACTIVE'`,
          )
          .get(classificationId) as JsonMap | undefined)
      : undefined;
    if (classificationId && !initialCategory) {
      throw new Error('Active classification not found');
    }
    const termId = ulid();
    const revisionId = ulid();
    const stableKey = `term.local.${termId.toLowerCase()}`;
    const draft: TermDraftInput = {
      termId,
      title,
      titleLocale,
      definition: '',
      aliases: [],
      localizations: [],
      classificationIds: classificationId ? [classificationId] : [],
      primaryDirectoryClassificationId: classificationId,
      expressions: [],
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO terms(id, stable_key, current_revision_id, editorial_state, archived_at)
          VALUES (?, ?, ?, 'DRAFT', NULL)`,
        )
        .run(termId, stableKey, revisionId);
      this.db
        .prepare(
          `INSERT INTO term_revisions
          (id, term_id, revision_no, title, title_locale, definition, created_at)
          VALUES (?, ?, 1, ?, ?, '', ?)`,
        )
        .run(revisionId, termId, title, titleLocale, now());
      if (initialCategory && classificationId) {
        this.db
          .prepare(
            'INSERT INTO term_revision_categories(id, term_revision_id, category_id, sort_order) VALUES (?, ?, ?, 0)',
          )
          .run(ulid(), revisionId, classificationId);
        const initialFacetValueIds = [
          text(initialCategory.primary_facet_value_id),
          initialCategory.secondary_facet_value_id ? text(initialCategory.secondary_facet_value_id) : '',
        ].filter(Boolean);
        const insertFacet = this.db.prepare('INSERT INTO term_facet_assignments VALUES (?, ?, ?)');
        for (const facetValueId of new Set(initialFacetValueIds)) insertFacet.run(ulid(), revisionId, facetValueId);
      }
      this.db
        .prepare("INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)")
        .run(ulid(), termId, JSON.stringify(draft), now());
      this.storage.recordChange('TERM', termId, 'CREATE_DRAFT', { classificationId });
    })();
    return this.getTerm(termId, input.uiLocale);
  }

  approveTerm(termId: string, locale: Locale): TermEditorDto {
    if (!this.db.prepare('SELECT 1 FROM terms WHERE id = ? AND archived_at IS NULL').get(termId))
      throw new Error('Active term not found');
    const draft = this.db
      .prepare("SELECT payload FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?")
      .get(termId) as JsonMap | undefined;
    if (!draft) throw new Error('No draft to approve');
    const input = this.normalizeDraft(parsePersistedTermDraft(text(draft.payload)));
    if (!input.definition) throw new Error('Definition is required before approval');
    if (!input.classificationIds.length) throw new Error('At least one classification is required before approval');
    if (!input.primaryDirectoryClassificationId) {
      throw new Error('Primary directory classification is required before approval');
    }
    if (!input.classificationIds.includes(input.primaryDirectoryClassificationId)) {
      throw new Error('Primary directory classification must be one of the selected classifications');
    }
    if (!input.expressions.some((expression) => expression.positive)) {
      throw new Error('At least one positive model expression is required before approval');
    }
    const selectedCategories = this.db
      .prepare(
        `SELECT id, primary_facet_value_id, secondary_facet_value_id
        FROM term_categories
        WHERE id IN (${input.classificationIds.map(() => '?').join(',')})`,
      )
      .all(...input.classificationIds) as JsonMap[];
    if (selectedCategories.length !== input.classificationIds.length) throw new Error('Classification not found');
    const primaryDirectoryCategory = this.db
      .prepare('SELECT id, primary_facet_value_id, secondary_facet_value_id FROM term_categories WHERE id = ?')
      .get(input.primaryDirectoryClassificationId) as JsonMap | undefined;
    if (!primaryDirectoryCategory) throw new Error('Primary directory classification not found');

    this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT t.current_revision_id, r.revision_no, placement.primary_category_id
          FROM terms t
          JOIN term_revisions r ON r.id = t.current_revision_id
          LEFT JOIN term_directory_placements placement ON placement.term_id = t.id
          WHERE t.id = ?`,
        )
        .get(termId) as JsonMap;
      const revisionId = ulid();
      const revisionNo = Number(current.revision_no) + 1;
      const baseReleaseItemIds = this.termBaseReleaseItemIds(termId, text(current.current_revision_id));
      this.db
        .prepare(
          `INSERT INTO term_revisions
          (id, term_id, revision_no, title, title_locale, definition, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(revisionId, termId, revisionNo, input.title, input.titleLocale, input.definition, now());
      const insertAlias = this.db.prepare('INSERT INTO term_aliases VALUES (?, ?, ?, ?, ?)');
      for (const value of input.aliases) {
        insertAlias.run(ulid(), revisionId, input.titleLocale, value, value.toLowerCase());
      }
      const insertLocalization = this.db.prepare('INSERT INTO term_localizations VALUES (?, ?, ?, ?, ?)');
      for (const localization of input.localizations) {
        insertLocalization.run(ulid(), revisionId, localization.locale, localization.title, localization.definition);
        for (const value of localization.aliases) {
          insertAlias.run(ulid(), revisionId, localization.locale, value, value.toLowerCase());
        }
      }
      const insertExpression = this.db.prepare(
        `INSERT INTO term_expressions
        (id, term_revision_id, context_profile_revision_id, model_key, locale,
          positive_expression, negative_expression)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const contextProfileRevisions = new Map<string, string>();
      for (const expression of input.expressions) {
        const contextProfileRevisionId =
          contextProfileRevisions.get(expression.contextKey) ??
          this.ensureTermContextProfileRevision(termId, revisionId, expression.contextKey);
        contextProfileRevisions.set(expression.contextKey, contextProfileRevisionId);
        insertExpression.run(
          ulid(),
          revisionId,
          contextProfileRevisionId,
          expression.modelKey,
          expression.locale,
          expression.positive,
          expression.negative,
        );
      }
      const previousFacetRows = this.db
        .prepare(
          `SELECT assignment.facet_value_id
          FROM term_facet_assignments assignment
          JOIN facet_values value ON value.id = assignment.facet_value_id
          JOIN facet_definitions definition ON definition.id = value.definition_id
          WHERE assignment.term_revision_id = ? AND definition.system_role IS NULL`,
        )
        .all(text(current.current_revision_id)) as JsonMap[];
      const facetValueIds = new Set([
        ...previousFacetRows.map((row) => text(row.facet_value_id)),
        ...selectedCategories.flatMap((category) => [
          text(category.primary_facet_value_id),
          text(category.secondary_facet_value_id),
        ]),
      ]);
      const insertFacet = this.db.prepare('INSERT INTO term_facet_assignments VALUES (?, ?, ?)');
      for (const facetValueId of [...facetValueIds].filter(Boolean)) {
        insertFacet.run(ulid(), revisionId, facetValueId);
      }
      const insertClassification = this.db.prepare(
        'INSERT INTO term_revision_categories(id, term_revision_id, category_id, sort_order) VALUES (?, ?, ?, ?)',
      );
      for (const [sortOrder, classificationId] of input.classificationIds.entries()) {
        insertClassification.run(ulid(), revisionId, classificationId, sortOrder);
      }
      this.db
        .prepare("UPDATE terms SET current_revision_id = ?, editorial_state = 'APPROVED' WHERE id = ?")
        .run(revisionId, termId);
      const primaryDirectoryChanged = text(current.primary_category_id) !== input.primaryDirectoryClassificationId;
      if (primaryDirectoryChanged) {
        this.db
          .prepare(
            `UPDATE term_directory_placements
            SET primary_category_id = ?, domain_facet_value_id = ?, item_type_facet_value_id = ?, updated_at = ?
            WHERE term_id = ?`,
          )
          .run(
            input.primaryDirectoryClassificationId,
            primaryDirectoryCategory.primary_facet_value_id,
            primaryDirectoryCategory.secondary_facet_value_id,
            now(),
            termId,
          );
      }
      this.db.prepare("DELETE FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?").run(termId);
      this.upsertTermLocalOverrides({
        termId,
        baseRevisionId: text(current.current_revision_id),
        revisionId,
        revisionNo,
        input,
        baseReleaseItemIds,
      });
      this.storage.recordChange(
        'TERM',
        termId,
        'APPROVE_REVISION',
        { revisionId, revisionNo, primaryDirectoryChanged },
        { affectsFileView: primaryDirectoryChanged },
      );
    })();
    return this.getTerm(termId, locale);
  }

  private ensureTermContextProfileRevision(termId: string, termRevisionId: string, contextKey: string) {
    let profile = this.db
      .prepare('SELECT id FROM term_context_profiles WHERE term_id = ? AND stable_key = ?')
      .get(termId, contextKey) as JsonMap | undefined;
    if (!profile) {
      const profileId = ulid();
      this.db
        .prepare('INSERT INTO term_context_profiles(id, term_id, stable_key, created_at) VALUES (?, ?, ?, ?)')
        .run(profileId, termId, contextKey, now());
      profile = { id: profileId };
    }
    const existingRevision = this.db
      .prepare(
        `SELECT id FROM term_context_profile_revisions
        WHERE context_profile_id = ? AND term_revision_id = ?`,
      )
      .get(profile.id, termRevisionId) as JsonMap | undefined;
    if (existingRevision) return text(existingRevision.id);
    const profileRevisionId = ulid();
    this.db
      .prepare(
        `INSERT INTO term_context_profile_revisions(
          id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at
        ) VALUES (?, ?, ?, '', '', ?)`,
      )
      .run(profileRevisionId, profile.id, termRevisionId, now());
    return profileRevisionId;
  }

  private termBaseReleaseItemIds(termId: string, currentRevisionId: string) {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT release_item_id AS base_release_item_id
        FROM pack_object_links
        WHERE local_object_type = 'TERM' AND local_object_id = ?
          AND local_revision_id = ? AND deleted_at IS NULL
        UNION
        SELECT DISTINCT override.base_release_item_id
        FROM local_overrides override
        JOIN term_revisions revision ON revision.id = override.local_revision_id
        WHERE revision.term_id = ? AND override.local_object_type = 'TERM'
          AND override.deleted_at IS NULL AND override.state <> 'SUPERSEDED'`,
      )
      .all(termId, currentRevisionId, termId) as JsonMap[];
    return rows.map((row) => text(row.base_release_item_id)).filter(Boolean);
  }

  private upsertTermLocalOverrides({
    termId,
    baseRevisionId,
    revisionId,
    revisionNo,
    input,
    baseReleaseItemIds,
  }: {
    termId: string;
    baseRevisionId: string;
    revisionId: string;
    revisionNo: number;
    input: TermDraftInput;
    baseReleaseItemIds: string[];
  }) {
    if (!baseReleaseItemIds.length) return;
    const space = this.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').get() as JsonMap | undefined;
    if (!space) throw new Error('Local space is unavailable');
    const contentHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          title: input.title,
          titleLocale: input.titleLocale,
          definition: input.definition,
          aliases: input.aliases,
          localizations: input.localizations,
          classificationIds: input.classificationIds,
          primaryDirectoryClassificationId: input.primaryDirectoryClassificationId,
          expressions: input.expressions,
        }),
      )
      .digest('hex')}`;
    const timestamp = now();
    for (const baseReleaseItemId of baseReleaseItemIds) {
      const existing = this.db
        .prepare(
          `SELECT id FROM local_overrides
          WHERE space_id = ? AND base_release_item_id = ? AND override_kind = 'REPLACE'
            AND scope_type = 'SPACE' AND scope_id = '' AND deleted_at IS NULL`,
        )
        .get(space.id, baseReleaseItemId) as JsonMap | undefined;
      const overrideId = existing ? text(existing.id) : ulid();
      const patch = JSON.stringify({ termId, baseRevisionId, revisionNo });
      if (existing) {
        this.db
          .prepare(
            `UPDATE local_overrides
            SET local_object_type = 'TERM', local_revision_id = ?, local_content_hash = ?,
              patch_json = ?, state = 'ACTIVE', updated_at = ?
            WHERE id = ?`,
          )
          .run(revisionId, contentHash, patch, timestamp, overrideId);
      } else {
        this.db
          .prepare(
            `INSERT INTO local_overrides(
              id, space_id, base_release_item_id, override_kind, local_object_type,
              local_revision_id, local_content_hash, patch_json, scope_type, scope_id,
              state, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, 'REPLACE', 'TERM', ?, ?, ?, 'SPACE', '', 'ACTIVE', ?, ?, NULL)`,
          )
          .run(overrideId, space.id, baseReleaseItemId, revisionId, contentHash, patch, timestamp, timestamp);
      }
      this.storage.recordChange('LOCAL_OVERRIDE', overrideId, existing ? 'UPDATE' : 'CREATE', {
        termId,
        baseReleaseItemId,
        scopeType: 'SPACE',
      });
    }
  }

  withdrawTermApproval(termId: string, locale: Locale): TermEditorDto {
    const row = this.db.prepare('SELECT editorial_state, archived_at FROM terms WHERE id = ?').get(termId) as
      JsonMap | undefined;
    if (!row) throw new Error('Term not found');
    if (row.archived_at) throw new Error('Deleted term cannot be withdrawn');
    if (row.editorial_state !== 'APPROVED') throw new Error('Only an approved term can be withdrawn');
    const current = this.getTerm(termId, locale);
    const payload = this.toDraftPayload(termId, current);
    this.db.transaction(() => {
      this.db.prepare("UPDATE terms SET editorial_state = 'DRAFT' WHERE id = ?").run(termId);
      this.db
        .prepare(
          `INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        )
        .run(ulid(), termId, JSON.stringify(payload), now());
      this.storage.recordChange('TERM', termId, 'WITHDRAW_APPROVAL', { revisionNo: current.revisionNo });
    })();
    return this.getTerm(termId, locale);
  }

  setTermArchived(termId: string, archived: boolean, locale: Locale): TermEditorDto {
    const row = this.db.prepare('SELECT archived_at FROM terms WHERE id = ?').get(termId) as JsonMap | undefined;
    if (!row) throw new Error('Term not found');
    if (Boolean(row.archived_at) === archived) return this.getTerm(termId, locale);
    const current = this.getTerm(termId, locale);
    const payload = this.toDraftPayload(termId, current);
    this.db.transaction(() => {
      if (archived) {
        this.db
          .prepare("UPDATE terms SET archived_at = ?, editorial_state = 'ARCHIVED' WHERE id = ?")
          .run(now(), termId);
        this.db.prepare("DELETE FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?").run(termId);
        this.storage.recordChange('TERM', termId, 'ARCHIVE', { revisionNo: current.revisionNo });
      } else {
        this.db.prepare("UPDATE terms SET archived_at = NULL, editorial_state = 'DRAFT' WHERE id = ?").run(termId);
        this.db
          .prepare(
            `INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)
          ON CONFLICT(entity_type, entity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
          )
          .run(ulid(), termId, JSON.stringify(payload), now());
        this.storage.recordChange('TERM', termId, 'RESTORE', { revisionNo: current.revisionNo });
      }
    })();
    return this.getTerm(termId, locale);
  }

  private toDraftPayload(termId: string, current: TermEditorDto): TermDraftInput {
    return {
      termId,
      title: current.title,
      titleLocale: current.titleLocale,
      definition: current.definition,
      aliases: current.aliases,
      localizations: current.localizations,
      classificationIds: current.classificationIds,
      primaryDirectoryClassificationId: current.primaryDirectoryClassificationId,
      expressions: current.expressions,
    };
  }
}
