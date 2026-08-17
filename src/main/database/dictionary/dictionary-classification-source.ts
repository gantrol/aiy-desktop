import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  DictionaryClassificationLocalizationDto,
  DictionaryClassificationSourceSnapshotDto,
} from '@/shared/contracts';
import type { ClassificationRow } from '@/main/database/dictionary/dictionary-classification-types';
import { type JsonMap, now, text } from '@/main/database/core/values';

export function parseCategorySourceSnapshot(value: unknown): DictionaryClassificationSourceSnapshotDto | null {
  try {
    const patch = JSON.parse(text(value)) as JsonMap;
    const source = patch.source as JsonMap | undefined;
    if (!source || typeof source !== 'object') return null;
    const localizations = Array.isArray(source.localizations)
      ? source.localizations
          .filter((item): item is JsonMap => Boolean(item) && typeof item === 'object')
          .map((item) => ({ locale: text(item.locale), name: text(item.name) }))
          .filter((item) => item.locale && item.name)
      : [];
    const name = text(source.name);
    const nameLocale = text(source.nameLocale);
    const primaryFacetValueId = text(source.primaryFacetValueId);
    if (!name || !nameLocale || !primaryFacetValueId) return null;
    return {
      parentId: source.parentId === null ? null : text(source.parentId) || null,
      name,
      nameLocale,
      localizations,
      sortOrder: Number(source.sortOrder) || 0,
      state: source.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
      primaryFacetValueId,
      secondaryFacetValueId: source.secondaryFacetValueId === null ? null : text(source.secondaryFacetValueId) || null,
    };
  } catch {
    return null;
  }
}

export function categorySourceSnapshotMap(db: Database.Database) {
  const result = new Map<string, DictionaryClassificationSourceSnapshotDto>();
  const rows = db
    .prepare(
      `SELECT base_release_item_id, patch_json
      FROM local_overrides
      WHERE local_object_type = 'TERM_CATEGORY'
        AND override_kind = 'REPLACE'
        AND scope_type = 'SPACE'
        AND scope_id = ''
        AND deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC`,
    )
    .all() as JsonMap[];
  for (const row of rows) {
    const categoryId = text(row.base_release_item_id);
    if (result.has(categoryId)) continue;
    const snapshot = parseCategorySourceSnapshot(row.patch_json);
    if (snapshot) result.set(categoryId, snapshot);
  }
  return result;
}

export function captureCategorySourceSnapshots(
  db: Database.Database,
  ids: readonly string[],
  rows: Map<string, ClassificationRow>,
  localizationsById: Map<string, DictionaryClassificationLocalizationDto[]>,
) {
  const existing = categorySourceSnapshotMap(db);
  const spaceId = db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() as string | undefined;
  if (!spaceId) throw new Error('Local space is not initialized');
  const insert = db.prepare(
    `INSERT INTO local_overrides(
      id, space_id, base_release_item_id, override_kind,
      local_object_type, local_revision_id, local_content_hash, patch_json,
      scope_type, scope_id, state, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, 'REPLACE', 'TERM_CATEGORY', ?, '', ?, 'SPACE', '', 'ACTIVE', ?, ?, NULL)`,
  );
  for (const id of new Set(ids)) {
    const row = rows.get(id);
    if (!row || row.source_type !== 'CONTENT_PACK' || Boolean(row.modified_locally) || existing.has(id)) continue;
    const snapshot: DictionaryClassificationSourceSnapshotDto = {
      parentId: row.parent_id ? text(row.parent_id) : null,
      name: text(row.name),
      nameLocale: text(row.name_locale),
      localizations: localizationsById.get(id) ?? [],
      sortOrder: Number(row.sort_order),
      state: row.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
      primaryFacetValueId: text(row.primary_facet_value_id),
      secondaryFacetValueId: row.secondary_facet_value_id ? text(row.secondary_facet_value_id) : null,
    };
    const createdAt = now();
    insert.run(ulid(), spaceId, id, id, JSON.stringify({ source: snapshot }), createdAt, createdAt);
    existing.set(id, snapshot);
  }
}
