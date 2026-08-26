import type Database from 'better-sqlite3';
import revision4ContentLifecycleCreationItemMembersSql from '@/main/database/sql/v03-revision-004-content-lifecycle-creation-item-members.sql?raw';
import revision4ContentLifecycleCreationItemsSql from '@/main/database/sql/v03-revision-004-content-lifecycle-creation-items.sql?raw';
import revision4ContentLifecycleSql from '@/main/database/sql/v03-revision-004-content-lifecycle.sql?raw';
import revision4RecoveryLifecycleSql from '@/main/database/sql/v03-revision-004-recovery-lifecycle.sql?raw';

function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

function tableNames(db: Database.Database) {
  return new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

function columnNames(db: Database.Database, table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

export function recoveryLifecycleShape(db: Database.Database) {
  if (!tableNames(db).has('recycle_bin_entries')) return 'ABSENT' as const;
  const columns = columnNames(db, 'recycle_bin_entries');
  const required = [
    'entity_type',
    'entity_id',
    'scope',
    'title',
    'deleted_at',
    'purge_after',
    'state_before_delete',
    'payload_json',
    'purge_state',
    'purge_requested_at',
    'purge_error',
    'updated_at',
  ];
  if (required.every((column) => columns.has(column))) return 'COMPLETE' as const;
  unsupportedSchema();
}

export function ensureRecoveryLifecycle(db: Database.Database) {
  if (recoveryLifecycleShape(db) === 'ABSENT') db.exec(revision4RecoveryLifecycleSql);
}

export function contentLifecycleShape(db: Database.Database) {
  const tables = tableNames(db);
  const batchesPresent = tables.has('content_lifecycle_batches');
  const membersPresent = tables.has('content_lifecycle_batch_members');
  const seriesArchived = columnNames(db, 'prompt_series').has('archived_at');
  const materialsArchived = columnNames(db, 'materials').has('archived_at');
  if (!batchesPresent && !membersPresent && !seriesArchived && !materialsArchived) return 'ABSENT' as const;
  if (!batchesPresent || !membersPresent || !seriesArchived || !materialsArchived) unsupportedSchema();
  const batchColumns = columnNames(db, 'content_lifecycle_batches');
  const memberColumns = columnNames(db, 'content_lifecycle_batch_members');
  const requiredBatchColumns = [
    'id',
    'action',
    'root_entity_type',
    'root_entity_id',
    'root_kind',
    'root_subtype',
    'title',
    'preview_asset_id',
    'preview_text',
    'state_before_action',
    'changed_at',
    'expires_at',
    'purge_state',
    'purge_requested_at',
    'purge_error',
    'updated_at',
  ];
  const requiredMemberColumns = [
    'batch_id',
    'entity_type',
    'entity_id',
    'kind',
    'subtype',
    'title',
    'preview_asset_id',
    'preview_text',
    'parent_entity_type',
    'parent_entity_id',
    'sort_order',
    'state_before_action',
    'payload_json',
  ];
  if (
    !requiredBatchColumns.every((column) => batchColumns.has(column)) ||
    !requiredMemberColumns.every((column) => memberColumns.has(column))
  ) {
    unsupportedSchema();
  }
  const batchDefinition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_lifecycle_batches'")
    .pluck()
    .get();
  const memberDefinition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_lifecycle_batch_members'")
    .pluck()
    .get();
  if (typeof batchDefinition !== 'string' || typeof memberDefinition !== 'string') unsupportedSchema();
  const batchSupportsCreationItems = batchDefinition.includes("'CREATION_ITEM'");
  const membersSupportCreationItems = memberDefinition.includes("'CREATION_ITEM'");
  if (!batchSupportsCreationItems && !membersSupportCreationItems) return 'LEGACY_ENTITY_TYPES' as const;
  if (!batchSupportsCreationItems || !membersSupportCreationItems) unsupportedSchema();
  if (hasMissingAggregate(db) || hasMissingForm(db)) return 'MISSING_CREATION_ITEM_MEMBERS' as const;
  return 'COMPLETE' as const;
}

function hasMissingAggregate(db: Database.Database) {
  return Boolean(
    db
      .prepare(
        `SELECT 1
        FROM content_lifecycle_batch_members member
        JOIN creation_forms form
          ON form.entity_type = member.entity_type AND form.entity_id = member.entity_id
        JOIN content_lifecycle_batches batch ON batch.id = member.batch_id
        WHERE member.entity_type IN (
          'PROMPT_SERIES', 'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT'
        )
          AND (form.deleted_at IS NULL OR (batch.action = 'DELETE' AND form.deleted_at = batch.changed_at))
          AND NOT EXISTS (
            SELECT 1 FROM content_lifecycle_batch_members aggregate
            WHERE aggregate.batch_id = member.batch_id
              AND aggregate.entity_type = 'CREATION_ITEM'
              AND aggregate.entity_id = form.creation_item_id
          )
        LIMIT 1`,
      )
      .get(),
  );
}

function hasMissingForm(db: Database.Database) {
  return Boolean(
    db
      .prepare(
        `SELECT 1
        FROM content_lifecycle_batch_members aggregate
        JOIN content_lifecycle_batches batch ON batch.id = aggregate.batch_id
        JOIN creation_forms form ON form.creation_item_id = aggregate.entity_id
        WHERE aggregate.entity_type = 'CREATION_ITEM'
          AND (form.deleted_at IS NULL OR (batch.action = 'DELETE' AND form.deleted_at = batch.changed_at))
          AND form.entity_type IN (
            'PROMPT_SERIES', 'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT'
          )
          AND NOT EXISTS (
            SELECT 1 FROM content_lifecycle_batch_members member
            WHERE member.batch_id = aggregate.batch_id
              AND member.entity_type = form.entity_type
              AND member.entity_id = form.entity_id
          )
        LIMIT 1`,
      )
      .get(),
  );
}

export function ensureContentLifecycle(db: Database.Database) {
  const shape = contentLifecycleShape(db);
  if (shape === 'ABSENT') {
    db.exec(revision4ContentLifecycleSql);
    db.exec(revision4ContentLifecycleCreationItemMembersSql);
  }
  if (shape === 'LEGACY_ENTITY_TYPES') {
    db.exec(revision4ContentLifecycleCreationItemsSql);
    db.exec(revision4ContentLifecycleCreationItemMembersSql);
  }
  if (shape === 'MISSING_CREATION_ITEM_MEMBERS') db.exec(revision4ContentLifecycleCreationItemMembersSql);
}
