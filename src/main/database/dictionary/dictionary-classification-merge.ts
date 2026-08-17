import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { parsePersistedTermDraft } from '@/main/database/dictionary/term-draft-schema';
import { type JsonMap, now, text } from '@/main/database/core/values';

interface RevisionPlan {
  termId: string;
  sourceRevisionId: string;
  targetRevisionId: string;
  targetRevisionNo: number;
}

interface ClassificationMembership {
  categoryId: string;
  sortOrder: number;
}

interface DirectoryPlacement {
  termId: string;
  primaryCategoryId: string;
}

interface CategoryFacets {
  primaryFacetValueId: string;
  secondaryFacetValueId: string | null;
}

const affectedCategoriesTable = '_classification_mutation_categories';
const revisionPlanTable = '_classification_revision_plan';

function resolveReplacement(id: string, replacements: ReadonlyMap<string, string>) {
  const visited = new Set<string>();
  let current = id;
  while (replacements.has(current)) {
    if (visited.has(current)) throw new Error('Classification replacement plan contains a cycle');
    visited.add(current);
    current = replacements.get(current)!;
  }
  return current;
}

export function replaceDraftClassifications(storage: LibraryStorage, replacements: ReadonlyMap<string, string>) {
  if (!replacements.size) return;
  const drafts = storage.db.prepare("SELECT id, payload FROM drafts WHERE entity_type = 'TERM'").all() as JsonMap[];
  const update = storage.db.prepare('UPDATE drafts SET payload = ?, updated_at = ? WHERE id = ?');
  for (const draft of drafts) {
    const payload = parsePersistedTermDraft(text(draft.payload));
    const classificationIds = [...new Set(payload.classificationIds.map((id) => resolveReplacement(id, replacements)))];
    const primaryDirectoryClassificationId = payload.primaryDirectoryClassificationId
      ? resolveReplacement(payload.primaryDirectoryClassificationId, replacements)
      : null;
    const classificationsChanged = classificationIds.some((id, index) => id !== payload.classificationIds[index]);
    const primaryChanged = primaryDirectoryClassificationId !== payload.primaryDirectoryClassificationId;
    if (!classificationsChanged && !primaryChanged && classificationIds.length === payload.classificationIds.length)
      continue;
    update.run(JSON.stringify({ ...payload, classificationIds, primaryDirectoryClassificationId }), now(), draft.id);
  }
}

function prepareRevisionPlans(storage: LibraryStorage, affectedCategoryIds: readonly string[]) {
  const { db } = storage;
  db.prepare(
    `CREATE TEMP TABLE IF NOT EXISTS ${affectedCategoriesTable}(
      category_id TEXT PRIMARY KEY
    ) WITHOUT ROWID`,
  ).run();
  db.prepare(
    `CREATE TEMP TABLE IF NOT EXISTS ${revisionPlanTable}(
      term_id TEXT PRIMARY KEY,
      source_revision_id TEXT NOT NULL UNIQUE,
      target_revision_id TEXT NOT NULL UNIQUE,
      target_revision_no INTEGER NOT NULL
    ) WITHOUT ROWID`,
  ).run();
  db.prepare(`DELETE FROM ${affectedCategoriesTable}`).run();
  db.prepare(`DELETE FROM ${revisionPlanTable}`).run();
  const insertAffected = db.prepare(`INSERT INTO ${affectedCategoriesTable}(category_id) VALUES (?)`);
  for (const categoryId of new Set(affectedCategoryIds)) insertAffected.run(categoryId);
  const rows = db
    .prepare(
      `SELECT DISTINCT term.id AS term_id, term.current_revision_id, revision.revision_no
      FROM terms term
      JOIN term_revisions revision ON revision.id = term.current_revision_id
      JOIN term_revision_categories membership ON membership.term_revision_id = revision.id
      JOIN ${affectedCategoriesTable} affected ON affected.category_id = membership.category_id
      WHERE term.archived_at IS NULL`,
    )
    .all() as JsonMap[];
  const insertPlan = db.prepare(
    `INSERT INTO ${revisionPlanTable}(
      term_id, source_revision_id, target_revision_id, target_revision_no
    ) VALUES (?, ?, ?, ?)`,
  );
  const plans = rows.map((row): RevisionPlan => ({
    termId: text(row.term_id),
    sourceRevisionId: text(row.current_revision_id),
    targetRevisionId: ulid(),
    targetRevisionNo: Number(row.revision_no) + 1,
  }));
  for (const plan of plans) {
    insertPlan.run(plan.termId, plan.sourceRevisionId, plan.targetRevisionId, plan.targetRevisionNo);
  }
  return plans;
}

function copyRevisionCore(storage: LibraryStorage, timestamp: string) {
  const { db } = storage;
  db.prepare(
    `INSERT INTO term_revisions(
      id, term_id, revision_no, title, title_locale, definition, created_at
    )
    SELECT plan.target_revision_id, source.term_id, plan.target_revision_no,
      source.title, source.title_locale, source.definition, ?
    FROM ${revisionPlanTable} plan
    JOIN term_revisions source ON source.id = plan.source_revision_id`,
  ).run(timestamp);
  const aliases = db
    .prepare(
      `SELECT plan.target_revision_id, alias.locale, alias.value, alias.normalized_value
      FROM ${revisionPlanTable} plan
      JOIN term_aliases alias ON alias.term_revision_id = plan.source_revision_id`,
    )
    .all() as JsonMap[];
  const insertAlias = db.prepare(
    'INSERT INTO term_aliases(id, term_revision_id, locale, value, normalized_value) VALUES (?, ?, ?, ?, ?)',
  );
  for (const alias of aliases) {
    insertAlias.run(ulid(), alias.target_revision_id, alias.locale, alias.value, alias.normalized_value);
  }
  const localizations = db
    .prepare(
      `SELECT plan.target_revision_id, localization.locale, localization.title, localization.definition
      FROM ${revisionPlanTable} plan
      JOIN term_localizations localization ON localization.term_revision_id = plan.source_revision_id`,
    )
    .all() as JsonMap[];
  const insertLocalization = db.prepare(
    'INSERT INTO term_localizations(id, term_revision_id, locale, title, definition) VALUES (?, ?, ?, ?, ?)',
  );
  for (const localization of localizations) {
    insertLocalization.run(
      ulid(),
      localization.target_revision_id,
      localization.locale,
      localization.title,
      localization.definition,
    );
  }
}

function copyContextProfiles(storage: LibraryStorage, timestamp: string) {
  const { db } = storage;
  const profiles = db
    .prepare(
      `SELECT profile_revision.id AS source_profile_revision_id,
        profile_revision.context_profile_id, plan.target_revision_id,
        profile_revision.definition, profile_revision.exclusion_boundary
      FROM ${revisionPlanTable} plan
      JOIN term_context_profile_revisions profile_revision
        ON profile_revision.term_revision_id = plan.source_revision_id`,
    )
    .all() as JsonMap[];
  const targetProfileRevisionBySource = new Map<string, string>();
  const insertProfileRevision = db.prepare(
    `INSERT INTO term_context_profile_revisions(
      id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const profile of profiles) {
    const targetProfileRevisionId = ulid();
    targetProfileRevisionBySource.set(text(profile.source_profile_revision_id), targetProfileRevisionId);
    insertProfileRevision.run(
      targetProfileRevisionId,
      profile.context_profile_id,
      profile.target_revision_id,
      profile.definition,
      profile.exclusion_boundary,
      timestamp,
    );
  }
  const expressions = db
    .prepare(
      `SELECT plan.target_revision_id, expression.context_profile_revision_id,
        expression.model_key, expression.locale,
        expression.positive_expression, expression.negative_expression
      FROM ${revisionPlanTable} plan
      JOIN term_expressions expression ON expression.term_revision_id = plan.source_revision_id`,
    )
    .all() as JsonMap[];
  const insertExpression = db.prepare(
    `INSERT INTO term_expressions(
      id, term_revision_id, context_profile_revision_id, model_key, locale,
      positive_expression, negative_expression
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const expression of expressions) {
    const targetProfileRevisionId = targetProfileRevisionBySource.get(text(expression.context_profile_revision_id));
    if (!targetProfileRevisionId) throw new Error('Expression references a missing context profile revision');
    insertExpression.run(
      ulid(),
      expression.target_revision_id,
      targetProfileRevisionId,
      expression.model_key,
      expression.locale,
      expression.positive_expression,
      expression.negative_expression,
    );
  }
}

function loadMemberships(storage: LibraryStorage, replacements: ReadonlyMap<string, string>) {
  const rows = storage.db
    .prepare(
      `SELECT plan.target_revision_id, membership.category_id, membership.sort_order
      FROM ${revisionPlanTable} plan
      JOIN term_revision_categories membership ON membership.term_revision_id = plan.source_revision_id
      ORDER BY plan.target_revision_id, membership.sort_order, membership.category_id`,
    )
    .all() as JsonMap[];
  const memberships = new Map<string, ClassificationMembership[]>();
  for (const row of rows) {
    const targetRevisionId = text(row.target_revision_id);
    const items = memberships.get(targetRevisionId) ?? [];
    const categoryId = resolveReplacement(text(row.category_id), replacements);
    if (!items.some((item) => item.categoryId === categoryId)) {
      items.push({ categoryId, sortOrder: Number(row.sort_order) });
    }
    memberships.set(targetRevisionId, items);
  }
  for (const items of memberships.values()) {
    items.sort((left, right) => left.sortOrder - right.sortOrder || left.categoryId.localeCompare(right.categoryId));
  }
  return memberships;
}

function loadPlacements(storage: LibraryStorage, replacements: ReadonlyMap<string, string>) {
  const rows = storage.db
    .prepare(
      `SELECT plan.term_id, placement.primary_category_id
      FROM ${revisionPlanTable} plan
      JOIN term_directory_placements placement ON placement.term_id = plan.term_id`,
    )
    .all() as JsonMap[];
  return rows.map((row): DirectoryPlacement => ({
    termId: text(row.term_id),
    primaryCategoryId: resolveReplacement(text(row.primary_category_id), replacements),
  }));
}

function loadCategoryFacets(storage: LibraryStorage, categoryIds: ReadonlySet<string>) {
  const { db } = storage;
  db.prepare(`DELETE FROM ${affectedCategoriesTable}`).run();
  const insertCategory = db.prepare(`INSERT INTO ${affectedCategoriesTable}(category_id) VALUES (?)`);
  for (const categoryId of categoryIds) insertCategory.run(categoryId);
  const rows = db
    .prepare(
      `SELECT category.id, category.primary_facet_value_id, category.secondary_facet_value_id
      FROM term_categories category
      JOIN ${affectedCategoriesTable} selected ON selected.category_id = category.id`,
    )
    .all() as JsonMap[];
  const facets = new Map<string, CategoryFacets>();
  for (const row of rows) {
    facets.set(text(row.id), {
      primaryFacetValueId: text(row.primary_facet_value_id),
      secondaryFacetValueId: row.secondary_facet_value_id ? text(row.secondary_facet_value_id) : null,
    });
  }
  if (facets.size !== categoryIds.size) throw new Error('Classification mutation references a missing category');
  return facets;
}

function copyMembershipsAndFacets(
  storage: LibraryStorage,
  memberships: ReadonlyMap<string, readonly ClassificationMembership[]>,
  categoryFacets: ReadonlyMap<string, CategoryFacets>,
) {
  const { db } = storage;
  const nonClassificationFacets = db
    .prepare(
      `SELECT plan.target_revision_id, assignment.facet_value_id
      FROM ${revisionPlanTable} plan
      JOIN term_facet_assignments assignment ON assignment.term_revision_id = plan.source_revision_id
      JOIN facet_values value ON value.id = assignment.facet_value_id
      JOIN facet_definitions definition ON definition.id = value.definition_id
      WHERE definition.system_role IS NULL`,
    )
    .all() as JsonMap[];
  const facetIdsByRevision = new Map<string, Set<string>>();
  for (const row of nonClassificationFacets) {
    const revisionId = text(row.target_revision_id);
    const values = facetIdsByRevision.get(revisionId) ?? new Set<string>();
    values.add(text(row.facet_value_id));
    facetIdsByRevision.set(revisionId, values);
  }
  const insertMembership = db.prepare(
    'INSERT INTO term_revision_categories(id, term_revision_id, category_id, sort_order) VALUES (?, ?, ?, ?)',
  );
  const insertFacet = db.prepare(
    'INSERT INTO term_facet_assignments(id, term_revision_id, facet_value_id) VALUES (?, ?, ?)',
  );
  for (const [revisionId, items] of memberships) {
    const facetIds = facetIdsByRevision.get(revisionId) ?? new Set<string>();
    for (const [sortOrder, membership] of items.entries()) {
      insertMembership.run(ulid(), revisionId, membership.categoryId, sortOrder);
      const category = categoryFacets.get(membership.categoryId);
      if (!category) throw new Error('Classification facet projection is unavailable');
      facetIds.add(category.primaryFacetValueId);
      if (category.secondaryFacetValueId) facetIds.add(category.secondaryFacetValueId);
    }
    for (const facetId of facetIds) insertFacet.run(ulid(), revisionId, facetId);
  }
}

function updatePlacements(
  storage: LibraryStorage,
  placements: readonly DirectoryPlacement[],
  categoryFacets: ReadonlyMap<string, CategoryFacets>,
  timestamp: string,
) {
  const update = storage.db.prepare(
    `UPDATE term_directory_placements
    SET primary_category_id = ?, domain_facet_value_id = ?, item_type_facet_value_id = ?, updated_at = ?
    WHERE term_id = ?`,
  );
  for (const placement of placements) {
    const facets = categoryFacets.get(placement.primaryCategoryId);
    if (!facets) throw new Error('Primary directory classification is unavailable');
    update.run(
      placement.primaryCategoryId,
      facets.primaryFacetValueId,
      facets.secondaryFacetValueId,
      timestamp,
      placement.termId,
    );
  }
}

function classificationMutationContentHashes(storage: LibraryStorage) {
  const hashes = new Map<string, ReturnType<typeof createHash>>();
  const appendRows = (label: string, rows: JsonMap[], values: (row: JsonMap) => unknown[]) => {
    for (const row of rows) {
      const termId = text(row.term_id);
      const hash = hashes.get(termId) ?? createHash('sha256');
      hash.update(JSON.stringify([label, ...values(row)]));
      hashes.set(termId, hash);
    }
  };
  appendRows(
    'revision',
    storage.db
      .prepare(
        `SELECT plan.term_id, revision.title, revision.title_locale, revision.definition
        FROM ${revisionPlanTable} plan
        JOIN term_revisions revision ON revision.id = plan.target_revision_id
        ORDER BY plan.term_id`,
      )
      .all() as JsonMap[],
    (row) => [row.title, row.title_locale, row.definition],
  );
  const orderedRelations: Array<{ label: string; sql: string; values(row: JsonMap): unknown[] }> = [
    {
      label: 'alias',
      sql: `SELECT plan.term_id, alias.locale, alias.value, alias.normalized_value
        FROM ${revisionPlanTable} plan
        JOIN term_aliases alias ON alias.term_revision_id = plan.target_revision_id
        ORDER BY plan.term_id, alias.locale, alias.normalized_value, alias.value`,
      values: (row) => [row.locale, row.value, row.normalized_value],
    },
    {
      label: 'localization',
      sql: `SELECT plan.term_id, localization.locale, localization.title, localization.definition
        FROM ${revisionPlanTable} plan
        JOIN term_localizations localization ON localization.term_revision_id = plan.target_revision_id
        ORDER BY plan.term_id, localization.locale`,
      values: (row) => [row.locale, row.title, row.definition],
    },
    {
      label: 'profile',
      sql: `SELECT plan.term_id, profile.stable_key, profile_revision.definition,
          profile_revision.exclusion_boundary
        FROM ${revisionPlanTable} plan
        JOIN term_context_profile_revisions profile_revision
          ON profile_revision.term_revision_id = plan.target_revision_id
        JOIN term_context_profiles profile ON profile.id = profile_revision.context_profile_id
        ORDER BY plan.term_id, profile.stable_key`,
      values: (row) => [row.stable_key, row.definition, row.exclusion_boundary],
    },
    {
      label: 'expression',
      sql: `SELECT plan.term_id, profile.stable_key, expression.model_key, expression.locale,
          expression.positive_expression, expression.negative_expression
        FROM ${revisionPlanTable} plan
        JOIN term_expressions expression ON expression.term_revision_id = plan.target_revision_id
        JOIN term_context_profile_revisions profile_revision
          ON profile_revision.id = expression.context_profile_revision_id
        JOIN term_context_profiles profile ON profile.id = profile_revision.context_profile_id
        ORDER BY plan.term_id, profile.stable_key, expression.model_key, expression.locale`,
      values: (row) => [row.stable_key, row.model_key, row.locale, row.positive_expression, row.negative_expression],
    },
    {
      label: 'classification',
      sql: `SELECT plan.term_id, membership.category_id, membership.sort_order
        FROM ${revisionPlanTable} plan
        JOIN term_revision_categories membership ON membership.term_revision_id = plan.target_revision_id
        ORDER BY plan.term_id, membership.sort_order, membership.category_id`,
      values: (row) => [row.category_id, row.sort_order],
    },
    {
      label: 'facet',
      sql: `SELECT plan.term_id, assignment.facet_value_id
        FROM ${revisionPlanTable} plan
        JOIN term_facet_assignments assignment ON assignment.term_revision_id = plan.target_revision_id
        JOIN facet_values value ON value.id = assignment.facet_value_id
        JOIN facet_definitions definition ON definition.id = value.definition_id
        WHERE definition.system_role IS NULL
        ORDER BY plan.term_id, assignment.facet_value_id`,
      values: (row) => [row.facet_value_id],
    },
    {
      label: 'placement',
      sql: `SELECT plan.term_id, placement.primary_category_id,
          placement.domain_facet_value_id, placement.item_type_facet_value_id
        FROM ${revisionPlanTable} plan
        JOIN term_directory_placements placement ON placement.term_id = plan.term_id
        ORDER BY plan.term_id`,
      values: (row) => [row.primary_category_id, row.domain_facet_value_id, row.item_type_facet_value_id],
    },
  ];
  for (const relation of orderedRelations) {
    appendRows(relation.label, storage.db.prepare(relation.sql).all() as JsonMap[], relation.values);
  }
  return new Map([...hashes].map(([termId, hash]) => [termId, `sha256:${hash.digest('hex')}`]));
}

function upsertClassificationTermOverrides(
  storage: LibraryStorage,
  contentHashes: ReadonlyMap<string, string>,
  timestamp: string,
) {
  const space = storage.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').get() as JsonMap | undefined;
  if (!space) throw new Error('Local space is unavailable');
  const spaceId = text(space.id);
  const rows = storage.db
    .prepare(
      `WITH base_items AS (
        SELECT plan.term_id, plan.source_revision_id, plan.target_revision_id,
          plan.target_revision_no, link.release_item_id AS base_release_item_id
        FROM ${revisionPlanTable} plan
        JOIN pack_object_links link
          ON link.local_object_type = 'TERM'
          AND link.local_object_id = plan.term_id
          AND link.local_revision_id = plan.source_revision_id
          AND link.deleted_at IS NULL
        UNION
        SELECT plan.term_id, plan.source_revision_id, plan.target_revision_id,
          plan.target_revision_no, existing_base.base_release_item_id
        FROM ${revisionPlanTable} plan
        JOIN term_revisions previous_revision ON previous_revision.term_id = plan.term_id
        JOIN local_overrides existing_base
          ON existing_base.local_object_type = 'TERM'
          AND existing_base.local_revision_id = previous_revision.id
          AND existing_base.override_kind = 'REPLACE'
          AND existing_base.scope_type = 'SPACE'
          AND existing_base.scope_id = ''
          AND existing_base.state <> 'SUPERSEDED'
          AND existing_base.deleted_at IS NULL
      )
      SELECT base_items.*, active_override.id AS override_id
      FROM base_items
      LEFT JOIN local_overrides active_override
        ON active_override.space_id = ?
        AND active_override.base_release_item_id = base_items.base_release_item_id
        AND active_override.override_kind = 'REPLACE'
        AND active_override.scope_type = 'SPACE'
        AND active_override.scope_id = ''
        AND active_override.deleted_at IS NULL
      ORDER BY base_items.term_id, base_items.base_release_item_id`,
    )
    .all(spaceId) as JsonMap[];
  const update = storage.db.prepare(
    `UPDATE local_overrides
    SET local_object_type = 'TERM', local_revision_id = ?, local_content_hash = ?,
      patch_json = ?, state = 'ACTIVE', updated_at = ?
    WHERE id = ?`,
  );
  const insert = storage.db.prepare(
    `INSERT INTO local_overrides(
      id, space_id, base_release_item_id, override_kind, local_object_type,
      local_revision_id, local_content_hash, patch_json, scope_type, scope_id,
      state, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, 'REPLACE', 'TERM', ?, ?, ?, 'SPACE', '', 'ACTIVE', ?, ?, NULL)`,
  );
  for (const row of rows) {
    const termId = text(row.term_id);
    const contentHash = contentHashes.get(termId);
    if (!contentHash) throw new Error('Classification mutation content hash is unavailable');
    const overrideId = row.override_id ? text(row.override_id) : ulid();
    const patch = JSON.stringify({
      termId,
      baseRevisionId: text(row.source_revision_id),
      revisionNo: Number(row.target_revision_no),
    });
    if (row.override_id) {
      update.run(row.target_revision_id, contentHash, patch, timestamp, overrideId);
    } else {
      insert.run(
        overrideId,
        spaceId,
        row.base_release_item_id,
        row.target_revision_id,
        contentHash,
        patch,
        timestamp,
        timestamp,
      );
    }
    storage.recordChange('LOCAL_OVERRIDE', overrideId, row.override_id ? 'UPDATE' : 'CREATE', {
      termId,
      baseReleaseItemId: text(row.base_release_item_id),
      scopeType: 'SPACE',
      reason: 'CLASSIFICATION_MUTATION',
    });
  }
}

function activateRevisionPlans(storage: LibraryStorage, plans: readonly RevisionPlan[], reason: string) {
  storage.db
    .prepare(
      `UPDATE terms
      SET current_revision_id = (
        SELECT plan.target_revision_id FROM ${revisionPlanTable} plan WHERE plan.term_id = terms.id
      )
      WHERE id IN (SELECT term_id FROM ${revisionPlanTable})`,
    )
    .run();
  for (const plan of plans) {
    storage.recordChange(
      'TERM',
      plan.termId,
      'UPDATE_CLASSIFICATION',
      { revisionId: plan.targetRevisionId, revisionNo: plan.targetRevisionNo, reason },
      { affectsFileView: true },
    );
  }
}

function clearRevisionPlanningTables(storage: LibraryStorage) {
  storage.db.prepare(`DELETE FROM ${revisionPlanTable}`).run();
  storage.db.prepare(`DELETE FROM ${affectedCategoriesTable}`).run();
}

export function cloneRevisionsForClassificationMutation(
  storage: LibraryStorage,
  affectedCategoryIds: readonly string[],
  replacements: ReadonlyMap<string, string>,
  reason: 'CLASSIFICATION_MERGE' | 'CLASSIFICATION_MOVE' | 'CLASSIFICATION_RESTORE_SOURCE',
) {
  if (!affectedCategoryIds.length) return;
  const plans = prepareRevisionPlans(storage, affectedCategoryIds);
  try {
    if (!plans.length) return;
    const timestamp = now();
    copyRevisionCore(storage, timestamp);
    copyContextProfiles(storage, timestamp);
    const memberships = loadMemberships(storage, replacements);
    const placements = loadPlacements(storage, replacements);
    const categoryIds = new Set<string>(placements.map((placement) => placement.primaryCategoryId));
    for (const items of memberships.values()) {
      for (const membership of items) categoryIds.add(membership.categoryId);
    }
    const categoryFacets = loadCategoryFacets(storage, categoryIds);
    copyMembershipsAndFacets(storage, memberships, categoryFacets);
    updatePlacements(storage, placements, categoryFacets, timestamp);
    upsertClassificationTermOverrides(storage, classificationMutationContentHashes(storage), timestamp);
    activateRevisionPlans(storage, plans, reason);
  } finally {
    clearRevisionPlanningTables(storage);
  }
}
