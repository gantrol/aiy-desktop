/* eslint-disable max-lines */
import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { z } from 'zod';
import type {
  ContentLifecycleAction,
  ContentLifecycleApplyInput,
  ContentLifecycleApplyResult,
  ContentLifecycleEntityType,
  ContentLifecycleItemDto,
  ContentLifecycleItemRef,
  ContentLifecycleKind,
  ContentLifecycleListInput,
  ContentLifecyclePageDto,
  ContentLifecyclePlanDto,
  ContentLifecyclePlanInput,
  ContentLifecyclePurgeInput,
  ContentLifecyclePurgePlanDto,
  ContentLifecyclePurgePlanInput,
  ContentLifecyclePurgeResult,
  ContentLifecycleRestoreInput,
  ContentLifecycleRestoreResult,
  ContentLifecycleSubtype,
  ContentLifecycleTarget,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { promptSeriesRecoveryPayloadSchema, recycleBinPurgeAfter } from '@/main/database/recovery/recycle-bin-entry';

const entityTypeSchema = z.enum([
  'GIF_DOCUMENT',
  'ALBUM',
  'CREATION_ITEM',
  'PROMPT_SERIES',
  'CREATION',
  'INSPIRATION_STASH',
  'IMAGE_BREAKDOWN',
  'EVALUATION_SUITE',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'MATERIAL',
  'IMAGE_ASSET',
]);
const kindSchema = z.enum(['ALBUM', 'CREATION', 'MATERIAL']);
const subtypeSchema = z.enum([
  'GIF_DOCUMENT',
  'CREATION_ALBUM',
  'MATERIAL_ALBUM',
  'PROMPT_SERIES',
  'IDEA_CREATION',
  'INSPIRATION_STASH',
  'IMAGE_BREAKDOWN',
  'EVALUATION_SUITE',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'IMAGE_MATERIAL',
  'VIDEO_MATERIAL',
  'TEXT_MATERIAL',
]);
const batchRowSchema = z
  .object({
    id: z.string().min(1),
    action: z.enum(['ARCHIVE', 'DELETE']),
    root_entity_type: entityTypeSchema,
    root_entity_id: z.string().min(1),
    root_kind: kindSchema,
    root_subtype: subtypeSchema,
    title: z.string().min(1),
    preview_asset_id: z.string().nullable(),
    preview_text: z.string().nullable(),
    state_before_action: z.enum(['ACTIVE', 'ARCHIVED']),
    changed_at: z.string().min(1),
    expires_at: z.string().nullable(),
    purge_state: z.enum(['RETAINED', 'PURGE_PENDING', 'FAILED']).nullable(),
    purge_error: z.string().nullable(),
  })
  .passthrough();
const memberRowSchema = z
  .object({
    batch_id: z.string().min(1),
    entity_type: entityTypeSchema,
    entity_id: z.string().min(1),
    kind: kindSchema,
    subtype: subtypeSchema,
    title: z.string().min(1),
    preview_asset_id: z.string().nullable(),
    preview_text: z.string().nullable(),
    parent_entity_type: entityTypeSchema.nullable(),
    parent_entity_id: z.string().nullable(),
    sort_order: z.number().int().nonnegative(),
    state_before_action: z.enum(['ACTIVE', 'ARCHIVED', 'PRESERVED']),
    payload_json: z.string(),
  })
  .passthrough();
const relationPayloadSchema = z
  .object({
    id: z.string().min(1),
    albumId: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    sortOrder: z.number().int().nonnegative(),
    createdAt: z.string().min(1),
  })
  .strict();
const memberPayloadSchema = z
  .object({
    statusBefore: z.string().min(1).optional(),
    relations: z.array(relationPayloadSchema).max(100_000).optional(),
  })
  .strict();

type BatchRow = z.infer<typeof batchRowSchema>;
type MemberRow = z.infer<typeof memberRowSchema>;
type MemberPayload = z.infer<typeof memberPayloadSchema>;

interface Snapshot {
  entityType: ContentLifecycleEntityType;
  entityId: string;
  kind: ContentLifecycleKind;
  subtype: ContentLifecycleSubtype;
  title: string;
  previewAssetId: string | null;
  previewText: string | null;
  parentEntityType: ContentLifecycleEntityType | null;
  parentEntityId: string | null;
  sortOrder: number;
  stateBeforeAction: 'ACTIVE' | 'ARCHIVED' | 'PRESERVED';
  payload: MemberPayload;
  changedAt: string;
}

interface PreparedOperation {
  root: Snapshot;
  members: Snapshot[];
}

interface PurgeableManagedAsset {
  assetId: string;
  relativePath: string;
  unlinkPath: boolean;
}

const CONTAINER_PREFIX = 'lifecycle:';
const CREATION_PRIMARY_ROLES = new Set([
  'ANIMATION',
  'IMAGE_BREAKDOWN',
  'IMAGE_CREATION',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'EVALUATION_SUITE',
]);

function key(input: Pick<ContentLifecycleTarget, 'entityType' | 'entityId'>) {
  return `${input.entityType}:${input.entityId}`;
}

function encodeContainer(action: ContentLifecycleAction, batchId: string, albumId: string) {
  return `${CONTAINER_PREFIX}${Buffer.from(JSON.stringify([action, batchId, albumId]), 'utf8').toString('base64url')}`;
}

function decodeContainer(value: string) {
  if (!value.startsWith(CONTAINER_PREFIX)) throw new Error('Content lifecycle container is invalid');
  try {
    return z
      .tuple([z.enum(['ARCHIVE', 'DELETE']), z.string().min(1), z.string().min(1)])
      .parse(JSON.parse(Buffer.from(value.slice(CONTAINER_PREFIX.length), 'base64url').toString('utf8')));
  } catch {
    throw new Error('Content lifecycle container is invalid');
  }
}

function encodeOffset(offset: number) {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodeOffset(value: string | null | undefined) {
  if (!value) return 0;
  const offset = Number(Buffer.from(value, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Content lifecycle cursor is invalid');
  return offset;
}

function nodeErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

export class ContentLifecycleRepository {
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

  list(input: ContentLifecycleListInput): ContentLifecyclePageDto {
    const action: ContentLifecycleAction = input.state === 'ARCHIVED' ? 'ARCHIVE' : 'DELETE';
    const limit = input.limit ?? 50;
    const offset = decodeOffset(input.cursor);
    let items: ContentLifecycleItemDto[];
    if (input.containerId) {
      const [containerAction, batchId, albumId] = decodeContainer(input.containerId);
      if (containerAction !== action) throw new Error('Content lifecycle container state changed');
      const batch = this.requireBatch(batchId, action);
      const rows = memberRowSchema.array().parse(
        this.db
          .prepare(
            `SELECT * FROM content_lifecycle_batch_members
            WHERE batch_id = ? AND parent_entity_type = 'ALBUM' AND parent_entity_id = ?
            ORDER BY sort_order, entity_type, entity_id`,
          )
          .all(batchId, albumId),
      );
      items = rows.map((row) => this.memberDto(row, batch, input.containerId ?? null));
    } else {
      const rows = batchRowSchema.array().parse(
        this.db
          .prepare(
            `SELECT * FROM content_lifecycle_batches
            WHERE action = ? AND (? IS NULL OR root_kind = ?)
            ORDER BY changed_at DESC, root_entity_type, root_entity_id`,
          )
          .all(action, input.kind ?? null, input.kind ?? null),
      );
      items = rows.filter((row) => this.batchIsVisible(row)).map((row) => this.batchDto(row));
    }
    const total = items.length;
    const visible = items.slice(offset, offset + limit);
    return {
      items: visible,
      total,
      nextCursor: offset + visible.length < total ? encodeOffset(offset + visible.length) : null,
    };
  }

  plan(input: ContentLifecyclePlanInput): ContentLifecyclePlanDto {
    const operations = this.prepare(input.action, input.targets);
    return this.planPrepared(input.action, operations);
  }

  apply(input: ContentLifecycleApplyInput): ContentLifecycleApplyResult {
    return this.db.transaction(() => {
      const operations = this.prepare(input.action, input.targets);
      const plan = this.planPrepared(input.action, operations);
      if (plan.confirmationToken !== input.confirmationToken) {
        throw new Error('Content changed before confirmation');
      }
      const changedAt = now();
      for (const operation of operations) this.applyOperation(input.action, operation, changedAt);
      return { affected: plan.count };
    })();
  }

  applyDirect(action: ContentLifecycleAction, target: ContentLifecycleTarget) {
    const input = { action, targets: [target] } satisfies ContentLifecyclePlanInput;
    const plan = this.plan(input);
    return this.apply({ ...input, confirmationToken: plan.confirmationToken });
  }

  setDirectArchived(target: ContentLifecycleTarget, archived: boolean) {
    if (archived) return this.applyDirect('ARCHIVE', target);
    const normalized = this.normalizeTarget(target);
    const row = this.db
      .prepare(
        `SELECT batch.root_entity_type, batch.root_entity_id, batch.changed_at
        FROM content_lifecycle_batches batch
        WHERE batch.action = 'ARCHIVE'
          AND (
            (batch.root_entity_type = ? AND batch.root_entity_id = ?)
            OR EXISTS (
              SELECT 1 FROM content_lifecycle_batch_members member
              WHERE member.batch_id = batch.id
                AND member.entity_type = ? AND member.entity_id = ?
            )
          )
        ORDER BY batch.changed_at DESC LIMIT 1`,
      )
      .get(normalized.entityType, normalized.entityId, normalized.entityType, normalized.entityId) as
      JsonMap | undefined;
    if (!row) throw new Error('Archived content is unavailable');
    return this.restore({
      entityType: entityTypeSchema.parse(row.root_entity_type),
      entityId: text(row.root_entity_id),
      expectedChangedAt: text(row.changed_at),
    });
  }

  restore(input: ContentLifecycleRestoreInput): ContentLifecycleRestoreResult {
    return this.db.transaction(() => {
      const batch = this.requireRootBatch(input);
      if (batch.purge_state === 'PURGE_PENDING') throw new Error('This content is being permanently deleted');
      const members = this.members(batch.id);
      const impact = this.batchImpactCounts(batch.id);
      const rootKey = key({ entityType: batch.root_entity_type, entityId: batch.root_entity_id });
      if (batch.action === 'ARCHIVE') {
        for (const member of [...members].reverse()) {
          if (member.state_before_action !== 'ACTIVE') continue;
          this.restoreArchivedMember(member);
          if (key({ entityType: member.entity_type, entityId: member.entity_id }) !== rootKey) {
            this.recordEntityChange(member.entity_type, member.entity_id, 'RESTORE', { batchId: batch.id });
          }
        }
      } else {
        this.ensureRestoredArchiveBatch(batch);
        for (const member of members) {
          if (member.state_before_action === 'PRESERVED') continue;
          this.restoreDeletedMember(member, batch.changed_at);
          if (key({ entityType: member.entity_type, entityId: member.entity_id }) !== rootKey) {
            this.recordEntityChange(member.entity_type, member.entity_id, 'RESTORE', {
              batchId: batch.id,
              stateBeforeAction: member.state_before_action,
            });
          }
        }
        this.restoreLegacyRecoveryPayload(batch);
        for (const member of members) this.restoreRelations(member, batch.id);
        this.db
          .prepare('DELETE FROM recycle_bin_entries WHERE entity_type = ? AND entity_id = ?')
          .run(batch.root_entity_type, batch.root_entity_id);
      }
      this.db.prepare('DELETE FROM content_lifecycle_batches WHERE id = ?').run(batch.id);
      this.recordEntityChange(batch.root_entity_type, batch.root_entity_id, 'RESTORE', {
        batchId: batch.id,
        stateBeforeAction: batch.state_before_action,
      });
      return { restored: impact.albumCount + impact.contentCount };
    })();
  }

  planPurge(input: ContentLifecyclePurgePlanInput): ContentLifecyclePurgePlanDto {
    const rows = this.purgeSelection(input);
    const hash = createHash('sha256');
    for (const row of rows)
      hash.update(`${row.id}\0${row.root_entity_type}\0${row.root_entity_id}\0${row.changed_at}\n`);
    let albumCount = 0;
    let contentCount = 0;
    for (const row of rows) {
      const counts = this.batchImpactCounts(row.id);
      albumCount += counts.albumCount;
      contentCount += counts.contentCount;
    }
    return { confirmationToken: hash.digest('hex'), count: rows.length, albumCount, contentCount };
  }

  async purge(input: ContentLifecyclePurgeInput): Promise<ContentLifecyclePurgeResult> {
    const plan = this.planPurge(input);
    if (plan.confirmationToken !== input.confirmationToken) throw new Error('Content changed before confirmation');
    const rows = this.purgeSelection(input);
    if (rows.length === 0) return { purged: 0, failed: 0 };
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE content_lifecycle_batches
        SET purge_state = 'PURGE_PENDING', purge_requested_at = ?, purge_error = NULL, updated_at = ?
        WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .run(timestamp, timestamp, JSON.stringify(rows.map((row) => row.id)));
    return this.enqueueCleanup(() => this.processPending(new Set(rows.map((row) => row.id))));
  }

  startAutomaticCleanup() {
    if (this.cleanupTimer) return;
    this.stopped = false;
    void this.enqueueCleanup(() => this.processDue()).catch((error) => {
      console.error('[content-lifecycle] automatic cleanup failed', error);
    });
    this.cleanupTimer = setInterval(
      () => {
        void this.enqueueCleanup(() => this.processDue()).catch((error) => {
          console.error('[content-lifecycle] automatic cleanup failed', error);
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

  private prepare(action: ContentLifecycleAction, targets: readonly ContentLifecycleTarget[]) {
    const normalized = [
      ...new Map(
        targets.map((target) => {
          if (target.scope === 'FORM' && action !== 'DELETE') {
            throw new Error('Creation forms can only be moved to the recycle bin');
          }
          const resolved = this.normalizeTarget(target);
          if (
            action === 'DELETE' &&
            resolved.entityType === 'IMAGE_ASSET' &&
            this.imageAssetHasActiveContentReference(resolved.entityId)
          ) {
            throw new Error('IMAGE_ASSET_USED_BY_ACTIVE_CONTENT');
          }
          if (action === 'ARCHIVE' && resolved.entityType === 'IMAGE_ASSET') {
            throw new Error('Image assets require a material identity before archiving');
          }
          return [key(resolved), resolved];
        }),
      ).values(),
    ];
    normalized.sort((left, right) => (left.entityType === 'ALBUM' ? -1 : right.entityType === 'ALBUM' ? 1 : 0));
    const claimed = new Set<string>();
    const operations: PreparedOperation[] = [];
    for (const target of normalized) {
      if (claimed.has(key(target))) continue;
      const members =
        target.entityType === 'ALBUM'
          ? this.snapshotAlbum(target.entityId)
          : target.entityType === 'CREATION_ITEM'
            ? this.snapshotCreationItem(target.entityId)
            : target.entityType === 'GIF_DOCUMENT' && target.scope === 'FORM'
              ? this.snapshotGifDocument(target.entityId)
              : [this.snapshotEntity(target)];
      if (members.length === 0) throw new Error('Content is unavailable');
      const root = members.find((member) => key(member) === key(target));
      if (!root) throw new Error('Content is unavailable');
      if (action === 'ARCHIVE' && root.stateBeforeAction === 'ARCHIVED') throw new Error('Content is already archived');
      operations.push({ root, members });
      for (const member of members) claimed.add(key(member));
    }
    return operations;
  }

  private planPrepared(action: ContentLifecycleAction, operations: readonly PreparedOperation[]) {
    const hash = createHash('sha256');
    hash.update(`${action}\n`);
    let count = 0;
    let albumCount = 0;
    for (const operation of operations) {
      hash.update(`root:${key(operation.root)}\n`);
      for (const member of operation.members) {
        hash.update(`${JSON.stringify(member)}\n`);
        if (
          member.parentEntityType === 'CREATION_ITEM' ||
          (member.parentEntityType === 'GIF_DOCUMENT' && member.subtype === 'GIF_DOCUMENT') ||
          member.stateBeforeAction === 'PRESERVED'
        )
          continue;
        count += 1;
        if (member.kind === 'ALBUM') albumCount += 1;
      }
    }
    return {
      confirmationToken: hash.digest('hex'),
      count,
      albumCount,
      contentCount: count - albumCount,
    } satisfies ContentLifecyclePlanDto;
  }

  private applyOperation(action: ContentLifecycleAction, operation: PreparedOperation, changedAt: string) {
    const batchId = ulid();
    this.db
      .prepare('DELETE FROM content_lifecycle_batches WHERE action = ? AND root_entity_type = ? AND root_entity_id = ?')
      .run(action, operation.root.entityType, operation.root.entityId);
    this.db
      .prepare(
        `INSERT INTO content_lifecycle_batches (
          id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
          preview_asset_id, preview_text, state_before_action, changed_at, expires_at,
          purge_state, purge_requested_at, purge_error, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        batchId,
        action,
        operation.root.entityType,
        operation.root.entityId,
        operation.root.kind,
        operation.root.subtype,
        operation.root.title,
        operation.root.previewAssetId,
        operation.root.previewText,
        operation.root.stateBeforeAction === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
        changedAt,
        action === 'DELETE' ? recycleBinPurgeAfter(changedAt) : null,
        action === 'DELETE' ? 'RETAINED' : null,
        changedAt,
      );
    const insertMember = this.db.prepare(
      `INSERT INTO content_lifecycle_batch_members (
        batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
        preview_text, parent_entity_type, parent_entity_id, sort_order, state_before_action, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const rootKey = key(operation.root);
    for (const member of operation.members) {
      insertMember.run(
        batchId,
        member.entityType,
        member.entityId,
        member.kind,
        member.subtype,
        member.title,
        member.previewAssetId,
        member.previewText,
        member.parentEntityType,
        member.parentEntityId,
        member.sortOrder,
        member.stateBeforeAction,
        JSON.stringify(member.payload),
      );
      if (member.stateBeforeAction === 'PRESERVED') continue;
      if (action === 'ARCHIVE' && member.stateBeforeAction === 'ARCHIVED') continue;
      if (action === 'ARCHIVE') this.archiveEntity(member, changedAt);
      else this.deleteEntity(member, changedAt);
      if (key(member) !== rootKey) {
        this.recordEntityChange(member.entityType, member.entityId, action, {
          batchId,
          stateBeforeAction: member.stateBeforeAction,
        });
      }
    }
    if (action === 'DELETE') {
      for (const member of operation.members) this.deleteRelations(member, changedAt, batchId);
    }
    this.recordEntityChange(operation.root.entityType, operation.root.entityId, action, {
      batchId,
      affected: operation.members.length,
    });
  }

  private normalizeTarget(target: ContentLifecycleTarget): ContentLifecycleTarget {
    if (target.entityType === 'INSPIRATION_STASH') return this.normalizeTarget({ ...target, entityType: 'ARTICLE' });
    if (target.scope === 'FORM') {
      if (target.entityType !== 'GIF_DOCUMENT') throw new Error('This creation form cannot be deleted separately');
      const form = this.db
        .prepare(
          `SELECT form.id, form.creation_item_id
          FROM creation_forms form
          JOIN creation_items item ON item.id = form.creation_item_id
            AND item.deleted_at IS NULL AND item.archived_at IS NULL
          JOIN gif_documents document ON document.id = form.entity_id
            AND document.purpose = 'GIF' AND document.deleted_at IS NULL
          WHERE form.entity_type = 'GIF_DOCUMENT' AND form.entity_id = ? AND form.deleted_at IS NULL`,
        )
        .get(target.entityId) as JsonMap | undefined;
      if (!form) throw new Error('Animation is unavailable');
      const creationItemId = text(form.creation_item_id);
      const remaining = this.db
        .prepare(
          `SELECT role FROM creation_forms
          WHERE creation_item_id = ? AND id <> ? AND deleted_at IS NULL
          ORDER BY sort_order, created_at, id`,
        )
        .all(creationItemId, text(form.id)) as JsonMap[];
      if (remaining.length === 0) return { entityType: 'CREATION_ITEM', entityId: creationItemId };
      if (
        !remaining.some((row) => CREATION_PRIMARY_ROLES.has(text(row.role))) &&
        remaining.some((row) => text(row.role) !== 'INSPIRATION')
      ) {
        throw new Error('Delete dependent creation forms before deleting this animation');
      }
      return target;
    }
    if (target.entityType === 'IMAGE_ASSET') {
      const rows = this.db
        .prepare(
          `SELECT id FROM materials
          WHERE image_asset_id = ? AND deleted_at IS NULL
          ORDER BY created_at, id LIMIT 2`,
        )
        .all(target.entityId) as JsonMap[];
      if (rows.length > 1) throw new Error('Material identity is ambiguous');
      return rows.length === 1 ? { entityType: 'MATERIAL', entityId: text(rows[0].id) } : target;
    }
    const formEntityType = this.creationFormEntityType(target.entityType);
    if (!formEntityType) return target;
    const row = this.db
      .prepare(
        `SELECT form.creation_item_id
        FROM creation_forms form
        JOIN creation_items item ON item.id = form.creation_item_id AND item.deleted_at IS NULL
        WHERE form.entity_type = ? AND form.entity_id = ? AND form.deleted_at IS NULL`,
      )
      .get(formEntityType, target.entityId) as JsonMap | undefined;
    return row ? { entityType: 'CREATION_ITEM', entityId: text(row.creation_item_id) } : target;
  }

  private imageAssetHasActiveContentReference(assetId: string) {
    const article = this.db
      .prepare(
        `SELECT 1
        FROM articles article
        JOIN article_revisions revision ON revision.id = article.current_revision_id
        WHERE article.deleted_at IS NULL AND EXISTS (
          SELECT 1
          FROM json_each(
            CASE WHEN json_valid(revision.content_json) THEN revision.content_json ELSE '{}' END,
            '$.mediaBindings'
          ) binding
          WHERE json_extract(binding.value, '$.assetId') = ?
        )
        LIMIT 1`,
      )
      .get(assetId);
    if (article) return true;
    return Boolean(
      this.db
        .prepare(
          `SELECT 1
          FROM social_post_drafts draft
          JOIN social_post_revisions revision ON revision.id = draft.current_revision_id
          WHERE draft.deleted_at IS NULL AND EXISTS (
            SELECT 1
            FROM json_each(
              CASE WHEN json_valid(revision.content_json) THEN revision.content_json ELSE '{}' END,
              '$.mediaAssetIds'
            ) asset
            WHERE asset.value = ?
          )
          LIMIT 1`,
        )
        .get(assetId),
    );
  }

  private snapshotGifDocument(documentId: string): Snapshot[] {
    const root = this.snapshotEntity({ entityType: 'GIF_DOCUMENT', entityId: documentId });
    const row = this.db
      .prepare(
        `SELECT json_extract(revision.manifest_json, '$.motionDocumentId') AS motion_document_id
        FROM gif_documents document
        JOIN gif_document_revisions revision
          ON revision.document_id = document.id AND revision.revision = document.revision
        WHERE document.id = ? AND document.purpose = 'GIF'`,
      )
      .get(documentId) as JsonMap | undefined;
    const motionDocumentId = row?.motion_document_id ? text(row.motion_document_id) : null;
    if (!motionDocumentId || motionDocumentId === documentId) return [root];
    const available = this.db
      .prepare(
        `SELECT 1 FROM gif_documents motion
        WHERE motion.id = ? AND motion.purpose = 'MOTION' AND motion.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM gif_documents editor
            JOIN gif_document_revisions revision
              ON revision.document_id = editor.id AND revision.revision = editor.revision
            WHERE editor.id <> ? AND editor.purpose = 'GIF'
              AND editor.deleted_at IS NULL AND editor.archived_at IS NULL
              AND json_extract(revision.manifest_json, '$.motionDocumentId') = motion.id
          )`,
      )
      .get(motionDocumentId, documentId);
    if (!available) return [root];
    const motion = this.snapshotEntity({ entityType: 'GIF_DOCUMENT', entityId: motionDocumentId });
    motion.parentEntityType = 'GIF_DOCUMENT';
    motion.parentEntityId = documentId;
    motion.sortOrder = root.sortOrder + 1;
    return [root, motion];
  }

  private snapshotAlbum(albumId: string): Snapshot[] {
    const albumRows = this.db
      .prepare(
        `WITH RECURSIVE tree(id, parent_id, sort_order, path) AS (
          SELECT album.id, NULL, 0, '/' || album.id || '/'
          FROM albums album WHERE album.id = ? AND album.deleted_at IS NULL
          UNION ALL
          SELECT child.id, relation.album_id, relation.sort_order, tree.path || child.id || '/'
          FROM tree
          JOIN album_members relation ON relation.album_id = tree.id
            AND relation.target_type = 'ALBUM' AND relation.deleted_at IS NULL
          JOIN albums child ON child.id = relation.target_id AND child.deleted_at IS NULL
          WHERE instr(tree.path, '/' || child.id || '/') = 0
        )
        SELECT album.*, tree.parent_id, tree.sort_order
        FROM tree JOIN albums album ON album.id = tree.id`,
      )
      .all(albumId) as JsonMap[];
    if (albumRows.length === 0) throw new Error('Album not found');
    const albumIds = albumRows.map((row) => text(row.id));
    const albumSet = new Set(albumIds);
    const snapshots: Snapshot[] = albumRows.map((row) => {
      const id = text(row.id);
      const parentId = row.parent_id ? text(row.parent_id) : null;
      return {
        entityType: 'ALBUM',
        entityId: id,
        kind: 'ALBUM',
        subtype: text(row.intent) === 'MATERIAL_LIBRARY' ? 'MATERIAL_ALBUM' : 'CREATION_ALBUM',
        title: text(row.title).trim() || id,
        previewAssetId: null,
        previewText: null,
        parentEntityType: parentId ? 'ALBUM' : null,
        parentEntityId: parentId,
        sortOrder: Number(row.sort_order ?? 0),
        stateBeforeAction: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
        payload: {
          statusBefore: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
          relations: this.activeRelations('ALBUM', id),
        },
        changedAt: text(row.updated_at) || text(row.created_at),
      };
    });
    const relationRows = this.db
      .prepare(
        `SELECT * FROM album_members
        WHERE album_id IN (SELECT value FROM json_each(?))
          AND target_type <> 'ALBUM' AND deleted_at IS NULL
        ORDER BY album_id, sort_order, id`,
      )
      .all(JSON.stringify(albumIds)) as JsonMap[];
    const seen = new Set(snapshots.map(key));
    for (const relation of relationRows) {
      const entityType = this.albumTargetEntityType(text(relation.target_type));
      if (!entityType) continue;
      const entityId = text(relation.target_id);
      const entityKey = key({ entityType, entityId });
      if (seen.has(entityKey)) continue;
      const entitySnapshots =
        entityType === 'CREATION_ITEM'
          ? this.snapshotCreationItem(entityId)
          : [this.snapshotEntity({ entityType, entityId })];
      const snapshot = entitySnapshots[0];
      const relations = this.activeRelations(text(relation.target_type), entityId);
      const outsideOwner = relations.some((item) => !albumSet.has(item.albumId));
      snapshot.parentEntityType = 'ALBUM';
      snapshot.parentEntityId = text(relation.album_id);
      snapshot.sortOrder = Number(relation.sort_order ?? 0);
      snapshot.payload.relations = relations.filter((item) => albumSet.has(item.albumId));
      if (outsideOwner) {
        for (const entitySnapshot of entitySnapshots) entitySnapshot.stateBeforeAction = 'PRESERVED';
      }
      for (const entitySnapshot of entitySnapshots) {
        const snapshotKey = key(entitySnapshot);
        if (seen.has(snapshotKey)) continue;
        snapshots.push(entitySnapshot);
        seen.add(snapshotKey);
      }
    }
    return snapshots;
  }

  private snapshotCreationItem(creationItemId: string): Snapshot[] {
    const row = this.db
      .prepare(
        `SELECT item.*
        FROM creation_items item
        WHERE item.id = ? AND item.deleted_at IS NULL`,
      )
      .get(creationItemId) as JsonMap | undefined;
    if (!row) throw new Error('Content is unavailable');
    const formRows = this.db
      .prepare(
        `SELECT id, entity_type, entity_id, sort_order
        FROM creation_forms
        WHERE creation_item_id = ? AND deleted_at IS NULL
        ORDER BY sort_order, created_at, id`,
      )
      .all(creationItemId) as JsonMap[];
    const owned: Array<{ formId: string | null; snapshot: Snapshot }> = [];
    for (const form of formRows) {
      const entityType = this.creationFormEntityType(text(form.entity_type));
      if (!entityType) continue;
      const snapshots =
        entityType === 'GIF_DOCUMENT'
          ? this.snapshotGifDocument(text(form.entity_id))
          : [this.snapshotEntity({ entityType, entityId: text(form.entity_id) })];
      const [snapshot, ...dependencies] = snapshots;
      snapshot.parentEntityType = 'CREATION_ITEM';
      snapshot.parentEntityId = creationItemId;
      snapshot.sortOrder = Number(form.sort_order ?? 0);
      owned.push({ formId: text(form.id), snapshot });
      for (const dependency of dependencies) owned.push({ formId: null, snapshot: dependency });
    }
    if (!owned.length) throw new Error('Creation item has no lifecycle content');
    const primaryFormId = row.primary_form_id ? text(row.primary_form_id) : null;
    const presentation = owned.find((entry) => entry.formId === primaryFormId)?.snapshot ?? owned[0].snapshot;
    const relations = this.activeRelations('CREATION_ITEM', creationItemId);
    const parent = relations[0] ?? null;
    const aggregate: Snapshot = {
      entityType: 'CREATION_ITEM',
      entityId: creationItemId,
      kind: 'CREATION',
      subtype: presentation.subtype,
      title: presentation.title,
      previewAssetId: presentation.previewAssetId,
      previewText: presentation.previewText,
      parentEntityType: parent ? 'ALBUM' : null,
      parentEntityId: parent?.albumId ?? null,
      sortOrder: parent?.sortOrder ?? 0,
      stateBeforeAction: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
      payload: relations.length ? { relations } : {},
      changedAt: text(row.updated_at) || text(row.created_at),
    };
    return [aggregate, ...new Map(owned.map((entry) => [key(entry.snapshot), entry.snapshot] as const)).values()];
  }

  // The closed entity union keeps table/status/title handling auditable at this process boundary.
  // eslint-disable-next-line complexity
  private snapshotEntity(target: ContentLifecycleTarget): Snapshot {
    const type = target.entityType;
    const id = target.entityId;
    if (type === 'ALBUM') return this.snapshotAlbum(id)[0];
    if (type === 'CREATION_ITEM') return this.snapshotCreationItem(id)[0];
    let row: JsonMap | undefined;
    let kind: ContentLifecycleKind = 'CREATION';
    let subtype: ContentLifecycleSubtype;
    let title = id;
    let previewAssetId: string | null = null;
    let previewText: string | null = null;
    let archived = false;
    let statusBefore: string | undefined;
    let changedAt = '';
    if (type === 'PROMPT_SERIES') {
      row = this.db
        .prepare(
          `SELECT series.*,
            (SELECT cover.image_asset_id FROM prompt_series_cover_assets cover
             WHERE cover.series_id = series.id ORDER BY cover.sort_order, cover.image_asset_id LIMIT 1) AS preview_asset_id
          FROM prompt_series series WHERE series.id = ? AND series.deleted_at IS NULL`,
        )
        .get(id) as JsonMap | undefined;
      subtype = 'PROMPT_SERIES';
      title = row ? text(row.title) : id;
      previewAssetId = row?.preview_asset_id ? text(row.preview_asset_id) : null;
      archived = Boolean(row?.archived_at);
      changedAt = row ? text(row.archived_at) || text(row.created_at) : '';
    } else if (type === 'CREATION') {
      row = this.db.prepare('SELECT * FROM creations WHERE id = ? AND deleted_at IS NULL').get(id) as
        JsonMap | undefined;
      subtype = 'IDEA_CREATION';
      title = row ? text(row.title) : id;
      previewText = row ? text(row.brief_text).slice(0, 500) || null : null;
      statusBefore = row ? text(row.status) : undefined;
      archived = statusBefore === 'ARCHIVED';
      changedAt = row ? text(row.updated_at) : '';
    } else if (type === 'INSPIRATION_STASH') {
      row = this.db.prepare('SELECT * FROM inspiration_stashes WHERE id = ? AND deleted_at IS NULL').get(id) as
        JsonMap | undefined;
      subtype = 'INSPIRATION_STASH';
      title = row ? this.jsonTitle(row.input_json, id) : id;
      previewText = row ? text(row.input_json).slice(0, 500) : null;
      statusBefore = row ? text(row.status) : undefined;
      archived = statusBefore === 'ARCHIVED';
      changedAt = row ? text(row.updated_at) : '';
    } else if (type === 'IMAGE_BREAKDOWN') {
      row = this.db.prepare('SELECT * FROM image_breakdowns WHERE id = ? AND deleted_at IS NULL').get(id) as
        JsonMap | undefined;
      subtype = 'IMAGE_BREAKDOWN';
      title = row ? text(row.title) : id;
      previewAssetId = row?.source_asset_id ? text(row.source_asset_id) : null;
      previewText = row?.result_json ? text(row.result_json).slice(0, 500) : null;
      archived = Boolean(row?.archived_at);
      changedAt = row ? text(row.updated_at) : '';
    } else if (type === 'EVALUATION_SUITE') {
      row = this.db
        .prepare(
          `SELECT suite.*, revision.content_json
          FROM evaluation_suites suite
          LEFT JOIN evaluation_suite_revisions revision ON revision.id = suite.current_revision_id
          WHERE suite.id = ? AND suite.deleted_at IS NULL`,
        )
        .get(id) as JsonMap | undefined;
      subtype = 'EVALUATION_SUITE';
      title = row ? this.jsonTitle(row.content_json, id) : id;
      previewText = row ? text(row.content_json).slice(0, 500) : null;
      statusBefore = row ? text(row.status) : undefined;
      archived = statusBefore === 'ARCHIVED';
      changedAt = row ? text(row.updated_at) : '';
    } else if (type === 'SOCIAL_POST' || type === 'ARTICLE') {
      const table = type === 'SOCIAL_POST' ? 'social_post_drafts' : 'articles';
      const revisionTable = type === 'SOCIAL_POST' ? 'social_post_revisions' : 'article_revisions';
      const ownerColumn = type === 'SOCIAL_POST' ? 'draft_id' : 'article_id';
      row = this.db
        .prepare(
          `SELECT owner.*, revision.content_json
          FROM ${table} owner LEFT JOIN ${revisionTable} revision ON revision.id = owner.current_revision_id
          WHERE owner.id = ? AND owner.deleted_at IS NULL`,
        )
        .get(id) as JsonMap | undefined;
      subtype = type === 'SOCIAL_POST' ? 'SOCIAL_POST' : 'ARTICLE';
      title = row ? this.jsonTitle(row.content_json, id) : id;
      previewText = row ? text(row.content_json).slice(0, 500) : null;
      statusBefore = row ? text(row.status) : undefined;
      archived = statusBefore === 'ARCHIVED';
      changedAt = row ? text(row.updated_at) : '';
      void ownerColumn;
    } else if (type === 'GIF_DOCUMENT') {
      row = this.db
        .prepare(
          `SELECT d.*, json_extract(r.manifest_json,'$.frames[0].assetId') AS preview_asset_id
        FROM gif_documents d JOIN gif_document_revisions r ON r.document_id=d.id AND r.revision=d.revision
        WHERE d.id=? AND d.deleted_at IS NULL`,
        )
        .get(id) as JsonMap | undefined;
      subtype = 'GIF_DOCUMENT';
      title = row ? text(row.title) || id : id;
      previewAssetId = row?.preview_asset_id ? text(row.preview_asset_id) : null;
      statusBefore = row ? text(row.status) : undefined;
      archived = Boolean(row?.archived_at);
      changedAt = row ? text(row.updated_at) : '';
    } else if (type === 'VIDEO_DOCUMENT') {
      row = this.db
        .prepare(
          `SELECT document.*,
            (SELECT material.image_asset_id FROM document_source_relations source
             JOIN materials material ON material.id = source.material_id
             WHERE source.document_id = document.id LIMIT 1) AS preview_asset_id
          FROM documents document WHERE document.id = ? AND document.deleted_at IS NULL`,
        )
        .get(id) as JsonMap | undefined;
      subtype = 'VIDEO_DOCUMENT';
      title = row ? text(row.title) : id;
      previewAssetId = row?.preview_asset_id ? text(row.preview_asset_id) : null;
      statusBefore = row ? text(row.status) : undefined;
      archived = statusBefore === 'ARCHIVED';
      changedAt = row ? text(row.updated_at) : '';
    } else if (type === 'MATERIAL') {
      row = this.db
        .prepare(
          `SELECT material.*, asset.mime_type, metadata.display_name, metadata.original_name
          FROM materials material
          LEFT JOIN image_assets asset ON asset.id = material.image_asset_id
          LEFT JOIN external_material_metadata metadata ON metadata.material_id = material.id
          WHERE material.id = ? AND material.deleted_at IS NULL`,
        )
        .get(id) as JsonMap | undefined;
      kind = 'MATERIAL';
      subtype =
        text(row?.kind) === 'TEXT'
          ? 'TEXT_MATERIAL'
          : text(row?.kind) === 'VIDEO'
            ? 'VIDEO_MATERIAL'
            : 'IMAGE_MATERIAL';
      title = row
        ? text(row.display_name).trim() || text(row.original_name).trim() || text(row.text_content).slice(0, 80) || id
        : id;
      previewAssetId = row?.image_asset_id ? text(row.image_asset_id) : null;
      previewText = row?.text_content ? text(row.text_content).slice(0, 500) : null;
      archived = Boolean(row?.archived_at);
      changedAt = row ? text(row.archived_at) || text(row.created_at) : '';
    } else {
      row = this.db.prepare('SELECT * FROM image_assets WHERE id = ? AND deleted_at IS NULL').get(id) as
        JsonMap | undefined;
      kind = 'MATERIAL';
      subtype = text(row?.mime_type).startsWith('video/') ? 'VIDEO_MATERIAL' : 'IMAGE_MATERIAL';
      title = row ? path.basename(text(row.relative_path)) || id : id;
      previewAssetId = id;
      changedAt = row ? text(row.created_at) : '';
    }
    if (!row) throw new Error('Content is unavailable');
    const targetType = this.entityAlbumTargetType(type);
    const relations = targetType ? this.activeRelations(targetType, id) : [];
    const parent = relations[0] ?? null;
    return {
      entityType: type,
      entityId: id,
      kind,
      subtype,
      title: title.trim() || id,
      previewAssetId,
      previewText,
      parentEntityType: parent ? 'ALBUM' : null,
      parentEntityId: parent?.albumId ?? null,
      sortOrder: parent?.sortOrder ?? 0,
      stateBeforeAction: archived ? 'ARCHIVED' : 'ACTIVE',
      payload: { ...(statusBefore ? { statusBefore } : {}), ...(relations.length ? { relations } : {}) },
      changedAt,
    };
  }

  private activeRelations(targetType: string, targetId: string) {
    const rows = this.db
      .prepare(
        `SELECT id, album_id, target_type, target_id, sort_order, created_at
        FROM album_members WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL
        ORDER BY sort_order, id`,
      )
      .all(targetType, targetId) as JsonMap[];
    return rows.map((row) => ({
      id: text(row.id),
      albumId: text(row.album_id),
      targetType: text(row.target_type),
      targetId: text(row.target_id),
      sortOrder: Number(row.sort_order),
      createdAt: text(row.created_at),
    }));
  }

  private archiveEntity(member: Snapshot, timestamp: string) {
    if (member.entityType === 'ALBUM')
      this.db
        .prepare('UPDATE albums SET archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, member.entityId);
    else if (member.entityType === 'CREATION_ITEM')
      this.db
        .prepare('UPDATE creation_items SET archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, member.entityId);
    else if (member.entityType === 'PROMPT_SERIES')
      this.db
        .prepare('UPDATE prompt_series SET archived_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, member.entityId);
    else if (member.entityType === 'IMAGE_BREAKDOWN')
      this.db
        .prepare('UPDATE image_breakdowns SET archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, member.entityId);
    else if (member.entityType === 'MATERIAL')
      this.db
        .prepare('UPDATE materials SET archived_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, member.entityId);
    else if (member.entityType === 'IMAGE_ASSET')
      throw new Error('Image assets must resolve to materials before archiving');
    else {
      const table = this.statusTable(member.entityType);
      this.db
        .prepare(
          `UPDATE ${table} SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(timestamp, timestamp, member.entityId);
    }
  }

  private deleteEntity(member: Snapshot, timestamp: string) {
    if (member.entityType === 'ALBUM')
      this.db
        .prepare('UPDATE albums SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, member.entityId);
    else if (member.entityType === 'CREATION_ITEM')
      this.db
        .prepare('UPDATE creation_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, member.entityId);
    else if (member.entityType === 'PROMPT_SERIES')
      this.db
        .prepare('UPDATE prompt_series SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, member.entityId);
    else if (member.entityType === 'IMAGE_BREAKDOWN')
      this.db
        .prepare('UPDATE image_breakdowns SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, member.entityId);
    else if (member.entityType === 'MATERIAL')
      this.db
        .prepare('UPDATE materials SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, member.entityId);
    else if (member.entityType === 'IMAGE_ASSET')
      this.db
        .prepare('UPDATE image_assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, member.entityId);
    else {
      const table = this.statusTable(member.entityType);
      this.db
        .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
        .run(timestamp, timestamp, member.entityId);
    }
    this.deleteAnimationCreationForm(member, timestamp);
    this.db
      .prepare('INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state) VALUES (?, ?, ?, ?, ?)')
      .run(ulid(), this.changeEntityType(member.entityType), member.entityId, timestamp, 'LOCAL_ONLY');
  }

  private deleteAnimationCreationForm(member: Snapshot, timestamp: string) {
    if (member.entityType !== 'GIF_DOCUMENT') return;
    const row = this.db
      .prepare(
        `SELECT form.id, form.creation_item_id
        FROM creation_forms form
        JOIN creation_items item ON item.id = form.creation_item_id AND item.deleted_at IS NULL
        WHERE form.entity_type = 'GIF_DOCUMENT' AND form.entity_id = ? AND form.deleted_at IS NULL`,
      )
      .get(member.entityId) as JsonMap | undefined;
    if (!row) return;
    const formId = text(row.id);
    const creationItemId = text(row.creation_item_id);
    this.db
      .prepare('UPDATE creation_forms SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(timestamp, timestamp, formId);
    this.repairCreationItem(creationItemId, timestamp);
    this.db
      .prepare('INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state) VALUES (?, ?, ?, ?, ?)')
      .run(ulid(), 'CREATION_FORM', formId, timestamp, 'LOCAL_ONLY');
    this.storage.recordChange('CREATION_FORM', formId, 'DELETE', {
      creationItemId,
      entity: { kind: 'GIF_DOCUMENT', id: member.entityId },
    });
    this.storage.recordChange('CREATION_ITEM', creationItemId, 'UPDATE', { deletedFormId: formId });
  }

  private restoreAnimationCreationForm(member: MemberRow, deletedAt: string) {
    if (member.entity_type !== 'GIF_DOCUMENT') return;
    const row = this.db
      .prepare(
        `SELECT form.id, form.creation_item_id, item.deleted_at AS item_deleted_at
        FROM creation_forms form
        JOIN creation_items item ON item.id = form.creation_item_id
        WHERE form.entity_type = 'GIF_DOCUMENT' AND form.entity_id = ? AND form.deleted_at = ?`,
      )
      .get(member.entity_id, deletedAt) as JsonMap | undefined;
    if (!row) return;
    if (row.item_deleted_at) throw new Error('Restore the parent creation before restoring this animation');
    const timestamp = now();
    const formId = text(row.id);
    const creationItemId = text(row.creation_item_id);
    this.db
      .prepare('UPDATE creation_forms SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?')
      .run(timestamp, formId, deletedAt);
    this.repairCreationItem(creationItemId, timestamp);
    this.storage.recordChange('CREATION_FORM', formId, 'RESTORE', {
      creationItemId,
      entity: { kind: 'GIF_DOCUMENT', id: member.entity_id },
    });
    this.storage.recordChange('CREATION_ITEM', creationItemId, 'UPDATE', { restoredFormId: formId });
  }

  private repairCreationItem(creationItemId: string, timestamp: string) {
    const item = this.db
      .prepare('SELECT primary_form_id FROM creation_items WHERE id = ? AND deleted_at IS NULL')
      .get(creationItemId) as JsonMap | undefined;
    if (!item) return;
    const forms = this.db
      .prepare(
        `SELECT id, role FROM creation_forms
        WHERE creation_item_id = ? AND deleted_at IS NULL
        ORDER BY sort_order, created_at, id`,
      )
      .all(creationItemId) as JsonMap[];
    if (!forms.length) throw new Error('A creation must retain at least one form');
    const currentPrimaryId = item.primary_form_id ? text(item.primary_form_id) : null;
    const primary =
      forms.find((row) => text(row.id) === currentPrimaryId && CREATION_PRIMARY_ROLES.has(text(row.role))) ??
      forms.find((row) => CREATION_PRIMARY_ROLES.has(text(row.role)));
    if (primary) {
      this.db
        .prepare(
          `UPDATE creation_items
          SET primary_form_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(text(primary.id), timestamp, creationItemId);
    } else {
      if (forms.some((row) => text(row.role) !== 'INSPIRATION')) {
        throw new Error('A creation cannot retain only auxiliary forms');
      }
      this.db
        .prepare(
          `UPDATE creation_items
          SET phase = 'DRAFT', primary_form_id = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(timestamp, creationItemId);
    }
    this.db
      .prepare(
        `UPDATE albums
        SET content_updated_at = MAX(COALESCE(content_updated_at, created_at), ?),
          updated_at = MAX(updated_at, ?)
        WHERE id IN (
          SELECT album_id FROM album_members
          WHERE target_type = 'CREATION_ITEM' AND target_id = ? AND deleted_at IS NULL
        ) AND deleted_at IS NULL`,
      )
      .run(timestamp, timestamp, creationItemId);
  }

  private restoreArchivedMember(member: MemberRow) {
    const payload = memberPayloadSchema.parse(JSON.parse(member.payload_json) as unknown);
    if (member.entity_type === 'ALBUM')
      this.db
        .prepare('UPDATE albums SET archived_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now(), member.entity_id);
    else if (member.entity_type === 'CREATION_ITEM')
      this.db
        .prepare('UPDATE creation_items SET archived_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now(), member.entity_id);
    else if (member.entity_type === 'PROMPT_SERIES')
      this.db
        .prepare('UPDATE prompt_series SET archived_at = NULL WHERE id = ? AND deleted_at IS NULL')
        .run(member.entity_id);
    else if (member.entity_type === 'IMAGE_BREAKDOWN')
      this.db
        .prepare('UPDATE image_breakdowns SET archived_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now(), member.entity_id);
    else if (member.entity_type === 'MATERIAL')
      this.db
        .prepare('UPDATE materials SET archived_at = NULL WHERE id = ? AND deleted_at IS NULL')
        .run(member.entity_id);
    else if (member.entity_type !== 'IMAGE_ASSET') {
      const table = this.statusTable(member.entity_type);
      this.db
        .prepare(
          `UPDATE ${table} SET status = ?, archived_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(payload.statusBefore ?? 'ACTIVE', now(), member.entity_id);
    }
  }

  private restoreDeletedMember(member: MemberRow, deletedAt: string) {
    if (member.entity_type === 'ALBUM')
      this.db
        .prepare('UPDATE albums SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?')
        .run(now(), member.entity_id, deletedAt);
    else if (member.entity_type === 'CREATION_ITEM') {
      const timestamp = now();
      this.db
        .prepare('UPDATE creation_items SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?')
        .run(timestamp, member.entity_id, deletedAt);
      this.db
        .prepare(
          `UPDATE creation_forms SET deleted_at = NULL, updated_at = ?
            WHERE creation_item_id = ? AND deleted_at = ?`,
        )
        .run(timestamp, member.entity_id, deletedAt);
    } else if (member.entity_type === 'PROMPT_SERIES')
      this.db
        .prepare('UPDATE prompt_series SET deleted_at = NULL WHERE id = ? AND deleted_at = ?')
        .run(member.entity_id, deletedAt);
    else if (member.entity_type === 'IMAGE_BREAKDOWN')
      this.db
        .prepare('UPDATE image_breakdowns SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?')
        .run(now(), member.entity_id, deletedAt);
    else if (member.entity_type === 'MATERIAL')
      this.db
        .prepare('UPDATE materials SET deleted_at = NULL WHERE id = ? AND deleted_at = ?')
        .run(member.entity_id, deletedAt);
    else if (member.entity_type === 'IMAGE_ASSET')
      this.db
        .prepare('UPDATE image_assets SET deleted_at = NULL WHERE id = ? AND deleted_at = ?')
        .run(member.entity_id, deletedAt);
    else {
      const table = this.statusTable(member.entity_type);
      this.db
        .prepare(`UPDATE ${table} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?`)
        .run(now(), member.entity_id, deletedAt);
    }
    if (member.entity_type === 'CREATION') {
      this.db
        .prepare(
          `UPDATE creation_elements SET deleted_at = NULL, updated_at = ?
          WHERE creation_id = ? AND deleted_at = ?`,
        )
        .run(now(), member.entity_id, deletedAt);
    }
    this.restoreAnimationCreationForm(member, deletedAt);
  }

  private restoreLegacyRecoveryPayload(batch: BatchRow) {
    if (batch.root_entity_type !== 'PROMPT_SERIES') return;
    const row = this.db
      .prepare(
        `SELECT payload_json FROM recycle_bin_entries
        WHERE entity_type = 'PROMPT_SERIES' AND entity_id = ? AND deleted_at = ?`,
      )
      .get(batch.root_entity_id, batch.changed_at) as JsonMap | undefined;
    if (!row) return;
    const payload = promptSeriesRecoveryPayloadSchema.parse(JSON.parse(text(row.payload_json)) as unknown);
    const restoreDeleted = (table: 'creation_output_imports' | 'image_transform_runs', ids: readonly string[]) => {
      if (!ids.length) return;
      this.db
        .prepare(
          `UPDATE ${table} SET deleted_at = NULL
          WHERE deleted_at = ? AND id IN (SELECT value FROM json_each(?))`,
        )
        .run(batch.changed_at, JSON.stringify(ids));
    };
    const restoreArchived = (table: 'creations' | 'articles', ids: readonly string[]) => {
      if (!ids.length) return;
      this.db
        .prepare(
          `UPDATE ${table} SET status = 'ACTIVE', archived_at = NULL, updated_at = ?
          WHERE archived_at = ? AND id IN (SELECT value FROM json_each(?))`,
        )
        .run(now(), batch.changed_at, JSON.stringify(ids));
    };
    restoreDeleted('creation_output_imports', payload.deletedImportIds);
    restoreDeleted('image_transform_runs', payload.deletedTransformIds);
    restoreArchived('creations', payload.archivedCreationIds);
    restoreArchived('articles', payload.archivedInspirationStashIds);
  }

  private ensureRestoredArchiveBatch(batch: BatchRow) {
    if (batch.state_before_action !== 'ARCHIVED') return;
    const existing = this.db
      .prepare(
        `SELECT 1 FROM content_lifecycle_batches archived
        WHERE archived.action = 'ARCHIVE'
          AND (
            (archived.root_entity_type = ? AND archived.root_entity_id = ?)
            OR EXISTS (
              SELECT 1 FROM content_lifecycle_batch_members member
              WHERE member.batch_id = archived.id
                AND member.entity_type = ? AND member.entity_id = ?
            )
          )`,
      )
      .get(batch.root_entity_type, batch.root_entity_id, batch.root_entity_type, batch.root_entity_id);
    if (existing) return;
    const archiveBatchId = ulid();
    const changedAt = now();
    this.db
      .prepare(
        `INSERT INTO content_lifecycle_batches (
          id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
          preview_asset_id, preview_text, state_before_action, changed_at, expires_at,
          purge_state, purge_requested_at, purge_error, updated_at
        ) VALUES (?, 'ARCHIVE', ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, NULL, NULL, NULL, ?)`,
      )
      .run(
        archiveBatchId,
        batch.root_entity_type,
        batch.root_entity_id,
        batch.root_kind,
        batch.root_subtype,
        batch.title,
        batch.preview_asset_id,
        batch.preview_text,
        changedAt,
        changedAt,
      );
    this.db
      .prepare(
        `INSERT INTO content_lifecycle_batch_members (
          batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
          preview_text, parent_entity_type, parent_entity_id, sort_order,
          state_before_action, payload_json
        )
        SELECT ?, entity_type, entity_id, kind, subtype, title, preview_asset_id,
          preview_text, parent_entity_type, parent_entity_id, sort_order, 'ACTIVE',
          CASE WHEN json_type(payload_json, '$.statusBefore') IS NULL THEN payload_json
               ELSE json_set(payload_json, '$.statusBefore', 'ACTIVE') END
        FROM content_lifecycle_batch_members
        WHERE batch_id = ? AND state_before_action = 'ARCHIVED'`,
      )
      .run(archiveBatchId, batch.id);
  }

  private deleteRelations(member: Snapshot, timestamp: string, batchId: string) {
    for (const relation of member.payload.relations ?? []) {
      const result = this.db
        .prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, relation.id);
      if (!result.changes) continue;
      this.db
        .prepare(
          "INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state) VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')",
        )
        .run(ulid(), relation.id, timestamp);
      this.storage.recordChange('ALBUM_MEMBER', relation.id, 'DELETE', {
        batchId,
        albumId: relation.albumId,
        targetType: relation.targetType,
        targetId: relation.targetId,
      });
    }
  }

  private restoreRelations(member: MemberRow, batchId: string) {
    const payload = memberPayloadSchema.parse(JSON.parse(member.payload_json) as unknown);
    for (const relation of payload.relations ?? []) {
      const album = this.db.prepare('SELECT 1 FROM albums WHERE id = ? AND deleted_at IS NULL').get(relation.albumId);
      if (!album) continue;
      const conflict =
        relation.targetType === 'MATERIAL'
          ? null
          : this.db
              .prepare(
                'SELECT 1 FROM album_members WHERE id <> ? AND target_type = ? AND target_id = ? AND deleted_at IS NULL LIMIT 1',
              )
              .get(relation.id, relation.targetType, relation.targetId);
      if (conflict) continue;
      const result = this.db
        .prepare('UPDATE album_members SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
        .run(now(), relation.id);
      if (!result.changes) continue;
      this.storage.recordChange('ALBUM_MEMBER', relation.id, 'RESTORE', {
        batchId,
        albumId: relation.albumId,
        targetType: relation.targetType,
        targetId: relation.targetId,
      });
    }
  }

  private purgeSelection(input: ContentLifecyclePurgePlanInput) {
    const rows = batchRowSchema
      .array()
      .parse(
        this.db
          .prepare(
            "SELECT * FROM content_lifecycle_batches WHERE action = 'DELETE' ORDER BY root_entity_type, root_entity_id",
          )
          .all(),
      );
    if (input.selection.kind === 'FILTER') {
      const filterKind = input.selection.filter.kind;
      return rows.filter((row) => !filterKind || row.root_kind === filterKind);
    }
    const requested = new Map(input.selection.items.map((item) => [key(item), item]));
    const selected = rows.filter((row) => {
      const item = requested.get(key({ entityType: row.root_entity_type, entityId: row.root_entity_id }));
      return item?.expectedChangedAt === row.changed_at;
    });
    if (selected.length !== requested.size) throw new Error('Content changed before confirmation');
    return selected;
  }

  private async processDue(): Promise<ContentLifecyclePurgeResult> {
    if (this.stopped) return { purged: 0, failed: 0 };
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE content_lifecycle_batches
        SET purge_state = 'PURGE_PENDING', purge_requested_at = ?, purge_error = NULL, updated_at = ?
        WHERE action = 'DELETE' AND expires_at <= ? AND purge_state IN ('RETAINED', 'FAILED')`,
      )
      .run(timestamp, timestamp, timestamp);
    return this.processPending(null);
  }

  private async processPending(selected: ReadonlySet<string> | null): Promise<ContentLifecyclePurgeResult> {
    let purged = 0;
    let failed = 0;
    const selectedJson = selected ? JSON.stringify([...selected]) : null;
    while (!this.stopped || selected) {
      const rows = batchRowSchema.array().parse(
        this.db
          .prepare(
            `SELECT * FROM content_lifecycle_batches
            WHERE action = 'DELETE' AND purge_state = 'PURGE_PENDING'
              AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))
            ORDER BY purge_requested_at, id LIMIT 25`,
          )
          .all(selectedJson, selectedJson),
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          await this.purgeBatch(row);
          purged += 1;
        } catch (error) {
          failed += 1;
          this.db
            .prepare(
              "UPDATE content_lifecycle_batches SET purge_state = 'FAILED', purge_error = ?, updated_at = ? WHERE id = ?",
            )
            .run((error instanceof Error ? error.message : String(error)).slice(0, 2_000), now(), row.id);
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (selected && purged + failed >= selected.size) break;
    }
    return { purged, failed };
  }

  private async purgeBatch(batch: BatchRow) {
    const members = this.members(batch.id);
    if (batch.root_entity_type === 'IMAGE_ASSET' && this.assetHasExternalReferences(batch.root_entity_id, null)) {
      throw new Error('IMAGE_ASSET_PURGE_BLOCKED_BY_REFERENCES');
    }
    const managedAssets = this.purgeableManagedAssets(members);
    if (managedAssets.length) {
      await this.synchronizeManagedFiles();
      for (const asset of managedAssets) {
        if (asset.unlinkPath) await this.unlinkObject(asset.relativePath);
      }
    }
    this.db.transaction(() => {
      const rootKey = key({ entityType: batch.root_entity_type, entityId: batch.root_entity_id });
      for (const member of [...members].reverse()) {
        if (member.state_before_action === 'PRESERVED') continue;
        this.purgeMember(member);
        if (key({ entityType: member.entity_type, entityId: member.entity_id }) !== rootKey) {
          this.recordEntityChange(member.entity_type, member.entity_id, 'PURGE', { batchId: batch.id });
        }
      }
      for (const asset of managedAssets) {
        const purgedHash = createHash('sha256').update(`purged:${asset.assetId}`).digest('hex');
        this.db.prepare('DELETE FROM file_projection_links WHERE image_asset_id = ?').run(asset.assetId);
        this.db
          .prepare(
            `UPDATE image_assets
            SET object_hash = ?, relative_path = '', width = 0, height = 0,
              mime_type = 'application/octet-stream', byte_size = 0,
              deleted_at = COALESCE(deleted_at, ?)
            WHERE id = ?`,
          )
          .run(purgedHash, now(), asset.assetId);
        this.db
          .prepare(
            `INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state)
            SELECT ?, 'IMAGE_ASSET', ?, ?, 'LOCAL_ONLY'
            WHERE NOT EXISTS (
              SELECT 1 FROM tombstones WHERE entity_type = 'IMAGE_ASSET' AND entity_id = ?
            )`,
          )
          .run(ulid(), asset.assetId, now(), asset.assetId);
      }
      this.db
        .prepare(
          `DELETE FROM content_lifecycle_batches AS archived
          WHERE archived.action = 'ARCHIVE' AND EXISTS (
            SELECT 1 FROM content_lifecycle_batch_members deleted_member
            WHERE deleted_member.batch_id = ?
              AND deleted_member.state_before_action <> 'PRESERVED'
              AND deleted_member.entity_type = archived.root_entity_type
              AND deleted_member.entity_id = archived.root_entity_id
          )`,
        )
        .run(batch.id);
      this.db
        .prepare('DELETE FROM recycle_bin_entries WHERE entity_type = ? AND entity_id = ?')
        .run(batch.root_entity_type, batch.root_entity_id);
      this.db.prepare('DELETE FROM content_lifecycle_batches WHERE id = ?').run(batch.id);
      this.recordEntityChange(batch.root_entity_type, batch.root_entity_id, 'PURGE', { batchId: batch.id });
    })();
  }

  private purgeMember(member: MemberRow) {
    const id = member.entity_id;
    this.db
      .prepare('DELETE FROM album_members WHERE target_type = ? AND target_id = ?')
      .run(this.entityAlbumTargetType(member.entity_type) ?? '', id);
    if (member.entity_type === 'ALBUM') {
      this.db.prepare('UPDATE creation_drafts SET target_album_id = NULL WHERE target_album_id = ?').run(id);
      this.db.prepare('UPDATE inspiration_stashes SET album_id = NULL WHERE album_id = ?').run(id);
      this.db.prepare('UPDATE evaluation_suites SET album_id = NULL WHERE album_id = ?').run(id);
      this.db.prepare('UPDATE social_post_drafts SET album_id = NULL WHERE album_id = ?').run(id);
      this.db.prepare('UPDATE articles SET album_id = NULL WHERE album_id = ?').run(id);
      this.db.prepare('DELETE FROM album_members WHERE album_id = ?').run(id);
      this.db.prepare('DELETE FROM album_localizations WHERE album_id = ?').run(id);
      this.db.prepare("DELETE FROM sidebar_root_order WHERE target_type = 'ALBUM' AND target_id = ?").run(id);
      this.db.prepare('DELETE FROM albums WHERE id = ? AND deleted_at IS NOT NULL').run(id);
    } else if (member.entity_type === 'CREATION') {
      this.db.prepare('DELETE FROM creation_activity_events WHERE creation_id = ?').run(id);
      this.db.prepare('DELETE FROM creation_elements WHERE creation_id = ?').run(id);
      this.db
        .prepare(
          "UPDATE creations SET title = 'Purged', brief_text = '', failure_message = '', context_key = '' WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
    } else if (member.entity_type === 'INSPIRATION_STASH') {
      this.db.prepare('DELETE FROM desktop_note_instances WHERE stash_id = ?').run(id);
      this.db.prepare('DELETE FROM inspiration_stash_revisions WHERE stash_id = ?').run(id);
      this.db
        .prepare(
          "UPDATE inspiration_stashes SET input_json = '{}', content_hash = 'purged:' || id, album_id = NULL WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
    } else if (member.entity_type === 'IMAGE_BREAKDOWN') {
      this.db
        .prepare(
          `UPDATE image_breakdowns
          SET title = 'Purged', focus = '', model_key = NULL, status = 'DRAFT',
            result_json = NULL, error_code = NULL, error_message = NULL
          WHERE id = ? AND deleted_at IS NOT NULL`,
        )
        .run(id);
    } else if (member.entity_type === 'EVALUATION_SUITE') {
      const purgedHash = createHash('sha256').update(`purged:${id}`).digest('hex');
      this.db
        .prepare("UPDATE evaluation_suite_revisions SET content_json = '{}', content_hash = ? WHERE suite_id = ?")
        .run(purgedHash, id);
      this.db.prepare('UPDATE evaluation_suites SET album_id = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(id);
    } else if (member.entity_type === 'SOCIAL_POST') {
      this.db
        .prepare(
          "UPDATE social_post_revisions SET content_json = '{}', content_hash = 'purged:' || id WHERE draft_id = ?",
        )
        .run(id);
      this.db
        .prepare(
          'UPDATE social_post_drafts SET album_id = NULL, source_inspiration_stash_id = NULL WHERE id = ? AND deleted_at IS NOT NULL',
        )
        .run(id);
    } else if (member.entity_type === 'ARTICLE') {
      this.db.prepare('DELETE FROM article_comments WHERE article_id = ?').run(id);
      this.db.prepare('DELETE FROM article_revision_elements WHERE article_id = ?').run(id);
      this.db.prepare('DELETE FROM article_elements WHERE article_id = ?').run(id);
      this.db
        .prepare(
          `UPDATE article_revisions
          SET content_json = '{}', content_hash = 'purged:' || id,
            content_pack_id = NULL, content_pack_entry_index = NULL
          WHERE article_id = ?`,
        )
        .run(id);
      this.db.prepare('DELETE FROM article_revision_packs WHERE article_id = ?').run(id);
      this.db
        .prepare(
          'UPDATE articles SET album_id = NULL, source_inspiration_stash_id = NULL WHERE id = ? AND deleted_at IS NOT NULL',
        )
        .run(id);
    } else if (member.entity_type === 'GIF_DOCUMENT') {
      this.db.prepare("UPDATE gif_documents SET title='' WHERE id=? AND deleted_at IS NOT NULL").run(id);
      this.db.prepare('DELETE FROM gif_document_assets WHERE document_id=?').run(id);
      this.db
        .prepare("UPDATE gif_document_revisions SET manifest_json='{}',motion_draft_json=NULL WHERE document_id=?")
        .run(id);
    } else if (member.entity_type === 'VIDEO_DOCUMENT') {
      this.db.prepare("UPDATE documents SET title = 'Purged' WHERE id = ? AND deleted_at IS NOT NULL").run(id);
    } else if (member.entity_type === 'PROMPT_SERIES') {
      this.db
        .prepare(
          "UPDATE prompt_series SET title = 'Purged', current_version_id = NULL, cover_image_asset_id = NULL WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
    } else if (member.entity_type === 'MATERIAL') {
      this.db.prepare('DELETE FROM material_favorites WHERE material_id = ?').run(id);
      this.db.prepare('DELETE FROM external_material_metadata WHERE material_id = ?').run(id);
      this.db
        .prepare(
          "UPDATE materials SET text_content = CASE WHEN kind = 'TEXT' THEN '' ELSE text_content END, content_hash = 'purged:' || id WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .run(id);
    }
  }

  private purgeableManagedAssets(members: readonly MemberRow[]) {
    const assets: PurgeableManagedAsset[] = [];
    for (const member of members) {
      if (member.state_before_action === 'PRESERVED') continue;
      const assetId =
        member.entity_type === 'IMAGE_ASSET'
          ? member.entity_id
          : member.entity_type === 'MATERIAL'
            ? (this.db.prepare('SELECT image_asset_id FROM materials WHERE id = ?').pluck().get(member.entity_id) as
                string | null)
            : null;
      const excludedMaterialId = member.entity_type === 'MATERIAL' ? member.entity_id : null;
      if (
        !assetId ||
        (excludedMaterialId && this.materialHasExternalReferences(excludedMaterialId)) ||
        this.assetHasExternalReferences(assetId, excludedMaterialId)
      ) {
        continue;
      }
      const relativePath = this.db.prepare('SELECT relative_path FROM image_assets WHERE id = ?').pluck().get(assetId);
      const resolvedPath = typeof relativePath === 'string' ? relativePath : '';
      const sharedObject = resolvedPath
        ? this.db
            .prepare(
              `SELECT 1 FROM image_assets WHERE id <> ? AND relative_path = ?
              UNION ALL SELECT 1 FROM image_edit_artifacts WHERE relative_path = ? LIMIT 1`,
            )
            .get(assetId, resolvedPath, resolvedPath)
        : null;
      assets.push({ assetId, relativePath: resolvedPath, unlinkPath: Boolean(resolvedPath) && !sharedObject });
    }
    return [...new Map(assets.map((asset) => [asset.assetId, asset])).values()];
  }

  private assetHasExternalReferences(assetId: string, excludedMaterialId: string | null) {
    const tables = (
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    for (const table of tables) {
      if (
        table === 'content_lifecycle_batches' ||
        table === 'content_lifecycle_batch_members' ||
        table === 'recycle_bin_entries' ||
        table === 'file_projection_links' ||
        table === 'image_assets'
      ) {
        continue;
      }
      if (!/^[A-Za-z0-9_]+$/u.test(table)) return true;
      const columns = this.db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        name: string;
        type: string;
      }>;
      const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
        table: string;
        from: string;
        to: string;
      }>;
      const candidateColumns = new Set(
        foreignKeys
          .filter((foreignKey) => foreignKey.table === 'image_assets' && foreignKey.to === 'id')
          .map((foreignKey) => foreignKey.from),
      );
      for (const column of columns) {
        if (/(?:^|_)(?:image_)?asset_id$/u.test(column.name)) candidateColumns.add(column.name);
      }
      for (const column of candidateColumns) {
        if (!/^[A-Za-z0-9_]+$/u.test(column)) return true;
        const materialExclusion =
          table === 'materials' && excludedMaterialId
            ? " AND id <> ? AND (deleted_at IS NULL OR content_hash NOT LIKE 'purged:%')"
            : '';
        const params = table === 'materials' && excludedMaterialId ? [assetId, excludedMaterialId] : [assetId];
        if (
          this.db.prepare(`SELECT 1 FROM "${table}" WHERE "${column}" = ?${materialExclusion} LIMIT 1`).get(...params)
        ) {
          return true;
        }
      }
      for (const column of columns.filter((candidate) => /_json$/u.test(candidate.name))) {
        if (!/^[A-Za-z0-9_]+$/u.test(column.name)) return true;
        if (
          this.db
            .prepare(`SELECT 1 FROM "${table}" WHERE instr(COALESCE("${column.name}", ''), ?) > 0 LIMIT 1`)
            .get(assetId)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private materialHasExternalReferences(materialId: string) {
    const semanticReferences = [
      { table: 'creation_draft_materials', column: 'material_id' },
      { table: 'document_source_relations', column: 'material_id' },
    ] as const;
    const availableTables = new Set(
      (
        this.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    return semanticReferences.some(
      (reference) =>
        availableTables.has(reference.table) &&
        Boolean(
          this.db.prepare(`SELECT 1 FROM "${reference.table}" WHERE "${reference.column}" = ? LIMIT 1`).get(materialId),
        ),
    );
  }

  private async unlinkObject(relativePath: string) {
    const root = path.resolve(this.storage.libraryRoot);
    const objectRoot = path.resolve(root, 'objects', 'sha256');
    const candidate = path.resolve(root, ...relativePath.split(/[\\/]/u));
    if (candidate === objectRoot || !candidate.startsWith(`${objectRoot}${path.sep}`))
      throw new Error('Invalid object-store path');
    try {
      await unlink(candidate);
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error;
    }
  }

  private batchDto(row: BatchRow): ContentLifecycleItemDto {
    const hasChildren = row.root_entity_type === 'ALBUM' && this.memberHasChildren(row.id, row.root_entity_id);
    const counts = this.batchImpactCounts(row.id);
    return {
      entityType: row.root_entity_type,
      entityId: row.root_entity_id,
      expectedChangedAt: row.changed_at,
      state: row.action === 'ARCHIVE' ? 'ARCHIVED' : 'RECYCLE_BIN',
      kind: row.root_kind,
      subtype: row.root_subtype,
      title: row.title,
      previewAssetId: row.preview_asset_id,
      previewText: row.preview_text,
      changedAt: row.changed_at,
      expiresAt: row.expires_at,
      purgeState: row.purge_state,
      purgeError: row.purge_error,
      hasChildren,
      albumCount: counts.albumCount,
      contentCount: counts.contentCount,
      containerId: row.root_entity_type === 'ALBUM' ? encodeContainer(row.action, row.id, row.root_entity_id) : null,
      parentContainerId: null,
      operationBatchId: row.id,
    };
  }

  private memberDto(row: MemberRow, batch: BatchRow, parentContainerId: string | null): ContentLifecycleItemDto {
    return {
      entityType: row.entity_type,
      entityId: row.entity_id,
      expectedChangedAt: batch.changed_at,
      state: batch.action === 'ARCHIVE' ? 'ARCHIVED' : 'RECYCLE_BIN',
      kind: row.kind,
      subtype: row.subtype,
      title: row.title,
      previewAssetId: row.preview_asset_id,
      previewText: row.preview_text,
      changedAt: batch.changed_at,
      expiresAt: batch.expires_at,
      purgeState: batch.purge_state,
      purgeError: batch.purge_error,
      hasChildren: row.entity_type === 'ALBUM' && this.memberHasChildren(batch.id, row.entity_id),
      albumCount: 0,
      contentCount: 0,
      containerId: row.entity_type === 'ALBUM' ? encodeContainer(batch.action, batch.id, row.entity_id) : null,
      parentContainerId,
      operationBatchId: batch.id,
    };
  }

  private memberHasChildren(batchId: string, albumId: string) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM content_lifecycle_batch_members WHERE batch_id = ? AND parent_entity_type = 'ALBUM' AND parent_entity_id = ? LIMIT 1",
        )
        .get(batchId, albumId),
    );
  }

  private batchImpactCounts(batchId: string) {
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN kind = 'ALBUM' THEN 1 ELSE 0 END), 0) AS album_count,
          COALESCE(SUM(CASE WHEN kind <> 'ALBUM' THEN 1 ELSE 0 END), 0) AS content_count
        FROM content_lifecycle_batch_members
        WHERE batch_id = ? AND state_before_action <> 'PRESERVED'
          AND COALESCE(parent_entity_type, '') <> 'CREATION_ITEM'
          AND NOT (parent_entity_type = 'GIF_DOCUMENT' AND subtype = 'GIF_DOCUMENT')`,
      )
      .get(batchId) as JsonMap;
    return { albumCount: Number(row.album_count), contentCount: Number(row.content_count) };
  }

  private batchIsVisible(batch: BatchRow) {
    if (batch.action === 'DELETE') return this.entityIsDeleted(batch.root_entity_type, batch.root_entity_id);
    return (
      this.entityIsArchived(batch.root_entity_type, batch.root_entity_id) &&
      !this.entityIsDeleted(batch.root_entity_type, batch.root_entity_id)
    );
  }

  private entityIsDeleted(type: ContentLifecycleEntityType, id: string) {
    const table = this.entityTable(type);
    return Boolean(this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`).get(id));
  }

  private entityIsArchived(type: ContentLifecycleEntityType, id: string) {
    if (type === 'IMAGE_ASSET') return false;
    const table = this.entityTable(type);
    return Boolean(this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND archived_at IS NOT NULL`).get(id));
  }

  private requireBatch(batchId: string, action: ContentLifecycleAction) {
    const row = this.db
      .prepare('SELECT * FROM content_lifecycle_batches WHERE id = ? AND action = ?')
      .get(batchId, action);
    if (!row) throw new Error('Content lifecycle batch is unavailable');
    return batchRowSchema.parse(row);
  }

  private requireRootBatch(input: ContentLifecycleItemRef) {
    const row = this.db
      .prepare(
        `SELECT * FROM content_lifecycle_batches
        WHERE root_entity_type = ? AND root_entity_id = ? AND changed_at = ?
        ORDER BY CASE action WHEN 'DELETE' THEN 0 ELSE 1 END LIMIT 1`,
      )
      .get(input.entityType, input.entityId, input.expectedChangedAt);
    if (!row) throw new Error('Content lifecycle item is unavailable');
    return batchRowSchema.parse(row);
  }

  private members(batchId: string) {
    return memberRowSchema.array().parse(
      this.db
        .prepare(
          `SELECT * FROM content_lifecycle_batch_members WHERE batch_id = ?
          ORDER BY CASE kind WHEN 'ALBUM' THEN 0 ELSE 1 END, sort_order, entity_type, entity_id`,
        )
        .all(batchId),
    );
  }

  private statusTable(
    type: Exclude<ContentLifecycleEntityType, 'ALBUM' | 'CREATION_ITEM' | 'PROMPT_SERIES' | 'MATERIAL' | 'IMAGE_ASSET'>,
  ) {
    if (type === 'GIF_DOCUMENT') return 'gif_documents';
    if (type === 'CREATION') return 'creations';
    if (type === 'INSPIRATION_STASH') return 'inspiration_stashes';
    if (type === 'IMAGE_BREAKDOWN') return 'image_breakdowns';
    if (type === 'EVALUATION_SUITE') return 'evaluation_suites';
    if (type === 'SOCIAL_POST') return 'social_post_drafts';
    if (type === 'ARTICLE') return 'articles';
    return 'documents';
  }

  private entityTable(type: ContentLifecycleEntityType) {
    if (type === 'GIF_DOCUMENT') return 'gif_documents';
    if (type === 'ALBUM') return 'albums';
    if (type === 'CREATION_ITEM') return 'creation_items';
    if (type === 'PROMPT_SERIES') return 'prompt_series';
    if (type === 'CREATION') return 'creations';
    if (type === 'INSPIRATION_STASH') return 'inspiration_stashes';
    if (type === 'IMAGE_BREAKDOWN') return 'image_breakdowns';
    if (type === 'EVALUATION_SUITE') return 'evaluation_suites';
    if (type === 'SOCIAL_POST') return 'social_post_drafts';
    if (type === 'ARTICLE') return 'articles';
    if (type === 'VIDEO_DOCUMENT') return 'documents';
    if (type === 'MATERIAL') return 'materials';
    return 'image_assets';
  }

  private changeEntityType(type: ContentLifecycleEntityType) {
    if (type === 'SOCIAL_POST') return 'SOCIAL_POST_DRAFT';
    if (type === 'VIDEO_DOCUMENT') return 'DOCUMENT';
    return type;
  }

  private recordEntityChange(
    type: ContentLifecycleEntityType,
    id: string,
    operation: ContentLifecycleAction | 'RESTORE' | 'PURGE',
    payload: unknown,
  ) {
    this.storage.recordChange(this.changeEntityType(type), id, operation, payload);
  }

  private albumTargetEntityType(targetType: string): ContentLifecycleEntityType | null {
    if (targetType === 'CREATION_ITEM') return 'CREATION_ITEM';
    if (targetType === 'SERIES') return 'PROMPT_SERIES';
    if (targetType === 'DOCUMENT') return 'VIDEO_DOCUMENT';
    if (targetType === 'MATERIAL') return 'MATERIAL';
    if (targetType === 'INSPIRATION_STASH') return 'INSPIRATION_STASH';
    if (targetType === 'SOCIAL_POST') return 'SOCIAL_POST';
    if (targetType === 'ARTICLE') return 'ARTICLE';
    return null;
  }

  private entityAlbumTargetType(type: ContentLifecycleEntityType) {
    if (type === 'CREATION_ITEM') return 'CREATION_ITEM';
    if (type === 'PROMPT_SERIES') return 'SERIES';
    if (type === 'VIDEO_DOCUMENT') return 'DOCUMENT';
    if (type === 'MATERIAL') return 'MATERIAL';
    if (type === 'INSPIRATION_STASH') return 'INSPIRATION_STASH';
    if (type === 'SOCIAL_POST') return 'SOCIAL_POST';
    if (type === 'ARTICLE') return 'ARTICLE';
    if (type === 'ALBUM') return 'ALBUM';
    return null;
  }

  private creationFormEntityType(type: string): ContentLifecycleEntityType | null {
    if (type === 'GIF_DOCUMENT') return 'GIF_DOCUMENT';
    if (type === 'PROMPT_SERIES') return 'PROMPT_SERIES';
    if (type === 'INSPIRATION_STASH') return 'INSPIRATION_STASH';
    if (type === 'IMAGE_BREAKDOWN') return 'IMAGE_BREAKDOWN';
    if (type === 'EVALUATION_SUITE') return 'EVALUATION_SUITE';
    if (type === 'SOCIAL_POST') return 'SOCIAL_POST';
    if (type === 'ARTICLE') return 'ARTICLE';
    if (type === 'VIDEO_DOCUMENT') return 'VIDEO_DOCUMENT';
    return null;
  }

  private jsonTitle(value: unknown, fallback: string) {
    try {
      const parsed = JSON.parse(text(value)) as unknown;
      if (parsed && typeof parsed === 'object' && 'title' in parsed && typeof parsed.title === 'string') {
        return parsed.title.trim() || fallback;
      }
    } catch {
      // Persisted JSON is preview-only; malformed optional content falls back to the stable id.
    }
    return fallback;
  }
}
