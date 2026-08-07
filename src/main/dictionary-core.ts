import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readDictionaryImport } from '@/main/dictionary-import';
import {
  fixtureContentHash,
  fixtureDerivedTermRevisionId,
  fixtureTermSourceHash,
} from '@/main/database/fixture-pack-source';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';

type JsonMap = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const maps = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === 'object') : [];
const now = () => new Date().toISOString();

function catalogSuffix(stableKey: string) {
  return trimSurroundingCharacters(stableKey.toLowerCase().replace(/[^a-z0-9]+/g, '_'), '_');
}

function importedTerm(row: JsonMap): JsonMap | null {
  const stableKey = text(row.stableKey);
  if (!stableKey) return null;
  const suffix = catalogSuffix(stableKey);
  return {
    ...row,
    id: `term_catalog_${suffix}`,
    revisionId: `tr_catalog_${suffix}_01`,
    revisionNo: 1,
    stableKey,
    editorialState: 'DRAFT',
  };
}

function localized(value: unknown, locale: 'zh' | 'en'): string {
  const map = value && typeof value === 'object' ? (value as JsonMap) : {};
  return text(map[locale]) || text(map[locale === 'zh' ? 'en' : 'zh']);
}

function aliasesFor(rows: JsonMap[], locale: string) {
  return rows
    .filter((row) => text(row.locale) === locale)
    .map((row) => text(row.value).trim())
    .filter(Boolean)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function storedFixtureTermHash(db: Database.Database, stableKey: string, revisionId: string) {
  const row = db
    .prepare(
      `SELECT revision.title, revision.title_locale, revision.definition,
        primary_category.stable_key AS primary_directory_classification_key
      FROM term_revisions revision
      JOIN terms term ON term.id = revision.term_id
      LEFT JOIN term_directory_placements placement ON placement.term_id = term.id
      LEFT JOIN term_categories primary_category ON primary_category.id = placement.primary_category_id
      WHERE revision.id = ? AND term.stable_key = ?`,
    )
    .get(revisionId, stableKey) as JsonMap | undefined;
  if (!row) return '';
  const aliases = db
    .prepare(
      `SELECT locale, value FROM term_aliases
      WHERE term_revision_id = ? ORDER BY locale, normalized_value, value`,
    )
    .all(revisionId) as JsonMap[];
  const localizations = db
    .prepare(
      `SELECT locale, title, definition FROM term_localizations
      WHERE term_revision_id = ? ORDER BY locale`,
    )
    .all(revisionId) as JsonMap[];
  const expressions = db
    .prepare(
      `SELECT profile.stable_key AS context_key, expression.model_key, expression.locale,
        expression.positive_expression, expression.negative_expression
      FROM term_expressions expression
      JOIN term_context_profile_revisions profile_revision
        ON profile_revision.id = expression.context_profile_revision_id
      JOIN term_context_profiles profile ON profile.id = profile_revision.context_profile_id
      WHERE expression.term_revision_id = ?
      ORDER BY profile.stable_key, expression.model_key, expression.locale, expression.id`,
    )
    .all(revisionId) as JsonMap[];
  const classifications = db
    .prepare(
      `SELECT category.stable_key
      FROM term_revision_categories membership
      JOIN term_categories category ON category.id = membership.category_id
      WHERE membership.term_revision_id = ?
      ORDER BY membership.sort_order, membership.category_id`,
    )
    .all(revisionId) as JsonMap[];
  const titleLocale = text(row.title_locale);
  return fixtureTermSourceHash({
    stableKey,
    title: text(row.title).trim(),
    titleLocale,
    definition: text(row.definition).trim(),
    aliases: aliasesFor(aliases, titleLocale),
    localizations: localizations.map((item) => ({
      locale: text(item.locale),
      title: text(item.title).trim(),
      definition: text(item.definition).trim(),
      aliases: aliasesFor(aliases, text(item.locale)),
    })),
    classificationKeys: classifications.map((classification) => text(classification.stable_key)),
    primaryDirectoryClassificationKey: text(row.primary_directory_classification_key),
    expressions: expressions.map((item) => ({
      contextKey: text(item.context_key),
      modelKey: text(item.model_key),
      locale: text(item.locale),
      positive: text(item.positive_expression).trim(),
      negative: text(item.negative_expression).trim(),
    })),
  });
}

function revisionIsPackLinked(db: Database.Database, revisionId: string) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM pack_object_links
        WHERE local_revision_id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(revisionId),
  );
}

export function resolveFacetValueId(db: Database.Database, qualifiedKey: string): string | null {
  const separator = qualifiedKey.indexOf(':');
  if (separator > 0) {
    const definitionKey = qualifiedKey.slice(0, separator);
    const valueKey = qualifiedKey.slice(separator + 1);
    const row = db
      .prepare(
        `SELECT value.id FROM facet_values value
        JOIN facet_definitions definition ON definition.id = value.definition_id
        WHERE definition.stable_key = ? AND value.stable_key = ?`,
      )
      .get(definitionKey, valueKey) as JsonMap | undefined;
    return row ? text(row.id) : null;
  }
  const rows = db.prepare('SELECT id FROM facet_values WHERE stable_key = ?').all(qualifiedKey) as JsonMap[];
  return rows.length === 1 ? text(rows[0].id) : null;
}

function resolveCategoryId(db: Database.Database, stableKey: string) {
  const row = db.prepare('SELECT id FROM term_categories WHERE stable_key = ?').get(stableKey) as JsonMap | undefined;
  return row ? text(row.id) : null;
}

function reconcileFacetDefinitions(db: Database.Database, definitions: JsonMap[]) {
  for (const definition of definitions) {
    const name = definition.name as JsonMap;
    db.prepare(
      `INSERT INTO facet_definitions
      (id, stable_key, name_zh, name_en, selection_mode, sort_order) VALUES (?, ?, ?, ?, 'MULTI', ?)
      ON CONFLICT(id) DO UPDATE SET stable_key = excluded.stable_key, name_zh = excluded.name_zh,
        name_en = excluded.name_en, selection_mode = excluded.selection_mode, sort_order = excluded.sort_order`,
    ).run(definition.id, definition.stableKey, localized(name, 'zh'), localized(name, 'en'), definition.sortOrder);
    for (const value of maps(definition.values)) {
      const valueName = value.name as JsonMap;
      db.prepare(
        `INSERT INTO facet_values
        (id, definition_id, stable_key, name_zh, name_en, sort_order) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET definition_id = excluded.definition_id, stable_key = excluded.stable_key,
          name_zh = excluded.name_zh, name_en = excluded.name_en, sort_order = excluded.sort_order`,
      ).run(
        value.id,
        definition.id,
        value.stableKey,
        localized(valueName, 'zh'),
        localized(valueName, 'en'),
        value.sortOrder,
      );
    }
  }
}

function reconcileCategories(db: Database.Database, categories: JsonMap[]) {
  const sourceSnapshots = new Map<string, JsonMap>();
  for (const category of categories) {
    const primaryValueId = resolveFacetValueId(db, text(category.primaryFacetKey));
    const secondaryKey = text(category.secondaryFacetKey);
    const secondaryValueId = secondaryKey ? resolveFacetValueId(db, secondaryKey) : null;
    if (!primaryValueId || (secondaryKey && !secondaryValueId)) {
      throw new Error(`Unknown dictionary category facet: ${text(category.stableKey)}`);
    }
    const labelValueId = secondaryValueId ?? primaryValueId;
    const label = db
      .prepare('SELECT name_zh, name_en, sort_order FROM facet_values WHERE id = ?')
      .get(labelValueId) as JsonMap;
    const nameZh = text(label.name_zh).trim();
    const nameEn = text(label.name_en).trim();
    const name = nameZh || nameEn || text(category.stableKey);
    const nameLocale = nameZh ? 'zh' : 'en';
    const updatedAt = now();
    const sourceLocalizations = [
      ...(nameLocale !== 'zh' && nameZh && nameZh !== name ? [{ locale: 'zh', name: nameZh }] : []),
      ...(nameLocale !== 'en' && nameEn && nameEn !== name ? [{ locale: 'en', name: nameEn }] : []),
    ];
    sourceSnapshots.set(text(category.id), {
      parentId: null,
      name,
      nameLocale,
      localizations: sourceLocalizations,
      sortOrder: Number(label.sort_order),
      state: 'ACTIVE',
      primaryFacetValueId: primaryValueId,
      secondaryFacetValueId: secondaryValueId,
    });
    db.prepare(
      `INSERT INTO term_categories(
        id, stable_key, primary_facet_value_id, secondary_facet_value_id,
        parent_id, name, name_locale, sort_order, state, source_type,
        modified_locally, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'ACTIVE', 'CONTENT_PACK', 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET stable_key = excluded.stable_key,
        primary_facet_value_id = excluded.primary_facet_value_id,
        secondary_facet_value_id = excluded.secondary_facet_value_id,
        name = excluded.name,
        name_locale = excluded.name_locale,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
      WHERE term_categories.modified_locally = 0`,
    ).run(
      category.id,
      category.stableKey,
      primaryValueId,
      secondaryValueId,
      name,
      nameLocale,
      Number(label.sort_order),
      updatedAt,
      updatedAt,
    );
    const stored = db.prepare('SELECT modified_locally FROM term_categories WHERE id = ?').get(category.id) as JsonMap;
    if (!Boolean(stored.modified_locally)) {
      db.prepare('DELETE FROM term_category_localizations WHERE category_id = ?').run(category.id);
      const insertLocalization = db.prepare(
        'INSERT INTO term_category_localizations(id, category_id, locale, name) VALUES (?, ?, ?, ?)',
      );
      for (const localization of sourceLocalizations) {
        insertLocalization.run(
          `${category.id}_localization_${localization.locale}`,
          category.id,
          localization.locale,
          localization.name,
        );
      }
    }
  }
  for (const category of categories) {
    db.prepare(
      `UPDATE term_categories
      SET parent_id = CASE
          WHEN secondary_facet_value_id IS NULL THEN NULL
          ELSE (
            SELECT root.id FROM term_categories root
            WHERE root.primary_facet_value_id = term_categories.primary_facet_value_id
              AND root.secondary_facet_value_id IS NULL
            ORDER BY root.sort_order, root.id
            LIMIT 1
          )
        END,
        updated_at = ?
      WHERE id = ? AND modified_locally = 0`,
    ).run(now(), category.id);
  }
  for (const category of categories) {
    const categoryId = text(category.id);
    const snapshot = sourceSnapshots.get(categoryId);
    if (!snapshot) continue;
    if (snapshot.secondaryFacetValueId) {
      const parent = db
        .prepare(
          `SELECT id FROM term_categories
          WHERE primary_facet_value_id = ? AND secondary_facet_value_id IS NULL
          ORDER BY sort_order, id LIMIT 1`,
        )
        .get(snapshot.primaryFacetValueId) as JsonMap | undefined;
      snapshot.parentId = parent ? text(parent.id) : null;
    }
    const override = db
      .prepare(
        `SELECT id, patch_json FROM local_overrides
        WHERE base_release_item_id = ? AND local_object_type = 'TERM_CATEGORY'
          AND override_kind = 'REPLACE' AND scope_type = 'SPACE' AND scope_id = ''
          AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get(categoryId) as JsonMap | undefined;
    if (!override) continue;
    let patch: JsonMap = {};
    try {
      const parsed = JSON.parse(text(override.patch_json));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) patch = parsed as JsonMap;
    } catch {
      patch = {};
    }
    patch.source = snapshot;
    db.prepare('UPDATE local_overrides SET patch_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(patch),
      now(),
      override.id,
    );
  }
}

function replaceTermContent(
  db: Database.Database,
  term: JsonMap,
  revisionId: string,
  titleLocale: string,
  classificationIds: string[],
  primaryDirectoryClassificationId: string | null,
) {
  db.prepare('DELETE FROM term_facet_assignments WHERE term_revision_id = ?').run(revisionId);
  db.prepare('DELETE FROM term_revision_categories WHERE term_revision_id = ?').run(revisionId);
  db.prepare('DELETE FROM term_aliases WHERE term_revision_id = ?').run(revisionId);
  db.prepare('DELETE FROM term_localizations WHERE term_revision_id = ?').run(revisionId);
  db.prepare('DELETE FROM term_expressions WHERE term_revision_id = ?').run(revisionId);

  const insertAlias = db.prepare('INSERT INTO term_aliases VALUES (?, ?, ?, ?, ?)');
  for (const [index, alias] of strings(term.aliases)
    .map((value) => value.trim())
    .filter(Boolean)
    .entries()) {
    insertAlias.run(`${revisionId}_alias_primary_${index + 1}`, revisionId, titleLocale, alias, alias.toLowerCase());
  }
  const insertLocalization = db.prepare('INSERT INTO term_localizations VALUES (?, ?, ?, ?, ?)');
  for (const [localizationIndex, localization] of maps(term.localizations).entries()) {
    const locale = text(localization.locale).trim();
    const localizedTitle = text(localization.title).trim();
    if (!locale || !localizedTitle || locale === titleLocale) continue;
    insertLocalization.run(
      `${revisionId}_localization_${localizationIndex + 1}`,
      revisionId,
      locale,
      localizedTitle,
      text(localization.definition).trim(),
    );
    for (const [aliasIndex, alias] of strings(localization.aliases)
      .map((value) => value.trim())
      .filter(Boolean)
      .entries()) {
      insertAlias.run(
        `${revisionId}_alias_${localizationIndex + 1}_${aliasIndex + 1}`,
        revisionId,
        locale,
        alias,
        alias.toLowerCase(),
      );
    }
  }

  const insertExpression = db.prepare(
    `INSERT INTO term_expressions
    (id, term_revision_id, context_profile_revision_id, model_key, locale,
      positive_expression, negative_expression)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const contextProfileRevisions = new Map<string, string>();
  for (const [index, expression] of maps(term.expressions).entries()) {
    const contextKey = text(expression.contextKey).trim().toLocaleLowerCase();
    const modelKey = text(expression.modelKey).trim();
    const locale = text(expression.locale).trim();
    const positive = text(expression.positive).trim();
    const negative = text(expression.negative).trim();
    if (!contextKey || !modelKey || !locale || (!positive && !negative)) {
      throw new Error(`Invalid dictionary expression: ${text(term.stableKey)}`);
    }
    let contextProfileRevisionId = contextProfileRevisions.get(contextKey);
    if (!contextProfileRevisionId) {
      const contextHash = fixtureContentHash(contextKey).slice(0, 16);
      const profileId = `term_context_${text(term.id)}_${contextHash}`;
      db.prepare(
        `INSERT OR IGNORE INTO term_context_profiles(id, term_id, stable_key, created_at)
        VALUES (?, ?, ?, ?)`,
      ).run(profileId, term.id, contextKey, now());
      const storedProfile = db
        .prepare('SELECT id FROM term_context_profiles WHERE term_id = ? AND stable_key = ?')
        .get(term.id, contextKey) as JsonMap;
      contextProfileRevisionId = `${revisionId}_context_${contextHash}`;
      db.prepare(
        `INSERT OR IGNORE INTO term_context_profile_revisions(
          id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at
        ) VALUES (?, ?, ?, '', '', ?)`,
      ).run(contextProfileRevisionId, storedProfile.id, revisionId, now());
      const storedProfileRevision = db
        .prepare(
          `SELECT id FROM term_context_profile_revisions
          WHERE context_profile_id = ? AND term_revision_id = ?`,
        )
        .get(storedProfile.id, revisionId) as JsonMap;
      contextProfileRevisionId = text(storedProfileRevision.id);
      contextProfileRevisions.set(contextKey, contextProfileRevisionId);
    }
    insertExpression.run(
      `${revisionId}_expression_${index + 1}`,
      revisionId,
      contextProfileRevisionId,
      modelKey,
      locale,
      positive,
      negative,
    );
  }

  const facetValueIds = new Set<string>();
  for (const classificationId of classificationIds) {
    const category = db
      .prepare('SELECT primary_facet_value_id, secondary_facet_value_id FROM term_categories WHERE id = ?')
      .get(classificationId) as JsonMap;
    facetValueIds.add(text(category.primary_facet_value_id));
    if (category.secondary_facet_value_id) facetValueIds.add(text(category.secondary_facet_value_id));
  }
  const insertFacet = db.prepare('INSERT INTO term_facet_assignments VALUES (?, ?, ?)');
  for (const [index, facetValueId] of [...facetValueIds].filter(Boolean).entries()) {
    insertFacet.run(`${revisionId}_facet_${index + 1}`, revisionId, facetValueId);
  }
  const insertClassification = db.prepare(
    'INSERT INTO term_revision_categories(id, term_revision_id, category_id, sort_order) VALUES (?, ?, ?, ?)',
  );
  for (const [sortOrder, classificationId] of classificationIds.entries()) {
    insertClassification.run(`${revisionId}_classification_${sortOrder + 1}`, revisionId, classificationId, sortOrder);
  }
  const primaryCategory = primaryDirectoryClassificationId
    ? (db
        .prepare('SELECT primary_facet_value_id, secondary_facet_value_id FROM term_categories WHERE id = ?')
        .get(primaryDirectoryClassificationId) as JsonMap)
    : null;
  db.prepare(
    `INSERT INTO term_directory_placements(
      term_id, domain_facet_value_id, item_type_facet_value_id, created_at, updated_at, primary_category_id
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(term_id) DO UPDATE SET
      domain_facet_value_id = excluded.domain_facet_value_id,
      item_type_facet_value_id = excluded.item_type_facet_value_id,
      primary_category_id = excluded.primary_category_id,
      updated_at = excluded.updated_at`,
  ).run(
    term.id,
    primaryCategory?.primary_facet_value_id ?? null,
    primaryCategory?.secondary_facet_value_id ?? null,
    now(),
    now(),
    primaryDirectoryClassificationId,
  );
}

function reconcileTerm(db: Database.Database, term: JsonMap) {
  const title = text(term.title).trim();
  const titleLocale = text(term.titleLocale).trim();
  const baseRevisionId = text(term.revisionId);
  if (!title || !titleLocale || !baseRevisionId) throw new Error(`Invalid dictionary term: ${text(term.stableKey)}`);
  const sourceHash = fixtureTermSourceHash(term);
  const baseIsPackLinked = revisionIsPackLinked(db, baseRevisionId);
  const revisionId =
    baseIsPackLinked && storedFixtureTermHash(db, text(term.stableKey), baseRevisionId) !== sourceHash
      ? fixtureDerivedTermRevisionId(baseRevisionId, sourceHash)
      : baseRevisionId;
  const previous = db.prepare('SELECT current_revision_id FROM terms WHERE id = ?').get(term.id) as JsonMap | undefined;
  const previousCurrentRevisionId = text(previous?.current_revision_id);
  const existingRevision = db.prepare('SELECT revision_no FROM term_revisions WHERE id = ?').get(revisionId) as
    JsonMap | undefined;
  const revisionNo = existingRevision
    ? Number(existingRevision.revision_no)
    : revisionId === baseRevisionId
      ? Number(term.revisionNo)
      : Number(
          (
            db
              .prepare('SELECT COALESCE(MAX(revision_no), 0) AS value FROM term_revisions WHERE term_id = ?')
              .get(term.id) as JsonMap | undefined
          )?.value,
        ) + 1;
  const classificationKeys = [
    ...new Set(
      strings(term.classificationKeys)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
  const classificationIds = classificationKeys.map((key) => {
    const id = resolveCategoryId(db, key);
    if (!id) throw new Error(`Unknown dictionary classification: ${key}`);
    return id;
  });
  const primaryDirectoryClassificationKey = text(term.primaryDirectoryClassificationKey).trim();
  if (classificationKeys.length > 0 && !primaryDirectoryClassificationKey) {
    throw new Error(`Dictionary term needs a primary directory classification: ${text(term.stableKey)}`);
  }
  if (primaryDirectoryClassificationKey && !classificationKeys.includes(primaryDirectoryClassificationKey)) {
    throw new Error(`Primary directory classification must be selected: ${text(term.stableKey)}`);
  }
  const primaryDirectoryClassificationId = primaryDirectoryClassificationKey
    ? resolveCategoryId(db, primaryDirectoryClassificationKey)
    : null;
  db.prepare(
    `INSERT INTO terms(id, stable_key, current_revision_id, editorial_state, archived_at)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET stable_key = excluded.stable_key`,
  ).run(term.id, term.stableKey, revisionId, term.editorialState || 'DRAFT');
  if (!existingRevision) {
    db.prepare(
      `INSERT INTO term_revisions
      (id, term_id, revision_no, title, title_locale, definition, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(revisionId, term.id, revisionNo, title, titleLocale, text(term.definition).trim(), now());
  } else if (!revisionIsPackLinked(db, revisionId)) {
    db.prepare(`UPDATE term_revisions SET title = ?, title_locale = ?, definition = ? WHERE id = ?`).run(
      title,
      titleLocale,
      text(term.definition).trim(),
      revisionId,
    );
  } else if (storedFixtureTermHash(db, text(term.stableKey), revisionId) !== sourceHash) {
    throw new Error(`Content revision is sealed with different content: ${revisionId}`);
  }

  const followsFixtureRevision =
    !previous ||
    previousCurrentRevisionId === baseRevisionId ||
    previousCurrentRevisionId.startsWith(`${baseRevisionId}_fixture_`);
  if (previous && followsFixtureRevision && previousCurrentRevisionId !== revisionId) {
    db.prepare('UPDATE terms SET current_revision_id = ? WHERE id = ?').run(revisionId, term.id);
  }
  if (revisionIsPackLinked(db, revisionId)) return;
  replaceTermContent(db, term, revisionId, titleLocale, classificationIds, primaryDirectoryClassificationId);
}

function retireDictionaryTerms(db: Database.Database, termIds: string[]) {
  for (const termId of termIds) {
    db.prepare(
      `UPDATE terms SET archived_at = COALESCE(archived_at, ?)
      WHERE id = ? AND NOT EXISTS (
        SELECT 1 FROM prompt_term_bindings binding WHERE binding.term_id = terms.id
      )`,
    ).run(now(), termId);
  }
}

/** Reconciles a v0.3.0 dictionary source with package-owned immutable revisions. */
export interface PreparedDictionarySource {
  document: JsonMap;
  catalogRows: readonly JsonMap[];
}

export function reconcileDictionaryCore(
  db: Database.Database,
  sourcePath: string,
  revisionMarkerKey = 'dictionary_core_revision',
  prepared?: PreparedDictionarySource,
) {
  const source = prepared?.document ?? (JSON.parse(readFileSync(sourcePath, 'utf8')) as JsonMap);
  if (text(source.schemaVersion) !== '0.3.0') throw new Error('Dictionary source must use schema v0.3.0');
  const revision = text(source.structureRevision);
  if (!revision) return;
  const marker = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(revisionMarkerKey) as
    { value: string } | undefined;
  if (marker?.value === revision) return;
  const definitions = maps(source.facetDefinitions);
  const inlineTerms = maps(source.terms);
  const catalogRows =
    prepared?.catalogRows ??
    strings(source.termFiles).flatMap((fileName) =>
      readDictionaryImport(path.resolve(path.dirname(sourcePath), fileName), {
        rootPath: path.dirname(sourcePath),
      }),
    );
  const catalogTerms = catalogRows.map(importedTerm).filter((term): term is JsonMap => term !== null);
  const terms = [...inlineTerms, ...catalogTerms];
  const categories = maps(source.categories);
  const retiredTermIds = strings(source.retiredTermIds);
  if (!definitions.length || !terms.length) return;

  db.transaction(() => {
    reconcileFacetDefinitions(db, definitions);
    reconcileCategories(db, categories);

    for (const term of terms) reconcileTerm(db, term);
    retireDictionaryTerms(db, retiredTermIds);

    db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)').run(revisionMarkerKey, revision);
  })();
}
