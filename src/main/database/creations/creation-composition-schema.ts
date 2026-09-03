import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import removeInspirationParentSeriesSql from '@/main/database/sql/v03-revision-004-remove-inspiration-parent-series.sql?raw';

type EntityKind =
  | 'PROMPT_SERIES'
  | 'IMAGE_BREAKDOWN'
  | 'INSPIRATION_STASH'
  | 'SOCIAL_POST'
  | 'ARTICLE'
  | 'VIDEO_DOCUMENT'
  | 'EVALUATION_SUITE'
  | 'DERIVED_VISUAL';
type PrimaryRole =
  'IMAGE_BREAKDOWN' | 'IMAGE_CREATION' | 'SOCIAL_POST' | 'ARTICLE' | 'VIDEO_DOCUMENT' | 'EVALUATION_SUITE';
type FormRole = PrimaryRole | 'INSPIRATION' | 'SOCIAL_POST_COVER' | 'ARTICLE_HEADER' | 'ARTICLE_INLINE';
type DerivedVisualRole = 'SOCIAL_POST_COVER' | 'ARTICLE_HEADER' | 'ARTICLE_INLINE';

interface Row {
  [key: string]: unknown;
}

const primaryRoles = new Set<FormRole>([
  'IMAGE_BREAKDOWN',
  'IMAGE_CREATION',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'EVALUATION_SUITE',
]);

function text(value: unknown) {
  if (typeof value !== 'string') throw new Error('Creation composition contains an invalid identifier');
  return value;
}

function tableColumns(db: Database.Database, table: string) {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
}

function formForEntity(db: Database.Database, entityType: EntityKind, entityId: string) {
  return db
    .prepare(
      `SELECT * FROM creation_forms
      WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL`,
    )
    .get(entityType, entityId) as Row | undefined;
}

function storedFormForEntity(db: Database.Database, entityType: EntityKind, entityId: string) {
  return db
    .prepare(
      `SELECT * FROM creation_forms
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY deleted_at IS NULL DESC, created_at, id LIMIT 1`,
    )
    .get(entityType, entityId) as Row | undefined;
}

function formForRole(db: Database.Database, creationItemId: string, role: FormRole, anchorKey: string | null) {
  return db
    .prepare(
      `SELECT * FROM creation_forms
      WHERE creation_item_id = ? AND role = ? AND anchor_key IS ? AND deleted_at IS NULL`,
    )
    .get(creationItemId, role, role === 'ARTICLE_INLINE' ? anchorKey : null) as Row | undefined;
}

function nextFormSortOrder(db: Database.Database, creationItemId: string) {
  return Number(
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM creation_forms
        WHERE creation_item_id = ? AND deleted_at IS NULL`,
      )
      .pluck()
      .get(creationItemId),
  );
}

function stableItemId(entityType: EntityKind, entityId: string) {
  return `creation-item:${entityType.toLowerCase().replaceAll('_', '-')}:${entityId}`;
}

function stableFormId(entityType: EntityKind, entityId: string) {
  return `creation-form:${entityType.toLowerCase().replaceAll('_', '-')}:${entityId}`;
}

function addForm(
  db: Database.Database,
  input: {
    creationItemId: string;
    role: FormRole;
    entityType: EntityKind;
    entityId: string;
    anchorKey: string | null;
    createdAt: string;
    updatedAt: string;
  },
) {
  const claimed = formForEntity(db, input.entityType, input.entityId);
  if (claimed) return claimed;
  const existingRole = formForRole(db, input.creationItemId, input.role, input.anchorKey);
  if (existingRole) throw new Error('Cannot normalize two entities into the same creation form role');
  const item = db
    .prepare('SELECT phase, primary_form_id FROM creation_items WHERE id = ? AND deleted_at IS NULL')
    .get(input.creationItemId) as Row | undefined;
  if (!item) throw new Error('Cannot normalize a form without its creation item');

  const formId = stableFormId(input.entityType, input.entityId);
  const conflictingId = db.prepare('SELECT entity_type, entity_id FROM creation_forms WHERE id = ?').get(formId) as
    Row | undefined;
  if (conflictingId) throw new Error('A deterministic creation form identifier is already in use');
  db.prepare(
    `INSERT INTO creation_forms (
      id, creation_item_id, role, entity_type, entity_id, anchor_key,
      sort_order, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    formId,
    input.creationItemId,
    input.role,
    input.entityType,
    input.entityId,
    input.anchorKey,
    nextFormSortOrder(db, input.creationItemId),
    input.createdAt,
    input.updatedAt,
  );

  if (text(item.phase) === 'DRAFT' && primaryRoles.has(input.role)) {
    db.prepare(
      `UPDATE creation_items
      SET phase = 'ACTIVE', primary_form_id = ?, updated_at = ? WHERE id = ?`,
    ).run(formId, input.updatedAt, input.creationItemId);
  } else {
    db.prepare(
      `UPDATE creation_items
      SET updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END WHERE id = ?`,
    ).run(input.updatedAt, input.updatedAt, input.creationItemId);
  }
  return db.prepare('SELECT * FROM creation_forms WHERE id = ?').get(formId) as Row;
}

function createItemWithForm(
  db: Database.Database,
  input: {
    role: 'INSPIRATION' | PrimaryRole;
    entityType: Exclude<EntityKind, 'DERIVED_VISUAL'>;
    entityId: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    deletedAt?: string | null;
  },
) {
  const existing = storedFormForEntity(db, input.entityType, input.entityId);
  if (existing) return existing;
  const itemId = stableItemId(input.entityType, input.entityId);
  const conflictingItem = db.prepare('SELECT 1 FROM creation_items WHERE id = ?').get(itemId);
  if (conflictingItem) throw new Error('A deterministic creation item identifier is already in use');
  db.prepare(
    `INSERT INTO creation_items (
      id, phase, primary_form_id, created_at, updated_at, archived_at, deleted_at
    ) VALUES (?, 'DRAFT', NULL, ?, ?, ?, NULL)`,
  ).run(itemId, input.createdAt, input.updatedAt, input.archivedAt);
  const form = addForm(db, { ...input, creationItemId: itemId, anchorKey: null });
  if (!input.deletedAt) return form;
  db.prepare('UPDATE creation_forms SET updated_at = ?, deleted_at = ? WHERE id = ?').run(
    input.deletedAt,
    input.deletedAt,
    text(form.id),
  );
  db.prepare('UPDATE creation_items SET updated_at = ?, deleted_at = ? WHERE id = ?').run(
    input.deletedAt,
    input.deletedAt,
    itemId,
  );
  return db.prepare('SELECT * FROM creation_forms WHERE id = ?').get(text(form.id)) as Row;
}

function parentItemForInspiration(db: Database.Database, parentSeriesId: string | null) {
  if (!parentSeriesId) return null;
  const form = formForEntity(db, 'PROMPT_SERIES', parentSeriesId);
  return form ? text(form.creation_item_id) : null;
}

function ensurePrimaryEntityForms(db: Database.Database) {
  const derivedSeries = new Set(
    (db.prepare('SELECT prompt_series_id FROM derived_visuals WHERE prompt_series_id IS NOT NULL').all() as Row[]).map(
      (row) => text(row.prompt_series_id),
    ),
  );
  const seriesArchivedAt = tableColumns(db, 'prompt_series').has('archived_at') ? 'archived_at' : 'NULL AS archived_at';
  const seriesRows = db
    .prepare(
      `SELECT id, created_at, deleted_at, ${seriesArchivedAt} FROM prompt_series
      ORDER BY created_at, id`,
    )
    .all() as Row[];
  for (const row of seriesRows) {
    const id = text(row.id);
    if (derivedSeries.has(id) || formForEntity(db, 'PROMPT_SERIES', id)) continue;
    createItemWithForm(db, {
      role: 'IMAGE_CREATION',
      entityType: 'PROMPT_SERIES',
      entityId: id,
      createdAt: text(row.created_at),
      updatedAt: text(row.created_at),
      archivedAt: row.archived_at == null ? null : text(row.archived_at),
      deletedAt: row.deleted_at == null ? null : text(row.deleted_at),
    });
  }

  const documentRows = db
    .prepare(
      `SELECT id, created_at, updated_at, archived_at, deleted_at FROM documents
      ORDER BY created_at, id`,
    )
    .all() as Row[];
  for (const row of documentRows) {
    const id = text(row.id);
    if (formForEntity(db, 'VIDEO_DOCUMENT', id)) continue;
    createItemWithForm(db, {
      role: 'VIDEO_DOCUMENT',
      entityType: 'VIDEO_DOCUMENT',
      entityId: id,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      archivedAt: row.archived_at == null ? null : text(row.archived_at),
      deletedAt: row.deleted_at == null ? null : text(row.deleted_at),
    });
  }

  const evaluationRows = db
    .prepare(
      `SELECT id, created_at, updated_at, archived_at, deleted_at FROM evaluation_suites
      ORDER BY created_at, id`,
    )
    .all() as Row[];
  for (const row of evaluationRows) {
    const id = text(row.id);
    if (formForEntity(db, 'EVALUATION_SUITE', id)) continue;
    createItemWithForm(db, {
      role: 'EVALUATION_SUITE',
      entityType: 'EVALUATION_SUITE',
      entityId: id,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      archivedAt: row.archived_at == null ? null : text(row.archived_at),
      deletedAt: row.deleted_at == null ? null : text(row.deleted_at),
    });
  }
}

function ensureInspirationForms(db: Database.Database) {
  const hasLegacyParent = tableColumns(db, 'inspiration_stashes').has('parent_series_id');
  const rows = db
    .prepare(
      `SELECT id, created_at, updated_at, archived_at${hasLegacyParent ? ', parent_series_id' : ''}
      FROM inspiration_stashes WHERE deleted_at IS NULL ORDER BY created_at, id`,
    )
    .all() as Row[];
  for (const row of rows) {
    const id = text(row.id);
    if (formForEntity(db, 'INSPIRATION_STASH', id)) continue;
    const parentItemId = parentItemForInspiration(
      db,
      hasLegacyParent && row.parent_series_id != null ? text(row.parent_series_id) : null,
    );
    if (parentItemId && !formForRole(db, parentItemId, 'INSPIRATION', null)) {
      addForm(db, {
        creationItemId: parentItemId,
        role: 'INSPIRATION',
        entityType: 'INSPIRATION_STASH',
        entityId: id,
        anchorKey: null,
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      });
      continue;
    }
    createItemWithForm(db, {
      role: 'INSPIRATION',
      entityType: 'INSPIRATION_STASH',
      entityId: id,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      archivedAt: row.archived_at == null ? null : text(row.archived_at),
    });
  }
}

function ensureOutcomeForms(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT 'SOCIAL_POST' AS entity_type, id, source_inspiration_stash_id,
        created_at, updated_at, archived_at
      FROM social_post_drafts WHERE deleted_at IS NULL
      UNION ALL
      SELECT 'ARTICLE' AS entity_type, id, source_inspiration_stash_id,
        created_at, updated_at, archived_at
      FROM articles WHERE deleted_at IS NULL
      ORDER BY created_at, id`,
    )
    .all() as Row[];
  for (const row of rows) {
    const entityType = text(row.entity_type) as 'SOCIAL_POST' | 'ARTICLE';
    const role: PrimaryRole = entityType;
    const id = text(row.id);
    if (formForEntity(db, entityType, id)) continue;
    const sourceId = row.source_inspiration_stash_id == null ? null : text(row.source_inspiration_stash_id);
    const sourceForm = sourceId ? formForEntity(db, 'INSPIRATION_STASH', sourceId) : undefined;
    const sourceItemId = sourceForm ? text(sourceForm.creation_item_id) : null;
    if (sourceItemId && !formForRole(db, sourceItemId, role, null)) {
      addForm(db, {
        creationItemId: sourceItemId,
        role,
        entityType,
        entityId: id,
        anchorKey: null,
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      });
      continue;
    }
    createItemWithForm(db, {
      role,
      entityType,
      entityId: id,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      archivedAt: row.archived_at == null ? null : text(row.archived_at),
    });
  }
}

function inlineAnchorKey(row: Row) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(row.anchor_json)) as unknown;
  } catch {
    throw new Error('Cannot normalize an invalid article illustration anchor');
  }
  if (!parsed || typeof parsed !== 'object' || !('selectedText' in parsed)) {
    throw new Error('Cannot normalize an invalid article illustration anchor');
  }
  const selectedText = (parsed as { selectedText?: unknown }).selectedText;
  if (typeof selectedText !== 'string' || !selectedText.trim()) {
    throw new Error('Cannot normalize an invalid article illustration anchor');
  }
  return createHash('sha256').update(text(row.article_id)).update('\0').update(selectedText).digest('hex');
}

function derivedVisualRole(row: Row): DerivedVisualRole {
  const role = text(row.role);
  if (role === 'SOCIAL_POST_COVER' || role === 'ARTICLE_HEADER' || role === 'ARTICLE_INLINE') return role;
  throw new Error('Cannot normalize an invalid derived visual role');
}

function derivedVisualPlacement(db: Database.Database, row: Row) {
  const role = derivedVisualRole(row);
  const parentType = role === 'SOCIAL_POST_COVER' ? 'SOCIAL_POST' : 'ARTICLE';
  const parentId = text(role === 'SOCIAL_POST_COVER' ? row.social_post_id : row.article_id);
  const parentForm = formForEntity(db, parentType, parentId);
  if (!parentForm) return null;
  return {
    creationItemId: text(parentForm.creation_item_id),
    role,
    anchorKey: role === 'ARTICLE_INLINE' ? inlineAnchorKey(row) : null,
  };
}

function derivedVisualPlacementKey(placement: NonNullable<ReturnType<typeof derivedVisualPlacement>>) {
  return JSON.stringify([placement.creationItemId, placement.role, placement.anchorKey]);
}

function ensureDerivedVisualForms(db: Database.Database) {
  // Before creation forms existed, reopening a visual action created another
  // workspace. Revision 4 makes each role/anchor resumable, so the newest
  // historical attempt claims an empty slot and older attempts remain stored.
  const rows = db.prepare('SELECT * FROM derived_visuals ORDER BY created_at DESC, id DESC').all() as Row[];
  for (const row of rows) {
    const id = text(row.id);
    if (formForEntity(db, 'DERIVED_VISUAL', id)) continue;
    const placement = derivedVisualPlacement(db, row);
    if (!placement) throw new Error('Cannot normalize a derived visual without its parent creation form');
    if (formForRole(db, placement.creationItemId, placement.role, placement.anchorKey)) continue;
    addForm(db, {
      creationItemId: placement.creationItemId,
      role: placement.role,
      entityType: 'DERIVED_VISUAL',
      entityId: id,
      anchorKey: placement.anchorKey,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    });
  }
}

function derivedVisualCompositionComplete(db: Database.Database) {
  const visuals = db.prepare('SELECT * FROM derived_visuals').all() as Row[];
  const visualsById = new Map(visuals.map((visual) => [text(visual.id), visual]));
  const forms = db
    .prepare("SELECT * FROM creation_forms WHERE entity_type = 'DERIVED_VISUAL' AND deleted_at IS NULL")
    .all() as Row[];
  const occupiedPlacements = new Set<string>();

  for (const form of forms) {
    const visual = visualsById.get(text(form.entity_id));
    if (!visual) return false;
    const placement = derivedVisualPlacement(db, visual);
    if (
      !placement ||
      text(form.creation_item_id) !== placement.creationItemId ||
      text(form.role) !== placement.role ||
      (form.anchor_key == null ? null : text(form.anchor_key)) !== placement.anchorKey
    ) {
      return false;
    }
    const key = derivedVisualPlacementKey(placement);
    occupiedPlacements.add(key);
  }

  // Revision 5 keeps each cover/header attempt as its own lineage form. Older
  // pre-composition attempts may still share that represented placement without
  // having a form of their own; inline-anchor uniqueness remains database-enforced.
  for (const visual of visuals) {
    const placement = derivedVisualPlacement(db, visual);
    if (!placement || !occupiedPlacements.has(derivedVisualPlacementKey(placement))) return false;
  }
  return true;
}

function repairItemState(db: Database.Database, creationItemId: string) {
  const forms = db
    .prepare(
      `SELECT id, role FROM creation_forms
      WHERE creation_item_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at, id`,
    )
    .all(creationItemId) as Row[];
  if (forms.length === 0) {
    db.prepare("DELETE FROM album_members WHERE target_type = 'CREATION_ITEM' AND target_id = ?").run(creationItemId);
    db.prepare("DELETE FROM sidebar_root_order WHERE target_type = 'CREATION_ITEM' AND target_id = ?").run(
      creationItemId,
    );
    db.prepare('DELETE FROM creation_items WHERE id = ?').run(creationItemId);
    return;
  }
  const primary = forms.find((form) => primaryRoles.has(text(form.role) as FormRole));
  if (!primary) {
    if (forms.some((form) => text(form.role) !== 'INSPIRATION')) {
      throw new Error('Cannot normalize an auxiliary-only creation item');
    }
    db.prepare("UPDATE creation_items SET phase = 'DRAFT', primary_form_id = NULL WHERE id = ?").run(creationItemId);
    return;
  }
  db.prepare("UPDATE creation_items SET phase = 'ACTIVE', primary_form_id = ? WHERE id = ?").run(
    text(primary.id),
    creationItemId,
  );
}

function retireDerivedWorkspaceImageForms(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT form.id, form.creation_item_id
      FROM derived_visuals visual
      JOIN creation_forms form
        ON form.entity_type = 'PROMPT_SERIES' AND form.entity_id = visual.prompt_series_id
      WHERE visual.prompt_series_id IS NOT NULL AND form.deleted_at IS NULL`,
    )
    .all() as Row[];
  for (const row of rows) {
    const itemId = text(row.creation_item_id);
    db.prepare('DELETE FROM creation_forms WHERE id = ?').run(text(row.id));
    repairItemState(db, itemId);
  }
}

export function ensureCreationEntityComposition(db: Database.Database) {
  ensurePrimaryEntityForms(db);
  ensureInspirationForms(db);
  ensureOutcomeForms(db);
  ensureDerivedVisualForms(db);
}

function activeItemAlbumId(db: Database.Database, creationItemId: string) {
  const row = db
    .prepare(
      `SELECT album_id FROM album_members
      WHERE target_type = 'CREATION_ITEM' AND target_id = ? AND deleted_at IS NULL`,
    )
    .get(creationItemId) as Row | undefined;
  return row ? text(row.album_id) : null;
}

function entityAlbumIds(db: Database.Database, creationItemId: string) {
  const rows = db
    .prepare(
      `SELECT inspiration.album_id
      FROM creation_forms form
      JOIN inspiration_stashes inspiration
        ON form.entity_type = 'INSPIRATION_STASH' AND inspiration.id = form.entity_id
      WHERE form.creation_item_id = ? AND form.deleted_at IS NULL AND inspiration.deleted_at IS NULL
      UNION
      SELECT social.album_id
      FROM creation_forms form
      JOIN social_post_drafts social
        ON form.entity_type = 'SOCIAL_POST' AND social.id = form.entity_id
      WHERE form.creation_item_id = ? AND form.deleted_at IS NULL AND social.deleted_at IS NULL
      UNION
      SELECT article.album_id
      FROM creation_forms form
      JOIN articles article
        ON form.entity_type = 'ARTICLE' AND article.id = form.entity_id
      WHERE form.creation_item_id = ? AND form.deleted_at IS NULL AND article.deleted_at IS NULL
      UNION
      SELECT suite.album_id
      FROM creation_forms form
      JOIN evaluation_suites suite
        ON form.entity_type = 'EVALUATION_SUITE' AND suite.id = form.entity_id
      WHERE form.creation_item_id = ? AND form.deleted_at IS NULL AND suite.deleted_at IS NULL`,
    )
    .all(creationItemId, creationItemId, creationItemId, creationItemId) as Row[];
  return [...new Set(rows.flatMap((row) => (row.album_id == null ? [] : [text(row.album_id)])))];
}

function addItemAlbumMembership(db: Database.Database, creationItemId: string, albumId: string, timestamp: string) {
  const available = db
    .prepare(
      "SELECT 1 FROM albums WHERE id = ? AND intent <> 'MATERIAL_LIBRARY' AND deleted_at IS NULL AND archived_at IS NULL",
    )
    .get(albumId);
  if (!available) throw new Error('Cannot normalize a creation item into an unavailable album');
  const sortOrder = Number(
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM album_members
        WHERE album_id = ? AND deleted_at IS NULL`,
      )
      .pluck()
      .get(albumId),
  );
  const memberId = `creation-item-member:${createHash('sha256').update(albumId).update('\0').update(creationItemId).digest('hex')}`;
  db.prepare(
    `INSERT INTO album_members (
      id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at
    ) VALUES (?, ?, 'CREATION_ITEM', ?, ?, ?, ?, NULL)`,
  ).run(memberId, albumId, creationItemId, sortOrder, timestamp, timestamp);
}

function syncEntityAlbumIds(db: Database.Database, creationItemId: string, albumId: string | null, timestamp: string) {
  for (const table of ['inspiration_stashes', 'social_post_drafts', 'articles', 'evaluation_suites'] as const) {
    const entityType =
      table === 'inspiration_stashes'
        ? 'INSPIRATION_STASH'
        : table === 'social_post_drafts'
          ? 'SOCIAL_POST'
          : table === 'articles'
            ? 'ARTICLE'
            : 'EVALUATION_SUITE';
    db.prepare(
      `UPDATE ${table} SET album_id = ?, updated_at = ?
      WHERE id IN (
        SELECT entity_id FROM creation_forms
        WHERE creation_item_id = ? AND entity_type = ? AND deleted_at IS NULL
      ) AND deleted_at IS NULL`,
    ).run(albumId, timestamp, creationItemId, entityType);
  }
}

export function ensureCreationItemLocations(db: Database.Database) {
  retireDerivedWorkspaceImageForms(db);
  const items = db
    .prepare('SELECT id, updated_at FROM creation_items WHERE deleted_at IS NULL ORDER BY created_at, id')
    .all() as Row[];
  for (const item of items) {
    const itemId = text(item.id);
    repairItemState(db, itemId);
    let albumId = activeItemAlbumId(db, itemId);
    const formAlbumIds = entityAlbumIds(db, itemId);
    if (!albumId) {
      if (formAlbumIds.length > 1) throw new Error('Creation forms disagree about their aggregate album');
      albumId = formAlbumIds[0] ?? null;
      if (albumId) addItemAlbumMembership(db, itemId, albumId, text(item.updated_at));
    }
    syncEntityAlbumIds(db, itemId, albumId, text(item.updated_at));
  }
  if (tableColumns(db, 'inspiration_stashes').has('parent_series_id')) {
    db.exec(removeInspirationParentSeriesSql);
  }
}

export function creationCompositionComplete(db: Database.Database) {
  if (tableColumns(db, 'inspiration_stashes').has('parent_series_id')) return false;
  const missing = db
    .prepare(
      `SELECT 1 FROM (
        SELECT 'PROMPT_SERIES' AS entity_type, series.id
        FROM prompt_series series
        WHERE series.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM derived_visuals visual WHERE visual.prompt_series_id = series.id)
        UNION ALL
        SELECT 'IMAGE_BREAKDOWN', id FROM image_breakdowns WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'INSPIRATION_STASH', id FROM inspiration_stashes WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'SOCIAL_POST', id FROM social_post_drafts WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'ARTICLE', id FROM articles WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'VIDEO_DOCUMENT', id FROM documents WHERE deleted_at IS NULL
        UNION ALL
        SELECT 'EVALUATION_SUITE', id FROM evaluation_suites WHERE deleted_at IS NULL
      ) entity
      WHERE NOT EXISTS (
        SELECT 1 FROM creation_forms form
        WHERE form.entity_type = entity.entity_type AND form.entity_id = entity.id AND form.deleted_at IS NULL
      ) LIMIT 1`,
    )
    .get();
  if (missing) return false;
  if (!derivedVisualCompositionComplete(db)) return false;
  const wrongDerivedSeries = db
    .prepare(
      `SELECT 1 FROM derived_visuals visual
      JOIN creation_forms form
        ON form.entity_type = 'PROMPT_SERIES' AND form.entity_id = visual.prompt_series_id
      WHERE visual.prompt_series_id IS NOT NULL AND form.deleted_at IS NULL LIMIT 1`,
    )
    .get();
  if (wrongDerivedSeries) return false;
  const invalidItem = db
    .prepare(
      `SELECT 1 FROM creation_items item
      WHERE item.deleted_at IS NULL AND (
        NOT EXISTS (
          SELECT 1 FROM creation_forms form
          WHERE form.creation_item_id = item.id AND form.deleted_at IS NULL
        )
        OR (item.phase = 'DRAFT' AND (
          item.primary_form_id IS NOT NULL OR EXISTS (
            SELECT 1 FROM creation_forms form
            WHERE form.creation_item_id = item.id AND form.deleted_at IS NULL AND form.role <> 'INSPIRATION'
          )
        ))
        OR (item.phase = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM creation_forms form
          WHERE form.id = item.primary_form_id AND form.creation_item_id = item.id
            AND form.deleted_at IS NULL
            AND form.role IN (
              'IMAGE_BREAKDOWN', 'IMAGE_CREATION', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT', 'EVALUATION_SUITE'
            )
        ))
      ) LIMIT 1`,
    )
    .get();
  return !invalidItem;
}
