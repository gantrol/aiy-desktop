import { ulid } from 'ulid';
import type {
  DictionaryClassificationCreateInput,
  DictionaryClassificationMergeConflictDto,
  DictionaryClassificationMergeConflictResolutionDto,
  DictionaryClassificationMergeInput,
  DictionaryClassificationMergePreviewDto,
  DictionaryClassificationMoveInput,
  DictionaryClassificationMovePreviewDto,
  DictionaryClassificationNodeDto,
  DictionaryClassificationReorderInput,
  DictionaryClassificationRestoreSourceInput,
  DictionaryClassificationSetStateInput,
  DictionaryClassificationLocalizationDto,
  DictionaryClassificationTermsDto,
  DictionaryClassificationTermsInput,
  DictionaryClassificationTreeDto,
  DictionaryClassificationUpdateInput,
  Locale,
} from '@/shared/contracts';
import {
  cloneRevisionsForClassificationMutation,
  replaceDraftClassifications,
} from '@/main/database/dictionary/dictionary-classification-merge';
import {
  assertClassificationMergeTarget,
  assertClassificationMoveTarget,
  classificationRootRow,
  classificationSubtreeIds,
} from '@/main/database/dictionary/dictionary-classification-hierarchy';
import { DictionaryClassificationNames } from '@/main/database/dictionary/dictionary-classification-names';
import {
  captureCategorySourceSnapshots,
  categorySourceSnapshotMap,
  parseCategorySourceSnapshot,
} from '@/main/database/dictionary/dictionary-classification-source';
import type {
  ClassificationNames,
  ClassificationRow,
} from '@/main/database/dictionary/dictionary-classification-types';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';

const ROOT_KEY = '__root__';

function parentKey(parentId: string | null) {
  return parentId ?? ROOT_KEY;
}

function localeMatches(candidate: string, requested: string) {
  const left = candidate.trim().toLocaleLowerCase();
  const right = requested.trim().toLocaleLowerCase();
  return left === right || left.split('-')[0] === right.split('-')[0];
}

function localizedName(
  row: ClassificationRow,
  locale: Locale,
  localizations: DictionaryClassificationLocalizationDto[],
) {
  if (localeMatches(text(row.name_locale), locale)) return text(row.name).trim();
  return (
    localizations.find((item) => localeMatches(item.locale, locale))?.name.trim() ||
    text(row.name).trim() ||
    text(row.stable_key)
  );
}

export class DictionaryClassificationRepository {
  private readonly names: DictionaryClassificationNames;

  constructor(private readonly storage: LibraryStorage) {
    this.names = new DictionaryClassificationNames(storage);
  }

  private get db() {
    return this.storage.db;
  }

  list(locale: Locale): DictionaryClassificationTreeDto {
    const rows = this.classificationRows();
    const localizationsById = this.names.localizations();
    const countRows = this.db
      .prepare(
        `WITH RECURSIVE category_descendants(ancestor_id, descendant_id) AS (
          SELECT id, id FROM term_categories
          UNION
          SELECT descendants.ancestor_id, child.id
          FROM category_descendants descendants
          JOIN term_categories child ON child.parent_id = descendants.descendant_id
        )
        SELECT descendants.ancestor_id AS category_id,
          count(DISTINCT CASE
            WHEN descendants.ancestor_id = descendants.descendant_id THEN term.id
          END) AS direct_count,
          count(DISTINCT term.id) AS subtree_count
        FROM category_descendants descendants
        LEFT JOIN term_revision_categories membership
          ON membership.category_id = descendants.descendant_id
        LEFT JOIN terms term
          ON term.current_revision_id = membership.term_revision_id
          AND term.archived_at IS NULL
        GROUP BY descendants.ancestor_id
        UNION ALL
        SELECT ?, 0, count(DISTINCT term.id)
        FROM terms term
        WHERE term.archived_at IS NULL
          AND EXISTS (
            SELECT 1 FROM term_revision_categories membership
            WHERE membership.term_revision_id = term.current_revision_id
          )`,
      )
      .all(ROOT_KEY) as JsonMap[];
    const directCounts = new Map(countRows.map((row) => [text(row.category_id), Number(row.direct_count)]));
    const subtreeCounts = new Map(countRows.map((row) => [text(row.category_id), Number(row.subtree_count)]));
    const byId = new Map(rows.map((row) => [text(row.id), row]));
    const childrenByParent = new Map<string, ClassificationRow[]>();
    for (const row of rows) {
      const parentId = row.parent_id ? text(row.parent_id) : null;
      const children = childrenByParent.get(parentKey(parentId)) ?? [];
      children.push(row);
      childrenByParent.set(parentKey(parentId), children);
    }
    for (const children of childrenByParent.values()) {
      children.sort(
        (left, right) =>
          Number(left.sort_order) - Number(right.sort_order) ||
          text(left.stable_key).localeCompare(text(right.stable_key)),
      );
    }

    const lineage = (row: ClassificationRow) => {
      const chain: ClassificationRow[] = [];
      const visited = new Set<string>();
      let current: ClassificationRow | undefined = row;
      while (current && !visited.has(text(current.id))) {
        visited.add(text(current.id));
        chain.unshift(current);
        current = current.parent_id ? byId.get(text(current.parent_id)) : undefined;
      }
      return chain;
    };

    const nodes: DictionaryClassificationNodeDto[] = rows.map((row) => {
      const id = text(row.id);
      const chain = lineage(row);
      const localizations = localizationsById.get(id) ?? [];
      return {
        id,
        stableKey: text(row.stable_key),
        parentId: row.parent_id ? text(row.parent_id) : null,
        name: text(row.name),
        nameLocale: text(row.name_locale),
        localizations,
        path: chain.map((item) => localizedName(item, locale, localizationsById.get(text(item.id)) ?? [])).join(' / '),
        depth: Math.max(0, chain.length - 1),
        sortOrder: Number(row.sort_order),
        state: row.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
        sourceType: row.source_type === 'LOCAL' ? 'LOCAL' : 'CONTENT_PACK',
        modifiedLocally: Boolean(row.modified_locally),
        sourceSnapshot: parseCategorySourceSnapshot(row.source_patch_json),
        directTermCount: directCounts.get(id) ?? 0,
        subtreeTermCount: subtreeCounts.get(id) ?? 0,
        childCount: (childrenByParent.get(parentKey(id)) ?? []).length,
      };
    });
    return {
      nodes,
      rootCount: nodes.filter((node) => node.parentId === null).length,
      categoryCount: nodes.length,
      termCount: subtreeCounts.get(ROOT_KEY) ?? 0,
    };
  }

  listTerms(input: DictionaryClassificationTermsInput): DictionaryClassificationTermsDto {
    const tree = this.list(input.locale);
    if (!tree.nodes.some((node) => node.id === input.classificationId)) throw new Error('Classification not found');
    const selectedIds = input.includeDescendants
      ? classificationSubtreeIds(input.classificationId, this.rowMap())
      : [input.classificationId];
    const placeholders = selectedIds.map(() => '?').join(',');
    const query = input.query.trim();
    const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const querySql = query
      ? `AND (revision.title LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM term_localizations localization
            WHERE localization.term_revision_id = revision.id
              AND localization.title LIKE ? ESCAPE '\\'
          ))`
      : '';
    const queryParams = query ? [like, like] : [];
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT count(*) AS total
            FROM terms term
            JOIN term_revisions revision ON revision.id = term.current_revision_id
            WHERE term.archived_at IS NULL
              AND EXISTS (
                SELECT 1 FROM term_revision_categories membership
                WHERE membership.term_revision_id = revision.id
                  AND membership.category_id IN (${placeholders})
              )
              ${querySql}`,
          )
          .get(...selectedIds, ...queryParams) as JsonMap
      ).total,
    );
    const rows = this.db
      .prepare(
        `SELECT DISTINCT term.id, term.editorial_state,
          COALESCE(localization.title, revision.title) AS title
        FROM terms term
        JOIN term_revisions revision ON revision.id = term.current_revision_id
        LEFT JOIN term_localizations localization
          ON localization.term_revision_id = revision.id AND localization.locale = ?
        WHERE term.archived_at IS NULL
          AND EXISTS (
            SELECT 1 FROM term_revision_categories membership
            WHERE membership.term_revision_id = revision.id
              AND membership.category_id IN (${placeholders})
          )
          ${querySql}
        ORDER BY title COLLATE NOCASE, term.id
        LIMIT ?`,
      )
      .all(input.locale, ...selectedIds, ...queryParams, input.limit) as JsonMap[];
    const pathById = new Map(tree.nodes.map((node) => [node.id, node.path]));
    const memberships = rows.length
      ? (this.db
          .prepare(
            `SELECT term.id AS term_id, membership.category_id
            FROM terms term
            JOIN term_revision_categories membership ON membership.term_revision_id = term.current_revision_id
            WHERE term.id IN (${rows.map(() => '?').join(',')})
            ORDER BY membership.sort_order, membership.category_id`,
          )
          .all(...rows.map((row) => row.id)) as JsonMap[])
      : [];
    const classificationIdsByTerm = new Map<string, string[]>();
    for (const membership of memberships) {
      const ids = classificationIdsByTerm.get(text(membership.term_id)) ?? [];
      ids.push(text(membership.category_id));
      classificationIdsByTerm.set(text(membership.term_id), ids);
    }
    return {
      total,
      items: rows.map((row) => ({
        id: text(row.id),
        title: text(row.title),
        editorialState: text(
          row.editorial_state,
        ) as DictionaryClassificationTermsDto['items'][number]['editorialState'],
        classificationIds: classificationIdsByTerm.get(text(row.id)) ?? [],
        classificationPaths: (classificationIdsByTerm.get(text(row.id)) ?? []).map((id) => pathById.get(id) ?? ''),
      })),
    };
  }

  create(input: DictionaryClassificationCreateInput): DictionaryClassificationTreeDto {
    const names = this.names.normalize(input.name, input.nameLocale, input.localizations);
    const rows = this.rowMap();
    const parent = input.parentId ? rows.get(input.parentId) : null;
    if (input.parentId && !parent) throw new Error('Parent classification not found');
    if (parent?.state === 'DISABLED') throw new Error('A disabled classification cannot receive a child');
    this.names.assertSiblingUnique(input.parentId, names);
    const categoryId = ulid();
    const stableKey = `category.local.${categoryId.toLowerCase()}`;
    const createdAt = now();
    this.db
      .transaction(() => {
        const primaryFacetValueId = parent
          ? text(classificationRootRow(parent, rows).primary_facet_value_id)
          : this.names.createFacetValue('PRIMARY_CLASSIFICATION', names);
        const secondaryFacetValueId = parent ? this.names.createFacetValue('SECONDARY_CLASSIFICATION', names) : null;
        const sortOrder = this.nextSortOrder(input.parentId);
        this.db
          .prepare(
            `INSERT INTO term_categories(
              id, stable_key, primary_facet_value_id, secondary_facet_value_id,
              parent_id, name, name_locale, sort_order, state, source_type,
              modified_locally, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'LOCAL', 1, ?, ?)`,
          )
          .run(
            categoryId,
            stableKey,
            primaryFacetValueId,
            secondaryFacetValueId,
            input.parentId,
            names.name,
            names.nameLocale,
            sortOrder,
            createdAt,
            createdAt,
          );
        this.names.replaceLocalizations(categoryId, names.localizations);
        this.storage.recordChange('TERM_CATEGORY', categoryId, 'CREATE', { parentId: input.parentId });
      })
      .immediate();
    return this.list(input.locale);
  }

  update(input: DictionaryClassificationUpdateInput): DictionaryClassificationTreeDto {
    const row = this.rowMap().get(input.id);
    if (!row) throw new Error('Classification not found');
    const names = this.names.normalize(input.name, input.nameLocale, input.localizations);
    const parentId = row.parent_id ? text(row.parent_id) : null;
    this.names.assertSiblingUnique(parentId, names, input.id);
    this.db
      .transaction(() => {
        this.captureSourceSnapshots([input.id], this.rowMap());
        this.db
          .prepare(
            `UPDATE term_categories
            SET name = ?, name_locale = ?, modified_locally = 1, updated_at = ?
            WHERE id = ?`,
          )
          .run(names.name, names.nameLocale, now(), input.id);
        this.names.replaceLocalizations(input.id, names.localizations);
        if (row.source_type === 'LOCAL') {
          const facetValueId = row.secondary_facet_value_id
            ? text(row.secondary_facet_value_id)
            : text(row.primary_facet_value_id);
          this.db
            .prepare('UPDATE facet_values SET name_zh = ?, name_en = ? WHERE id = ?')
            .run(this.names.facetName(names, 'zh'), this.names.facetName(names, 'en'), facetValueId);
        }
        this.storage.recordChange('TERM_CATEGORY', input.id, 'UPDATE', {});
      })
      .immediate();
    return this.list(input.locale);
  }

  restoreSource(input: DictionaryClassificationRestoreSourceInput): DictionaryClassificationTreeDto {
    const rows = this.rowMap();
    const row = rows.get(input.id);
    if (!row) throw new Error('Classification not found');
    if (row.source_type !== 'CONTENT_PACK') throw new Error('Local classifications do not have a package source');
    const snapshot = categorySourceSnapshotMap(this.db).get(input.id);
    if (!snapshot) throw new Error('No package source snapshot is available for this classification');
    assertClassificationMoveTarget(input.id, snapshot.parentId, rows);
    this.names.assertSiblingUnique(
      snapshot.parentId,
      { name: snapshot.name, nameLocale: snapshot.nameLocale, localizations: snapshot.localizations },
      input.id,
    );
    const subtreeIds = classificationSubtreeIds(input.id, rows);
    const descendantIds = subtreeIds.filter((id) => id !== input.id);
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `UPDATE term_categories
            SET parent_id = ?, name = ?, name_locale = ?, sort_order = ?, state = ?,
              primary_facet_value_id = ?, secondary_facet_value_id = ?,
              modified_locally = 0, updated_at = ?
            WHERE id = ?`,
          )
          .run(
            snapshot.parentId,
            snapshot.name,
            snapshot.nameLocale,
            snapshot.sortOrder,
            snapshot.state,
            snapshot.primaryFacetValueId,
            snapshot.secondaryFacetValueId,
            now(),
            input.id,
          );
        this.names.replaceLocalizations(input.id, snapshot.localizations);
        if (descendantIds.length) {
          this.db
            .prepare(
              `UPDATE term_categories
              SET primary_facet_value_id = ?, updated_at = ?
              WHERE id IN (${descendantIds.map(() => '?').join(',')})`,
            )
            .run(snapshot.primaryFacetValueId, now(), ...descendantIds);
        }
        cloneRevisionsForClassificationMutation(this.storage, subtreeIds, new Map(), 'CLASSIFICATION_RESTORE_SOURCE');
        const activeOverrides = this.db
          .prepare(
            `SELECT id FROM local_overrides
            WHERE base_release_item_id = ? AND local_object_type = 'TERM_CATEGORY'
              AND override_kind = 'REPLACE' AND scope_type = 'SPACE' AND scope_id = ''
              AND deleted_at IS NULL`,
          )
          .all(input.id) as JsonMap[];
        const restoredAt = now();
        this.db
          .prepare(
            `UPDATE local_overrides
            SET state = 'SUPERSEDED', updated_at = ?, deleted_at = ?
            WHERE base_release_item_id = ? AND local_object_type = 'TERM_CATEGORY'
              AND override_kind = 'REPLACE' AND scope_type = 'SPACE' AND scope_id = ''
              AND deleted_at IS NULL`,
          )
          .run(restoredAt, restoredAt, input.id);
        const insertTombstone = this.db.prepare(
          `INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state)
          VALUES (?, 'LOCAL_OVERRIDE', ?, ?, 'LOCAL_ONLY')`,
        );
        for (const override of activeOverrides) {
          const overrideId = text(override.id);
          insertTombstone.run(ulid(), overrideId, restoredAt);
          this.storage.recordChange('LOCAL_OVERRIDE', overrideId, 'DELETE', {
            reason: 'CLASSIFICATION_RESTORE_SOURCE',
            classificationId: input.id,
          });
        }
        this.storage.recordChange('TERM_CATEGORY', input.id, 'RESTORE_SOURCE', {});
      })
      .immediate();
    return this.list(input.locale);
  }

  previewMove(input: DictionaryClassificationMoveInput): DictionaryClassificationMovePreviewDto {
    const tree = this.list(input.locale);
    const node = tree.nodes.find((item) => item.id === input.id);
    if (!node) throw new Error('Classification not found');
    const target = input.parentId ? tree.nodes.find((item) => item.id === input.parentId) : null;
    if (input.parentId && !target) throw new Error('Target classification not found');
    assertClassificationMoveTarget(input.id, input.parentId, this.rowMap());
    return {
      classificationId: node.id,
      classificationName: node.name,
      currentPath: node.path,
      targetParentId: input.parentId,
      targetPath: target?.path ?? (input.locale === 'zh' ? '大类层' : 'Top level'),
      childClassificationCount: Math.max(0, classificationSubtreeIds(input.id, this.rowMap()).length - 1),
      termCount: node.subtreeTermCount,
    };
  }

  move(input: DictionaryClassificationMoveInput): DictionaryClassificationTreeDto {
    const rows = this.rowMap();
    const row = rows.get(input.id);
    if (!row) throw new Error('Classification not found');
    assertClassificationMoveTarget(input.id, input.parentId, rows);
    const currentParentId = row.parent_id ? text(row.parent_id) : null;
    if (currentParentId === input.parentId) return this.list(input.locale);
    const names = this.names.forRow(row);
    this.names.assertSiblingUnique(input.parentId, names, input.id);
    const subtreeIds = classificationSubtreeIds(input.id, rows);
    const targetParent = input.parentId ? rows.get(input.parentId) : null;
    this.db
      .transaction(() => {
        this.captureSourceSnapshots(subtreeIds, rows);
        let primaryFacetValueId: string;
        let secondaryFacetValueId = row.secondary_facet_value_id ? text(row.secondary_facet_value_id) : null;
        if (targetParent) {
          primaryFacetValueId = text(classificationRootRow(targetParent, rows).primary_facet_value_id);
          if (!secondaryFacetValueId) {
            secondaryFacetValueId = this.names.createFacetValue('SECONDARY_CLASSIFICATION', names);
          }
        } else {
          primaryFacetValueId = this.names.createFacetValue('PRIMARY_CLASSIFICATION', names);
          secondaryFacetValueId = null;
        }
        this.db
          .prepare(
            `UPDATE term_categories
            SET parent_id = ?, primary_facet_value_id = ?, secondary_facet_value_id = ?,
              sort_order = ?, modified_locally = 1, updated_at = ?
            WHERE id = ?`,
          )
          .run(
            input.parentId,
            primaryFacetValueId,
            secondaryFacetValueId,
            this.nextSortOrder(input.parentId),
            now(),
            input.id,
          );
        if (subtreeIds.length > 1) {
          const descendantIds = subtreeIds.filter((id) => id !== input.id);
          this.db
            .prepare(
              `UPDATE term_categories
              SET primary_facet_value_id = ?, modified_locally = 1, updated_at = ?
              WHERE id IN (${descendantIds.map(() => '?').join(',')})`,
            )
            .run(primaryFacetValueId, now(), ...descendantIds);
        }
        cloneRevisionsForClassificationMutation(this.storage, subtreeIds, new Map(), 'CLASSIFICATION_MOVE');
        this.storage.recordChange('TERM_CATEGORY', input.id, 'MOVE', {
          fromParentId: currentParentId,
          toParentId: input.parentId,
        });
      })
      .immediate();
    return this.list(input.locale);
  }

  reorder(input: DictionaryClassificationReorderInput): DictionaryClassificationTreeDto {
    const currentRows = this.classificationRows().filter(
      (row) => (row.parent_id ? text(row.parent_id) : null) === input.parentId,
    );
    const currentIds = currentRows.map((row) => text(row.id));
    const orderedIds = [...new Set(input.orderedIds)];
    if (orderedIds.length !== currentIds.length || currentIds.some((id) => !orderedIds.includes(id))) {
      throw new Error('Classification order is incomplete');
    }
    this.db
      .transaction(() => {
        this.captureSourceSnapshots(orderedIds, this.rowMap());
        const update = this.db.prepare(
          'UPDATE term_categories SET sort_order = ?, modified_locally = 1, updated_at = ? WHERE id = ?',
        );
        for (const [sortOrder, id] of orderedIds.entries()) update.run(sortOrder, now(), id);
        this.storage.recordChange('TERM_CATEGORY', input.parentId ?? ROOT_KEY, 'REORDER', { orderedIds });
      })
      .immediate();
    return this.list(input.locale);
  }

  setState(input: DictionaryClassificationSetStateInput): DictionaryClassificationTreeDto {
    const rows = this.rowMap();
    const row = rows.get(input.id);
    if (!row) throw new Error('Classification not found');
    const subtreeIds = classificationSubtreeIds(input.id, rows);
    const activeDescendantIds = subtreeIds.slice(1).filter((id) => rows.get(id)?.state !== 'DISABLED');
    if (input.state === 'DISABLED' && activeDescendantIds.length && !input.includeDescendants) {
      throw new Error('Disable the complete subtree or move its active child classifications first');
    }
    if (input.state === 'ACTIVE' && row.parent_id && rows.get(text(row.parent_id))?.state === 'DISABLED') {
      throw new Error('Restore the parent classification first');
    }
    const targetIds = input.state === 'DISABLED' && input.includeDescendants ? subtreeIds : [input.id];
    if (targetIds.every((id) => rows.get(id)?.state === input.state)) return this.list(input.locale);
    this.db
      .transaction(() => {
        this.captureSourceSnapshots(targetIds, rows);
        const update = this.db.prepare(
          `UPDATE term_categories
          SET state = ?, modified_locally = 1, updated_at = ?
          WHERE id = ?`,
        );
        const updatedAt = now();
        for (const id of targetIds) update.run(input.state, updatedAt, id);
        this.storage.recordChange('TERM_CATEGORY', input.id, input.state === 'ACTIVE' ? 'RESTORE' : 'DISABLE', {
          includeDescendants: Boolean(input.includeDescendants),
          affectedIds: targetIds,
        });
      })
      .immediate();
    return this.list(input.locale);
  }

  previewMerge(input: DictionaryClassificationMergeInput): DictionaryClassificationMergePreviewDto {
    const tree = this.list(input.locale);
    const source = tree.nodes.find((node) => node.id === input.sourceId);
    const target = tree.nodes.find((node) => node.id === input.targetId);
    if (!source || !target) throw new Error('Classification not found');
    const rows = this.rowMap();
    assertClassificationMergeTarget(input.sourceId, input.targetId, rows);
    return {
      sourceId: source.id,
      sourcePath: source.path,
      targetId: target.id,
      targetPath: target.path,
      directTermCount: source.directTermCount,
      childClassificationCount: source.childCount,
      conflicts: this.mergeConflicts(input.sourceId, input.targetId, rows, input.locale),
    };
  }

  merge(input: DictionaryClassificationMergeInput): DictionaryClassificationTreeDto {
    const rows = this.rowMap();
    const source = rows.get(input.sourceId);
    const target = rows.get(input.targetId);
    if (!source || !target) throw new Error('Classification not found');
    assertClassificationMergeTarget(input.sourceId, input.targetId, rows);
    const conflicts = this.mergeConflicts(input.sourceId, input.targetId, rows, input.locale);
    const resolutions = new Map(
      (input.conflictResolutions ?? []).map((resolution) => [resolution.sourceChildId, resolution]),
    );
    for (const conflict of conflicts) {
      const resolution = resolutions.get(conflict.sourceChildId);
      if (!resolution || resolution.targetChildId !== conflict.targetChildId) {
        throw new Error(`Choose how to resolve the child classification conflict for ${conflict.sourceName}`);
      }
      if (resolution.action === 'RENAME' && !resolution.renamedName?.trim()) {
        throw new Error(`Choose a new name for ${conflict.sourceName}`);
      }
      if (resolution.action === 'MERGE' && rows.get(conflict.targetChildId)?.state === 'DISABLED') {
        throw new Error(`Restore ${conflict.targetName} before merging into it`);
      }
    }
    const subtreeIds = classificationSubtreeIds(input.sourceId, rows);
    const descendantIds = subtreeIds.filter((id) => id !== input.sourceId);
    const targetRoot = classificationRootRow(target, rows);
    const targetPrimaryId = text(targetRoot.primary_facet_value_id);
    this.db
      .transaction(() => {
        this.captureSourceSnapshots(subtreeIds, rows);
        const replacements = new Map<string, string>();
        const conflictsBySource = new Map(conflicts.map((conflict) => [conflict.sourceChildId, conflict]));
        this.mergeCategoryInto(
          input.sourceId,
          input.targetId,
          rows,
          resolutions,
          conflictsBySource,
          replacements,
          'EXPLICIT_MERGE',
        );
        if (descendantIds.length) {
          this.db
            .prepare(
              `UPDATE term_categories
              SET primary_facet_value_id = ?, modified_locally = 1, updated_at = ?
              WHERE id IN (${descendantIds.map(() => '?').join(',')})`,
            )
            .run(targetPrimaryId, now(), ...descendantIds);
        }
        replaceDraftClassifications(this.storage, replacements);
        cloneRevisionsForClassificationMutation(this.storage, subtreeIds, replacements, 'CLASSIFICATION_MERGE');
      })
      .immediate();
    return this.list(input.locale);
  }

  private mergeConflicts(
    sourceId: string,
    targetId: string,
    rows: Map<string, ClassificationRow>,
    locale: Locale,
  ): DictionaryClassificationMergeConflictDto[] {
    const localizationsById = this.names.localizations();
    const childrenByParent = new Map<string, ClassificationRow[]>();
    for (const row of rows.values()) {
      if (!row.parent_id) continue;
      const parentId = text(row.parent_id);
      const children = childrenByParent.get(parentId) ?? [];
      children.push(row);
      childrenByParent.set(parentId, children);
    }
    const conflicts: DictionaryClassificationMergeConflictDto[] = [];
    const pending = [{ sourceParentId: sourceId, targetParentId: targetId }];
    const visited = new Set<string>();
    while (pending.length) {
      const pair = pending.shift()!;
      const pairKey = `${pair.sourceParentId}\u0000${pair.targetParentId}`;
      if (visited.has(pairKey)) continue;
      visited.add(pairKey);
      const targetChildren = childrenByParent.get(pair.targetParentId) ?? [];
      for (const sourceChild of childrenByParent.get(pair.sourceParentId) ?? []) {
        const sourceNames = this.names.forRow(sourceChild, localizationsById);
        const targetChild = targetChildren.find((candidate) =>
          this.names.conflict(this.names.forRow(candidate, localizationsById), sourceNames),
        );
        if (!targetChild) continue;
        const sourceChildId = text(sourceChild.id);
        const targetChildId = text(targetChild.id);
        conflicts.push({
          sourceChildId,
          sourceName: localizedName(sourceChild, locale, sourceNames.localizations),
          targetChildId,
          targetName: localizedName(targetChild, locale, localizationsById.get(targetChildId) ?? []),
        });
        pending.push({ sourceParentId: sourceChildId, targetParentId: targetChildId });
      }
    }
    return conflicts;
  }

  private renameChildForMerge(
    child: ClassificationRow,
    targetParentId: string,
    renamedName: string,
    rows: Map<string, ClassificationRow>,
  ) {
    const original = this.names.forRow(child);
    const renamed: ClassificationNames = {
      name: renamedName.trim(),
      nameLocale: original.nameLocale,
      localizations: original.localizations.map((item) => ({ ...item, name: `${item.name} 2` })),
    };
    this.names.assertSiblingUnique(targetParentId, renamed, text(child.id));
    this.db
      .prepare(
        `UPDATE term_categories
        SET name = ?, modified_locally = 1, updated_at = ?
        WHERE id = ?`,
      )
      .run(renamed.name, now(), child.id);
    this.names.replaceLocalizations(text(child.id), renamed.localizations);
    if (child.source_type === 'LOCAL') {
      const facetValueId = child.secondary_facet_value_id
        ? text(child.secondary_facet_value_id)
        : text(child.primary_facet_value_id);
      this.db
        .prepare('UPDATE facet_values SET name_zh = ?, name_en = ? WHERE id = ?')
        .run(this.names.facetName(renamed, 'zh'), this.names.facetName(renamed, 'en'), facetValueId);
    }
    rows.set(text(child.id), { ...child, name: renamed.name });
  }

  private mergeCategoryInto(
    sourceId: string,
    targetId: string,
    rows: Map<string, ClassificationRow>,
    resolutions: ReadonlyMap<string, DictionaryClassificationMergeConflictResolutionDto>,
    conflictsBySource: ReadonlyMap<string, DictionaryClassificationMergeConflictDto>,
    replacements: Map<string, string>,
    reason: 'EXPLICIT_MERGE' | 'CHILD_NAME_CONFLICT',
  ) {
    const source = rows.get(sourceId);
    const target = rows.get(targetId);
    if (!source || !target) throw new Error('Classification conflict target not found');
    replacements.set(sourceId, targetId);
    const directChildren = [...rows.values()]
      .filter((row) => (row.parent_id ? text(row.parent_id) : null) === sourceId)
      .sort((left, right) => Number(left.sort_order) - Number(right.sort_order));
    let childSortOrder = this.nextSortOrder(targetId);
    const moveChild = this.db.prepare(
      `UPDATE term_categories
      SET parent_id = ?, sort_order = ?, modified_locally = 1, updated_at = ?
      WHERE id = ?`,
    );
    for (const child of directChildren) {
      const childId = text(child.id);
      const conflict = conflictsBySource.get(childId);
      const resolution = conflict ? resolutions.get(childId) : undefined;
      if (conflict && resolution?.action === 'MERGE') {
        this.mergeCategoryInto(
          childId,
          conflict.targetChildId,
          rows,
          resolutions,
          conflictsBySource,
          replacements,
          'CHILD_NAME_CONFLICT',
        );
        continue;
      }
      if (conflict && resolution?.action === 'RENAME') {
        this.renameChildForMerge(child, targetId, resolution.renamedName!, rows);
      }
      moveChild.run(targetId, childSortOrder++, now(), childId);
      const currentChild = rows.get(childId) ?? child;
      rows.set(childId, { ...currentChild, parent_id: targetId });
    }
    this.db
      .prepare(
        `UPDATE term_categories
        SET state = 'DISABLED', modified_locally = 1, updated_at = ?
        WHERE id = ?`,
      )
      .run(now(), sourceId);
    rows.set(sourceId, { ...source, state: 'DISABLED' });
    this.storage.recordChange('TERM_CATEGORY', sourceId, 'MERGE', {
      targetId,
      reason,
    });
  }

  private classificationRows(): ClassificationRow[] {
    return this.db
      .prepare(
        `SELECT category.*, source_override.patch_json AS source_patch_json
        FROM term_categories category
        LEFT JOIN local_overrides source_override
          ON source_override.base_release_item_id = category.id
          AND source_override.local_object_type = 'TERM_CATEGORY'
          AND source_override.override_kind = 'REPLACE'
          AND source_override.scope_type = 'SPACE'
          AND source_override.scope_id = ''
          AND source_override.deleted_at IS NULL
        ORDER BY CASE WHEN category.parent_id IS NULL THEN 0 ELSE 1 END,
          category.sort_order, category.stable_key`,
      )
      .all() as ClassificationRow[];
  }

  private rowMap() {
    return new Map(this.classificationRows().map((row) => [text(row.id), row]));
  }

  private captureSourceSnapshots(ids: readonly string[], rows: Map<string, ClassificationRow>) {
    captureCategorySourceSnapshots(this.db, ids, rows, this.names.localizations());
  }

  private nextSortOrder(parentId: string | null) {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maximum FROM term_categories WHERE parent_id IS ?')
      .get(parentId) as JsonMap;
    return Number(row.maximum) + 1;
  }
}
