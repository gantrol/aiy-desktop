import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  RecycleBinEntryDto,
  RecycleBinItemRef,
  RecycleBinListInput,
  RecycleBinPageDto,
  RecycleBinPurgeInput,
  RecycleBinPurgePlanDto,
  RecycleBinPurgePlanInput,
  RecycleBinPurgeResult,
  RecycleBinRestoreInput,
  RecycleBinScope,
  RecycleBinSelection,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { promptSeriesRecoveryPayloadSchema } from '@/main/database/recovery/recycle-bin-entry';

const entryRowSchema = z
  .object({
    entity_type: z.enum(['ALBUM', 'PROMPT_SERIES', 'CREATION', 'IMAGE_ASSET']),
    entity_id: z.string().min(1),
    scope: z.enum(['CREATOR_ALBUMS', 'MATERIAL_ALBUMS', 'CREATIONS', 'MATERIALS']),
    title: z.string().min(1),
    deleted_at: z.string().min(1),
    purge_after: z.string().min(1),
    state_before_delete: z.enum(['ACTIVE', 'ARCHIVED']),
    payload_json: z.string(),
    purge_state: z.enum(['RETAINED', 'PURGE_PENDING', 'FAILED']),
    purge_error: z.string().nullable(),
  })
  .passthrough();

const cursorSchema = z.tuple([
  z.string().min(1),
  z.enum(['ALBUM', 'PROMPT_SERIES', 'CREATION', 'IMAGE_ASSET']),
  z.string().min(1),
]);

type EntryRow = z.infer<typeof entryRowSchema>;

function entryDto(row: EntryRow): RecycleBinEntryDto {
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    scope: row.scope,
    title: row.title,
    deletedAt: row.deleted_at,
    purgeAfter: row.purge_after,
    stateBeforeDelete: row.state_before_delete,
    purgeState: row.purge_state,
    purgeError: row.purge_error,
  };
}

function encodeCursor(row: EntryRow) {
  return Buffer.from(JSON.stringify([row.deleted_at, row.entity_type, row.entity_id]), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null | undefined) {
  if (!value) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new Error('Recycle-bin cursor is invalid');
  }
}

function itemKey(item: Pick<RecycleBinItemRef, 'entityType' | 'entityId'>) {
  return `${item.entityType}:${item.entityId}`;
}

function nodeErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

export class RecycleBinRepository {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTail: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly storage: LibraryStorage,
    private readonly synchronizeManagedFiles: () => Promise<void>,
  ) {}

  private get db() {
    return this.storage.db;
  }

  list(input: RecycleBinListInput): RecycleBinPageDto {
    const limit = input.limit ?? 50;
    const cursor = decodeCursor(input.cursor);
    const rows = entryRowSchema.array().parse(
      this.db
        .prepare(
          `SELECT * FROM recycle_bin_entries
          WHERE scope = ? AND (
            ? IS NULL OR deleted_at < ? OR (
              deleted_at = ? AND (
                entity_type > ? OR (entity_type = ? AND entity_id > ?)
              )
            )
          )
          ORDER BY deleted_at DESC, entity_type, entity_id
          LIMIT ?`,
        )
        .all(
          input.scope,
          cursor?.[0] ?? null,
          cursor?.[0] ?? '',
          cursor?.[0] ?? '',
          cursor?.[1] ?? '',
          cursor?.[1] ?? '',
          cursor?.[2] ?? '',
          limit + 1,
        ),
    );
    const visible = rows.slice(0, limit);
    const total = Number(
      (this.db
        .prepare('SELECT COUNT(*) FROM recycle_bin_entries WHERE scope = ?')
        .pluck()
        .get(input.scope) as number) ?? 0,
    );
    return {
      items: visible.map(entryDto),
      total,
      nextCursor: rows.length > limit ? encodeCursor(visible[visible.length - 1]) : null,
    };
  }

  restore(input: RecycleBinRestoreInput): void {
    this.db.transaction(() => {
      const row = this.requireEntry(input.entityType, input.entityId, input.scope, input.expectedDeletedAt);
      if (row.purge_state === 'PURGE_PENDING') throw new Error('This item is being permanently deleted');
      if (row.entity_type === 'ALBUM') this.restoreAlbum(row);
      else if (row.entity_type === 'PROMPT_SERIES') this.restorePromptSeries(row);
      else if (row.entity_type === 'CREATION') this.restoreCreation(row);
      else this.restoreImageAsset(row);
      this.db
        .prepare('DELETE FROM recycle_bin_entries WHERE entity_type = ? AND entity_id = ?')
        .run(row.entity_type, row.entity_id);
    })();
  }

  planPurge(input: RecycleBinPurgePlanInput): RecycleBinPurgePlanDto {
    const hash = createHash('sha256');
    hash.update(`${input.scope}\n${input.selection.kind}\n`);
    let count = 0;
    for (const row of this.selectionRows(input.scope, input.selection)) {
      hash.update(`${row.entity_type}\0${row.entity_id}\0${row.deleted_at}\n`);
      count += 1;
    }
    if (input.selection.kind === 'ITEMS' && count !== new Set(input.selection.items.map(itemKey)).size) {
      throw new Error('Recycle-bin contents changed before confirmation');
    }
    return { confirmationToken: hash.digest('hex'), count };
  }

  async purge(input: RecycleBinPurgeInput): Promise<RecycleBinPurgeResult> {
    const plan = this.planPurge(input);
    if (plan.confirmationToken !== input.confirmationToken) {
      throw new Error('Recycle-bin contents changed before confirmation');
    }
    if (plan.count === 0) return { purged: 0, failed: 0 };
    const selectedKeys = input.selection.kind === 'ITEMS' ? new Set(input.selection.items.map(itemKey)) : null;
    this.markSelectionPending(input.scope, input.selection);
    return this.enqueueCleanup(() => this.processPending(input.scope, selectedKeys));
  }

  startAutomaticCleanup() {
    if (this.cleanupTimer) return;
    this.stopped = false;
    void this.enqueueCleanup(() => this.processDue()).catch((error) => {
      console.error('[recycle-bin] automatic cleanup failed', error);
    });
    this.cleanupTimer = setInterval(
      () => {
        void this.enqueueCleanup(() => this.processDue()).catch((error) => {
          console.error('[recycle-bin] automatic cleanup failed', error);
        });
      },
      24 * 60 * 60 * 1_000,
    );
    this.cleanupTimer.unref?.();
  }

  async stopAndDrain() {
    this.stopped = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    await this.cleanupTail;
  }

  private enqueueCleanup<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.cleanupTail.then(operation, operation);
    this.cleanupTail = next.catch(() => undefined);
    return next;
  }

  private *selectionRows(scope: RecycleBinScope, selection: RecycleBinSelection): Iterable<EntryRow> {
    if (selection.kind === 'ALL') {
      const rows = this.db
        .prepare(
          `SELECT * FROM recycle_bin_entries
          WHERE scope = ? ORDER BY entity_type, entity_id`,
        )
        .iterate(scope) as Iterable<JsonMap>;
      for (const row of rows) yield entryRowSchema.parse(row);
      return;
    }
    const requested = [...new Map(selection.items.map((item) => [itemKey(item), item])).values()];
    const rows = this.db
      .prepare(
        `WITH requested AS (
          SELECT
            json_extract(value, '$.entityType') AS entity_type,
            json_extract(value, '$.entityId') AS entity_id,
            json_extract(value, '$.expectedDeletedAt') AS deleted_at
          FROM json_each(?)
        )
        SELECT entry.* FROM requested
        JOIN recycle_bin_entries entry
          ON entry.entity_type = requested.entity_type
          AND entry.entity_id = requested.entity_id
          AND entry.deleted_at = requested.deleted_at
        WHERE entry.scope = ?
        ORDER BY entry.entity_type, entry.entity_id`,
      )
      .all(JSON.stringify(requested), scope);
    for (const row of entryRowSchema.array().parse(rows)) yield row;
  }

  private markSelectionPending(scope: RecycleBinScope, selection: RecycleBinSelection) {
    const timestamp = now();
    if (selection.kind === 'ALL') {
      this.db
        .prepare(
          `UPDATE recycle_bin_entries
          SET purge_state = 'PURGE_PENDING', purge_requested_at = ?, purge_error = NULL, updated_at = ?
          WHERE scope = ?`,
        )
        .run(timestamp, timestamp, scope);
      return;
    }
    const requested = [...new Map(selection.items.map((item) => [itemKey(item), item])).values()];
    this.db
      .prepare(
        `UPDATE recycle_bin_entries AS entry
        SET purge_state = 'PURGE_PENDING', purge_requested_at = ?, purge_error = NULL, updated_at = ?
        WHERE entry.scope = ? AND EXISTS (
          SELECT 1 FROM json_each(?) requested
          WHERE json_extract(requested.value, '$.entityType') = entry.entity_type
            AND json_extract(requested.value, '$.entityId') = entry.entity_id
            AND json_extract(requested.value, '$.expectedDeletedAt') = entry.deleted_at
        )`,
      )
      .run(timestamp, timestamp, scope, JSON.stringify(requested));
  }

  private async processDue(): Promise<RecycleBinPurgeResult> {
    if (this.stopped) return { purged: 0, failed: 0 };
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE recycle_bin_entries
        SET purge_state = 'PURGE_PENDING', purge_requested_at = ?, purge_error = NULL, updated_at = ?
        WHERE purge_after <= ? AND purge_state IN ('RETAINED', 'FAILED')`,
      )
      .run(timestamp, timestamp, timestamp);
    return this.processPending(null, null);
  }

  private async processPending(
    scope: RecycleBinScope | null,
    selectedKeys: ReadonlySet<string> | null,
  ): Promise<RecycleBinPurgeResult> {
    let purged = 0;
    let failed = 0;
    let managedFilesSynchronized = false;
    let managedFileSyncError: string | null = null;
    const selectedKeyJson = selectedKeys ? JSON.stringify([...selectedKeys]) : null;
    while (!this.stopped || scope !== null) {
      const rows = entryRowSchema.array().parse(
        this.db
          .prepare(
            `SELECT * FROM recycle_bin_entries
            WHERE purge_state = 'PURGE_PENDING' AND (? IS NULL OR scope = ?)
              AND (? IS NULL OR (entity_type || ':' || entity_id) IN (SELECT value FROM json_each(?)))
            ORDER BY purge_requested_at, entity_type, entity_id LIMIT 50`,
          )
          .all(scope, scope, selectedKeyJson, selectedKeyJson),
      );
      if (rows.length === 0) break;
      if (!managedFilesSynchronized && !managedFileSyncError && rows.some((row) => row.entity_type === 'IMAGE_ASSET')) {
        try {
          await this.synchronizeManagedFiles();
          managedFilesSynchronized = true;
        } catch (error) {
          managedFileSyncError = error instanceof Error ? error.message : String(error);
        }
      }
      for (const row of rows) {
        if (row.entity_type === 'IMAGE_ASSET' && managedFileSyncError) {
          failed += 1;
          this.markPurgeFailed(row, managedFileSyncError);
          continue;
        }
        try {
          await this.purgeEntry(row);
          purged += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.markPurgeFailed(row, message);
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (selectedKeys && purged + failed >= selectedKeys.size) break;
    }
    return { purged, failed };
  }

  private markPurgeFailed(row: EntryRow, message: string) {
    this.db
      .prepare(
        `UPDATE recycle_bin_entries
        SET purge_state = 'FAILED', purge_error = ?, updated_at = ?
        WHERE entity_type = ? AND entity_id = ?`,
      )
      .run(message.slice(0, 2_000), now(), row.entity_type, row.entity_id);
  }

  private async purgeEntry(row: EntryRow) {
    if (row.entity_type === 'IMAGE_ASSET') await this.purgeImageAsset(row);
    else if (row.entity_type === 'ALBUM') this.purgeAlbum(row);
    else if (row.entity_type === 'CREATION') this.purgeCreation(row);
    else this.purgePromptSeries(row);
  }

  private restoreAlbum(row: EntryRow) {
    const restoredAt = now();
    const result = this.db
      .prepare('UPDATE albums SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?')
      .run(restoredAt, row.entity_id, row.deleted_at);
    if (!result.changes) throw new Error('Deleted album is unavailable');
    this.db
      .prepare(
        `UPDATE album_members SET deleted_at = NULL, updated_at = ?
        WHERE deleted_at = ? AND (album_id = ? OR (target_type = 'ALBUM' AND target_id = ?))
          AND (target_type = 'MATERIAL' OR NOT EXISTS (
            SELECT 1 FROM album_members current
            WHERE current.id <> album_members.id AND current.deleted_at IS NULL
              AND current.target_type = album_members.target_type
              AND current.target_id = album_members.target_id
          ))`,
      )
      .run(restoredAt, row.deleted_at, row.entity_id, row.entity_id);
    this.storage.recordChange('ALBUM', row.entity_id, 'RESTORE', { stateBeforeDelete: row.state_before_delete });
  }

  private restorePromptSeries(row: EntryRow) {
    const payload = promptSeriesRecoveryPayloadSchema.parse(JSON.parse(row.payload_json) as unknown);
    const result = this.db
      .prepare('UPDATE prompt_series SET deleted_at = NULL WHERE id = ? AND deleted_at = ?')
      .run(row.entity_id, row.deleted_at);
    if (!result.changes) throw new Error('Deleted creation is unavailable');
    this.restoreIds('creation_output_imports', payload.deletedImportIds, row.deleted_at);
    this.restoreIds('image_transform_runs', payload.deletedTransformIds, row.deleted_at);
    this.restoreArchivedRecords('creations', payload.archivedCreationIds, row.deleted_at);
    this.restoreArchivedRecords('inspiration_stashes', payload.archivedInspirationStashIds, row.deleted_at);
    this.storage.recordChange('PROMPT_SERIES', row.entity_id, 'RESTORE', {});
  }

  private restoreImageAsset(row: EntryRow) {
    const result = this.db
      .prepare('UPDATE image_assets SET deleted_at = NULL WHERE id = ? AND deleted_at = ?')
      .run(row.entity_id, row.deleted_at);
    if (!result.changes) throw new Error('Deleted material is unavailable');
    this.storage.recordChange('IMAGE_ASSET', row.entity_id, 'RESTORE', {});
  }

  private restoreCreation(row: EntryRow) {
    const result = this.db
      .prepare('UPDATE creations SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?')
      .run(now(), row.entity_id, row.deleted_at);
    if (!result.changes) throw new Error('Deleted creation is unavailable');
    this.db
      .prepare(
        'UPDATE creation_elements SET deleted_at = NULL, updated_at = ? WHERE creation_id = ? AND deleted_at = ?',
      )
      .run(now(), row.entity_id, row.deleted_at);
    this.storage.recordChange('CREATION', row.entity_id, 'RESTORE', {});
  }

  private restoreIds(
    table: 'creation_output_imports' | 'image_transform_runs',
    ids: readonly string[],
    deletedAt: string,
  ) {
    if (ids.length === 0) return;
    this.db
      .prepare(
        `UPDATE ${table} SET deleted_at = NULL
        WHERE deleted_at = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .run(deletedAt, JSON.stringify(ids));
  }

  private restoreArchivedRecords(
    table: 'creations' | 'inspiration_stashes',
    ids: readonly string[],
    archivedAt: string,
  ) {
    if (ids.length === 0) return;
    this.db
      .prepare(
        `UPDATE ${table}
        SET status = 'ACTIVE', archived_at = NULL, updated_at = ?
        WHERE archived_at = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .run(now(), archivedAt, JSON.stringify(ids));
  }

  private purgeAlbum(row: EntryRow) {
    this.db.transaction(() => {
      const exists = this.db.prepare('SELECT 1 FROM albums WHERE id = ? AND deleted_at IS NOT NULL').get(row.entity_id);
      if (exists) {
        this.db
          .prepare('UPDATE creation_drafts SET target_album_id = NULL WHERE target_album_id = ?')
          .run(row.entity_id);
        this.db.prepare('UPDATE inspiration_stashes SET album_id = NULL WHERE album_id = ?').run(row.entity_id);
        this.db.prepare('UPDATE social_post_drafts SET album_id = NULL WHERE album_id = ?').run(row.entity_id);
        this.db.prepare('UPDATE articles SET album_id = NULL WHERE album_id = ?').run(row.entity_id);
        this.db.prepare('DELETE FROM album_members WHERE album_id = ?').run(row.entity_id);
        this.db.prepare("DELETE FROM album_members WHERE target_type = 'ALBUM' AND target_id = ?").run(row.entity_id);
        this.db.prepare('DELETE FROM album_localizations WHERE album_id = ?').run(row.entity_id);
        this.db
          .prepare("DELETE FROM sidebar_root_order WHERE target_type = 'ALBUM' AND target_id = ?")
          .run(row.entity_id);
        this.db
          .prepare("DELETE FROM context_pack_activations WHERE target_type = 'ALBUM' AND target_id = ?")
          .run(row.entity_id);
        this.db.prepare('DELETE FROM albums WHERE id = ?').run(row.entity_id);
      }
      this.finishPurge(row, 'ALBUM');
    })();
  }

  private purgePromptSeries(row: EntryRow) {
    this.db.transaction(() => {
      const versionIds = (
        this.db.prepare('SELECT id FROM prompt_versions WHERE series_id = ?').all(row.entity_id) as JsonMap[]
      ).map((version) => text(version.id));
      const versionJson = JSON.stringify(versionIds);
      const importIds = (
        this.db.prepare('SELECT id FROM creation_output_imports WHERE series_id = ?').all(row.entity_id) as JsonMap[]
      ).map((output) => text(output.id));
      if (importIds.length > 0) {
        const importJson = JSON.stringify(importIds);
        this.db
          .prepare(
            'UPDATE prompt_versions SET source_import_id = NULL WHERE source_import_id IN (SELECT value FROM json_each(?))',
          )
          .run(importJson);
        this.db
          .prepare(
            'UPDATE codex_image_discoveries SET imported_output_id = NULL WHERE imported_output_id IN (SELECT value FROM json_each(?))',
          )
          .run(importJson);
        this.db
          .prepare(
            'UPDATE creation_output_imports SET relationship_target_output_id = NULL WHERE relationship_target_output_id IN (SELECT value FROM json_each(?))',
          )
          .run(importJson);
      }
      this.db
        .prepare('UPDATE codex_image_discoveries SET imported_series_id = NULL WHERE imported_series_id = ?')
        .run(row.entity_id);
      this.db
        .prepare('UPDATE creation_drafts SET source_series_id = NULL WHERE source_series_id = ?')
        .run(row.entity_id);
      this.db
        .prepare('UPDATE derived_visuals SET prompt_series_id = NULL WHERE prompt_series_id = ?')
        .run(row.entity_id);
      this.db.prepare("DELETE FROM album_members WHERE target_type = 'SERIES' AND target_id = ?").run(row.entity_id);
      this.db
        .prepare("DELETE FROM sidebar_root_order WHERE target_type = 'SERIES' AND target_id = ?")
        .run(row.entity_id);
      this.db
        .prepare("DELETE FROM extension_thread_bindings WHERE scope_kind = 'SERIES' AND scope_id = ?")
        .run(row.entity_id);
      this.db
        .prepare("DELETE FROM creation_input_stashes WHERE scope_kind = 'SERIES' AND scope_id = ?")
        .run(row.entity_id);
      this.db
        .prepare("DELETE FROM creator_agent_turns WHERE scope_kind = 'SERIES' AND scope_id = ?")
        .run(row.entity_id);
      this.db
        .prepare("DELETE FROM historical_term_recommendation_runs WHERE scope_kind = 'SERIES' AND scope_id = ?")
        .run(row.entity_id);
      this.db
        .prepare(
          "UPDATE creation_elements SET deleted_at = COALESCE(deleted_at, ?), payload_json = '{}' WHERE kind = 'PROMPT_SERIES' AND target_id = ?",
        )
        .run(now(), row.entity_id);
      this.db
        .prepare(
          "UPDATE creations SET title = 'Purged creation', brief_text = '', failure_message = '', context_key = '', deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE source_scope_kind = 'SERIES' AND source_scope_id = ?",
        )
        .run(now(), now(), row.entity_id);
      this.db
        .prepare(
          `UPDATE assistant_proposals
          SET result_json = '{}', adopted_context_key = NULL
          WHERE assistant_run_id IN (
            SELECT id FROM assistant_runs WHERE scope_kind = 'SERIES' AND scope_id = ?
          )`,
        )
        .run(row.entity_id);
      this.db
        .prepare(
          "UPDATE assistant_runs SET request_json = '{}', context_key = '', context_hash = '', capability_receipt_json = '{}', error_message = NULL WHERE scope_kind = 'SERIES' AND scope_id = ?",
        )
        .run(row.entity_id);
      this.db
        .prepare(
          "UPDATE direction_experiment_director_tasks SET objective = 'Purged creation', authorization_json = '{}' WHERE scope_kind = 'SERIES' AND scope_id = ?",
        )
        .run(row.entity_id);
      this.db
        .prepare(
          "UPDATE style_exploration_batches SET common_constraints_json = '[]' WHERE scope_kind = 'SERIES' AND scope_id = ?",
        )
        .run(row.entity_id);
      this.db
        .prepare(
          `UPDATE style_exploration_slots
          SET label = 'Purged', rationale = '', variable_axis = '', risk = '', user_instruction = ''
          WHERE series_id = ?`,
        )
        .run(row.entity_id);
      this.db
        .prepare(
          `UPDATE knowledge_distillation_proposals
          SET status = 'CLOSED', input_snapshot_json = '{}', capability_receipt_json = '{}', result_json = '{}'
          WHERE source_series_id = ?`,
        )
        .run(row.entity_id);
      this.db.prepare('DELETE FROM prompt_series_cover_assets WHERE series_id = ?').run(row.entity_id);
      this.db.prepare('DELETE FROM prompt_series_output_exclusions WHERE series_id = ?').run(row.entity_id);
      this.db.prepare('DELETE FROM creation_output_imports WHERE series_id = ?').run(row.entity_id);
      this.db.prepare('DELETE FROM image_transform_runs WHERE series_id = ?').run(row.entity_id);
      if (versionIds.length > 0) {
        this.db
          .prepare(
            `UPDATE provider_returned_descriptions
            SET raw_value = '', interpretation = NULL, content_hash = 'purged:' || id
            WHERE generation_run_id IN (
              SELECT id FROM generation_runs WHERE prompt_version_id IN (SELECT value FROM json_each(?))
            )`,
          )
          .run(versionJson);
        this.db
          .prepare('DELETE FROM prompt_history_documents WHERE prompt_version_id IN (SELECT value FROM json_each(?))')
          .run(versionJson);
        this.db
          .prepare('DELETE FROM prompt_input_snapshots WHERE prompt_version_id IN (SELECT value FROM json_each(?))')
          .run(versionJson);
        this.db
          .prepare('DELETE FROM prompt_palette_bindings WHERE prompt_version_id IN (SELECT value FROM json_each(?))')
          .run(versionJson);
        this.db
          .prepare('DELETE FROM prompt_term_bindings WHERE prompt_version_id IN (SELECT value FROM json_each(?))')
          .run(versionJson);
        this.db
          .prepare('DELETE FROM reference_bindings WHERE prompt_version_id IN (SELECT value FROM json_each(?))')
          .run(versionJson);
        this.db
          .prepare('DELETE FROM generation_edit_specs WHERE prompt_version_id IN (SELECT value FROM json_each(?))')
          .run(versionJson);
        this.db
          .prepare(
            `UPDATE prompt_versions
            SET user_intent = '', final_prompt = '', change_summary = '', source_image_id = NULL,
              content_hash = 'purged:' || id, prompt_knowledge = 'UNKNOWN'
            WHERE id IN (SELECT value FROM json_each(?))`,
          )
          .run(versionJson);
      }
      this.db.prepare('DELETE FROM prompt_series_localizations WHERE prompt_series_id = ?').run(row.entity_id);
      this.db
        .prepare(
          `UPDATE prompt_series
          SET title = 'Purged creation', title_locale = 'und', current_version_id = NULL,
            cover_image_asset_id = NULL
          WHERE id = ? AND deleted_at IS NOT NULL`,
        )
        .run(row.entity_id);
      this.finishPurge(row, 'PROMPT_SERIES');
    })();
  }

  private purgeCreation(row: EntryRow) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM creation_activity_events WHERE creation_id = ?').run(row.entity_id);
      this.db.prepare('DELETE FROM creation_elements WHERE creation_id = ?').run(row.entity_id);
      this.db.prepare('DELETE FROM creations WHERE id = ? AND deleted_at IS NOT NULL').run(row.entity_id);
      this.finishPurge(row, 'CREATION');
    })();
  }

  private async purgeImageAsset(row: EntryRow) {
    const asset = this.db
      .prepare('SELECT relative_path FROM image_assets WHERE id = ? AND deleted_at IS NOT NULL')
      .get(row.entity_id) as JsonMap | undefined;
    if (asset) {
      const relativePath = text(asset.relative_path);
      const shared = relativePath
        ? this.db
            .prepare(
              `SELECT 1 FROM image_assets WHERE id <> ? AND relative_path = ?
              UNION ALL
              SELECT 1 FROM image_edit_artifacts WHERE relative_path = ?
              LIMIT 1`,
            )
            .get(row.entity_id, relativePath, relativePath)
        : null;
      if (relativePath && !shared) await this.unlinkObject(relativePath);
    }
    this.db.transaction(() => {
      if (asset) {
        const deletedAt = now();
        this.db
          .prepare(
            `UPDATE materials SET deleted_at = COALESCE(deleted_at, ?)
            WHERE image_asset_id = ? AND kind IN ('IMAGE', 'VIDEO')`,
          )
          .run(deletedAt, row.entity_id);
        this.db
          .prepare(
            `UPDATE material_favorites SET deleted_at = COALESCE(deleted_at, ?)
            WHERE material_id IN (SELECT id FROM materials WHERE image_asset_id = ?)`,
          )
          .run(deletedAt, row.entity_id);
        this.db
          .prepare(
            `DELETE FROM external_material_metadata
            WHERE material_id IN (SELECT id FROM materials WHERE image_asset_id = ?)`,
          )
          .run(row.entity_id);
        this.db
          .prepare(
            'DELETE FROM annotation_regions WHERE annotation_id IN (SELECT id FROM annotations WHERE image_asset_id = ?)',
          )
          .run(row.entity_id);
        this.db.prepare('DELETE FROM annotations WHERE image_asset_id = ?').run(row.entity_id);
        this.db.prepare('DELETE FROM image_ratings WHERE image_asset_id = ?').run(row.entity_id);
        this.db.prepare('DELETE FROM file_projection_links WHERE image_asset_id = ?').run(row.entity_id);
        const purgedHash = createHash('sha256').update(`purged:${row.entity_id}`).digest('hex');
        this.db
          .prepare(
            `UPDATE image_assets
            SET object_hash = ?, relative_path = '', width = 0, height = 0,
              mime_type = 'application/octet-stream', byte_size = 0
            WHERE id = ? AND deleted_at IS NOT NULL`,
          )
          .run(purgedHash, row.entity_id);
      }
      this.finishPurge(row, 'IMAGE_ASSET');
    })();
  }

  private async unlinkObject(relativePath: string) {
    const root = path.resolve(this.storage.libraryRoot);
    const objectRoot = path.resolve(root, 'objects', 'sha256');
    const candidate = path.resolve(root, ...relativePath.split(/[\\/]/u));
    if (candidate === objectRoot || !candidate.startsWith(`${objectRoot}${path.sep}`)) {
      throw new Error('Refusing to purge an invalid object-store path');
    }
    try {
      await unlink(candidate);
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error;
    }
  }

  private finishPurge(row: EntryRow, entityType: EntryRow['entity_type']) {
    this.db
      .prepare('DELETE FROM recycle_bin_entries WHERE entity_type = ? AND entity_id = ?')
      .run(row.entity_type, row.entity_id);
    this.storage.recordChange(entityType, row.entity_id, 'PURGE', { deletedAt: row.deleted_at });
  }

  private requireEntry(
    entityType: RecycleBinItemRef['entityType'],
    entityId: string,
    scope: RecycleBinScope,
    expectedDeletedAt: string,
  ) {
    const row = this.db
      .prepare(
        `SELECT * FROM recycle_bin_entries
        WHERE entity_type = ? AND entity_id = ? AND scope = ? AND deleted_at = ?`,
      )
      .get(entityType, entityId, scope, expectedDeletedAt);
    if (!row) throw new Error('Recycle-bin item is unavailable');
    return entryRowSchema.parse(row);
  }
}
