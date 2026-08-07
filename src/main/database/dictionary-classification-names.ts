import { ulid } from 'ulid';
import type { DictionaryClassificationLocalizationDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import type { ClassificationNames, ClassificationRow } from '@/main/database/dictionary-classification-types';
import { type JsonMap, text } from '@/main/database/values';

function localeMatches(candidate: string, requested: string) {
  const left = candidate.trim().toLocaleLowerCase();
  const right = requested.trim().toLocaleLowerCase();
  return left === right || left.split('-')[0] === right.split('-')[0];
}

export class DictionaryClassificationNames {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  normalize(
    name: string,
    nameLocale: string,
    localizations: DictionaryClassificationLocalizationDto[],
  ): ClassificationNames {
    const primaryName = name.trim();
    const primaryLocale = nameLocale.trim().toLocaleLowerCase();
    if (!primaryName) throw new Error('Classification name is required');
    if (!primaryLocale) throw new Error('Classification name language is required');
    const locales = new Set([primaryLocale]);
    const normalizedLocalizations = localizations
      .map((item) => ({ locale: item.locale.trim().toLocaleLowerCase(), name: item.name.trim() }))
      .filter((item) => item.locale || item.name)
      .map((item) => {
        if (!item.locale || !item.name) throw new Error('Each classification localization needs a language and name');
        if (locales.has(item.locale)) throw new Error(`Duplicate classification language: ${item.locale}`);
        locales.add(item.locale);
        return item;
      })
      .sort((left, right) => left.locale.localeCompare(right.locale));
    return { name: primaryName, nameLocale: primaryLocale, localizations: normalizedLocalizations };
  }

  localizations() {
    const result = new Map<string, DictionaryClassificationLocalizationDto[]>();
    const rows = this.db
      .prepare('SELECT category_id, locale, name FROM term_category_localizations ORDER BY locale, id')
      .all() as JsonMap[];
    for (const row of rows) {
      const categoryId = text(row.category_id);
      const values = result.get(categoryId) ?? [];
      values.push({ locale: text(row.locale), name: text(row.name) });
      result.set(categoryId, values);
    }
    return result;
  }

  forRow(row: ClassificationRow, localizationsById = this.localizations()): ClassificationNames {
    return {
      name: text(row.name),
      nameLocale: text(row.name_locale),
      localizations: localizationsById.get(text(row.id)) ?? [],
    };
  }

  conflict(left: ClassificationNames, right: ClassificationNames) {
    const rightNames = new Set(this.entries(right).map((item) => `${item.locale}\u0000${item.name}`));
    return this.entries(left).some((item) => rightNames.has(`${item.locale}\u0000${item.name}`));
  }

  assertSiblingUnique(parentId: string | null, names: ClassificationNames, exceptId = '') {
    const localizationsById = this.localizations();
    const rows = this.db.prepare('SELECT * FROM term_categories').all() as ClassificationRow[];
    const duplicate = rows.some(
      (row) =>
        text(row.id) !== exceptId &&
        (row.parent_id ? text(row.parent_id) : null) === parentId &&
        this.conflict(this.forRow(row, localizationsById), names),
    );
    if (duplicate) throw new Error('A classification with the same localized name already exists at this level');
  }

  replaceLocalizations(categoryId: string, localizations: DictionaryClassificationLocalizationDto[]) {
    this.db.prepare('DELETE FROM term_category_localizations WHERE category_id = ?').run(categoryId);
    const insert = this.db.prepare(
      'INSERT INTO term_category_localizations(id, category_id, locale, name) VALUES (?, ?, ?, ?)',
    );
    for (const item of localizations) insert.run(ulid(), categoryId, item.locale, item.name);
  }

  facetName(names: ClassificationNames, locale: string) {
    if (localeMatches(names.nameLocale, locale)) return names.name;
    return names.localizations.find((item) => localeMatches(item.locale, locale))?.name ?? '';
  }

  createFacetValue(role: 'PRIMARY_CLASSIFICATION' | 'SECONDARY_CLASSIFICATION', names: ClassificationNames) {
    const definitionId = this.definitionId(role);
    const id = ulid();
    const stableKey = `local.${id.toLowerCase()}`;
    const maximum = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maximum FROM facet_values WHERE definition_id = ?')
      .get(definitionId) as JsonMap;
    this.db
      .prepare(
        `INSERT INTO facet_values(id, definition_id, stable_key, name_zh, name_en, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        definitionId,
        stableKey,
        this.facetName(names, 'zh'),
        this.facetName(names, 'en'),
        Number(maximum.maximum) + 1,
      );
    return id;
  }

  private entries(names: ClassificationNames) {
    return [{ locale: names.nameLocale, name: names.name }, ...names.localizations].map((item) => ({
      locale: item.locale.trim().toLocaleLowerCase(),
      name: item.name.trim().toLocaleLowerCase(),
    }));
  }

  private definitionId(role: 'PRIMARY_CLASSIFICATION' | 'SECONDARY_CLASSIFICATION') {
    let row = this.db.prepare('SELECT id FROM facet_definitions WHERE system_role = ?').get(role) as
      JsonMap | undefined;
    if (!row) {
      const primary = role === 'PRIMARY_CLASSIFICATION';
      this.db
        .prepare(
          `INSERT OR IGNORE INTO facet_definitions(
            id, stable_key, name_zh, name_en, selection_mode, sort_order, system_role
          ) VALUES (?, ?, ?, ?, 'MULTI', ?, ?)`,
        )
        .run(
          primary ? 'facet_dictionary_primary_classification' : 'facet_dictionary_secondary_classification',
          primary ? 'dictionary_primary_classification' : 'dictionary_secondary_classification',
          primary ? '分类' : '类型',
          primary ? 'Classification' : 'Type',
          primary ? 0 : 1,
          role,
        );
      row = this.db.prepare('SELECT id FROM facet_definitions WHERE system_role = ?').get(role) as JsonMap | undefined;
    }
    if (!row) throw new Error(`Dictionary ${role.toLowerCase()} definition could not be initialized`);
    return text(row.id);
  }
}
