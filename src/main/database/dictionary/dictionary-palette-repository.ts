import { ulid } from 'ulid';
import type {
  CreateWordPaletteInput,
  FacetDefinitionDto,
  Locale,
  TermCategoryDto,
  TermListItem,
  UpdateWordPaletteInput,
  WordPaletteDto,
} from '@/shared/contracts';
import {
  archiveWordPalette,
  createWordPalette,
  deleteWordPalette,
  listWordPalettes,
  updateWordPalette,
} from '@/main/dictionary/word-palettes';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { DictionaryQueryRepository } from '@/main/database/dictionary/dictionary-query-repository';

export class DictionaryPaletteRepository extends DictionaryQueryRepository {
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
}
