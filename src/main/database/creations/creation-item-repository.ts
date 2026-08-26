import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import {
  creationFormAddOrGetInputSchema,
  creationFormAddOrGetResultSchema,
  creationFormEntityRefSchema,
  creationFormSchema,
  creationItemCreateWithFormInputSchema,
  creationItemListInputSchema,
  creationItemMoveInputSchema,
  creationItemSchema,
  creationItemSetPinnedInputSchema,
  creationItemSetPrimaryInputSchema,
  type CreationFormAddOrGetInput,
  type CreationFormAddOrGetResult,
  type CreationFormDto,
  type CreationFormEntityRef,
  type CreationFormRole,
  type CreationItemDto,
  type CreationItemCreateWithFormInput,
  type CreationItemListInput,
  type CreationItemMoveInput,
  type CreationItemSetPinnedInput,
  type CreationItemSetPrimaryInput,
} from '@/shared/contracts/creation-library';
import { creationItemIncludesSeries } from '@/main/database/creations/creation-output-presentation-sql';

const primaryRoles = new Set<CreationFormRole>(['IMAGE_CREATION', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT']);

interface CreationItemRow extends JsonMap {
  id: unknown;
  phase: unknown;
  primary_form_id: unknown;
  pinned: unknown;
  created_at: unknown;
  updated_at: unknown;
  archived_at: unknown;
  owner_album_id: unknown;
  creator_root_sort_order: unknown;
}

function formDto(row: JsonMap): CreationFormDto {
  const entity = creationFormEntityRefSchema.parse({
    kind: row.entity_type,
    id: row.entity_id,
  });
  return creationFormSchema.parse({
    id: row.id,
    creationItemId: row.creation_item_id,
    role: row.role,
    entity,
    anchorKey: row.anchor_key,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class CreationItemRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  list(input: CreationItemListInput = {}): CreationItemDto[] {
    const parsed = creationItemListInputSchema.parse(input);
    const rows = this.itemRows().filter((row) => {
      const archived = row.archived_at !== null && row.archived_at !== undefined;
      if ((parsed.lifecycle === 'ARCHIVED') !== archived) return false;
      if (parsed.albumId === undefined) return true;
      const albumId = row.owner_album_id == null ? null : text(row.owner_album_id);
      return albumId === parsed.albumId;
    });
    return this.hydrate(rows);
  }

  find(id: string): CreationItemDto | null {
    const row = this.itemRow(id);
    return row ? this.hydrate([row])[0] : null;
  }

  get(id: string): CreationItemDto {
    const item = this.find(id);
    if (!item) throw new Error('Creation item not found');
    return item;
  }

  findForEntity(entity: CreationFormEntityRef): CreationItemDto | null {
    const parsed = creationFormEntityRefSchema.parse(entity);
    const row = this.db
      .prepare(
        `SELECT creation_item_id FROM creation_forms
        WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL`,
      )
      .get(parsed.kind, parsed.id) as JsonMap | undefined;
    return row ? this.find(text(row.creation_item_id)) : null;
  }

  touchForEntity(entity: CreationFormEntityRef, timestamp = now()): CreationItemDto {
    const parsed = creationFormEntityRefSchema.parse(entity);
    return this.db
      .transaction(() => {
        const form = this.db
          .prepare(
            `SELECT creation_item_id FROM creation_forms
            WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL`,
          )
          .get(parsed.kind, parsed.id) as JsonMap | undefined;
        if (!form) throw new Error('Creation form entity is not registered');
        const creationItemId = text(form.creation_item_id);
        const item = this.mutableItemRow(creationItemId);
        this.db
          .prepare('UPDATE creation_items SET updated_at = MAX(updated_at, ?) WHERE id = ?')
          .run(timestamp, creationItemId);
        if (item.owner_album_id != null) this.touchAlbum(text(item.owner_album_id), timestamp);
        this.storage.recordChange('CREATION_ITEM', creationItemId, 'TOUCH', { entity: parsed });
        return this.get(creationItemId);
      })
      .immediate();
  }

  touchForSeries(seriesId: string, timestamp = now()): CreationItemDto | null {
    const row = this.db
      .prepare(
        `WITH target(id) AS (SELECT ?), owner_series(creation_item_id, series_id) AS (
          SELECT form.creation_item_id, form.entity_id
          FROM creation_forms form
          WHERE form.entity_type = 'PROMPT_SERIES' AND form.deleted_at IS NULL
          UNION
          SELECT form.creation_item_id, visual.prompt_series_id
          FROM creation_forms form
          JOIN derived_visuals visual ON visual.id = form.entity_id
          WHERE form.entity_type = 'DERIVED_VISUAL' AND form.deleted_at IS NULL
            AND visual.prompt_series_id IS NOT NULL
        )
        SELECT item.id
        FROM owner_series owner
        CROSS JOIN target
        JOIN creation_items item ON item.id = owner.creation_item_id
          AND item.archived_at IS NULL AND item.deleted_at IS NULL
        WHERE ${creationItemIncludesSeries('owner.series_id', 'target.id')}
        ORDER BY CASE WHEN owner.series_id = target.id THEN 1 ELSE 0 END, item.id
        LIMIT 1`,
      )
      .get(seriesId) as JsonMap | undefined;
    if (!row) return null;
    const creationItemId = text(row.id);
    return this.db
      .transaction(() => {
        const item = this.mutableItemRow(creationItemId);
        this.db
          .prepare('UPDATE creation_items SET updated_at = MAX(updated_at, ?) WHERE id = ?')
          .run(timestamp, creationItemId);
        if (item.owner_album_id != null) this.touchAlbum(text(item.owner_album_id), timestamp);
        this.storage.recordChange('CREATION_ITEM', creationItemId, 'TOUCH', { seriesId });
        return this.get(creationItemId);
      })
      .immediate();
  }

  findForm(creationItemId: string, role: CreationFormRole, anchorKey: string | null): CreationFormDto | null {
    const row = this.db
      .prepare(
        `SELECT * FROM creation_forms
        WHERE creation_item_id = ? AND role = ? AND anchor_key IS ? AND deleted_at IS NULL`,
      )
      .get(creationItemId, role, role === 'ARTICLE_INLINE' ? anchorKey : null) as JsonMap | undefined;
    return row ? formDto(row) : null;
  }

  createWithForm(input: CreationItemCreateWithFormInput): CreationFormAddOrGetResult {
    const parsedInput = creationItemCreateWithFormInputSchema.parse(input);
    return this.db
      .transaction(() => {
        const creationItemId = ulid();
        const registration = creationFormAddOrGetInputSchema.parse({ ...parsedInput.form, creationItemId });
        if (!primaryRoles.has(registration.role) && registration.role !== 'INSPIRATION') {
          throw new Error('A creation item cannot begin with an auxiliary visual form');
        }
        this.assertEntityAvailable(registration.entity);
        this.assertAlbumAvailable(parsedInput.albumId);

        const timestamp = now();
        this.db
          .prepare(
            `INSERT INTO creation_items
            (id, phase, primary_form_id, created_at, updated_at, archived_at, deleted_at)
            VALUES (?, 'DRAFT', NULL, ?, ?, NULL, NULL)`,
          )
          .run(creationItemId, timestamp, timestamp);
        const form = this.insertForm(registration, timestamp);
        if (primaryRoles.has(form.role)) {
          this.db
            .prepare("UPDATE creation_items SET phase = 'ACTIVE', primary_form_id = ? WHERE id = ?")
            .run(form.id, creationItemId);
        }
        this.syncAlbumMembership(creationItemId, parsedInput.albumId, timestamp);
        this.storage.recordChange('CREATION_FORM', form.id, 'CREATE', {
          creationItemId,
          role: form.role,
          entity: form.entity,
          anchorKey: form.anchorKey,
        });
        this.storage.recordChange('CREATION_ITEM', creationItemId, 'CREATE', {
          albumId: parsedInput.albumId,
          initialFormId: form.id,
          initialFormRole: form.role,
        });
        const item = this.get(creationItemId);
        return creationFormAddOrGetResultSchema.parse({ item, form, created: true });
      })
      .immediate();
  }

  addOrGetForm(input: CreationFormAddOrGetInput): CreationFormAddOrGetResult {
    const parsed = creationFormAddOrGetInputSchema.parse(input);
    return this.db
      .transaction(() => {
        const itemRow = this.mutableItemRow(parsed.creationItemId);
        const existing = this.findForm(parsed.creationItemId, parsed.role, parsed.anchorKey);
        if (existing) {
          if (existing.entity.kind !== parsed.entity.kind || existing.entity.id !== parsed.entity.id) {
            throw new Error('This creation form role is already bound to another entity');
          }
          return creationFormAddOrGetResultSchema.parse({
            item: this.get(parsed.creationItemId),
            form: existing,
            created: false,
          });
        }
        if (text(itemRow.phase) === 'DRAFT' && !primaryRoles.has(parsed.role) && parsed.role !== 'INSPIRATION') {
          throw new Error('A draft creation item cannot contain an auxiliary visual form');
        }
        this.assertEntityAvailable(parsed.entity);
        const claimed = this.db
          .prepare(
            `SELECT creation_item_id FROM creation_forms
            WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL`,
          )
          .get(parsed.entity.kind, parsed.entity.id) as JsonMap | undefined;
        if (claimed) throw new Error('This creation form entity is already registered');

        const timestamp = now();
        const form = this.insertForm(parsed, timestamp);
        if (text(itemRow.phase) === 'DRAFT' && primaryRoles.has(form.role)) {
          this.db
            .prepare(
              `UPDATE creation_items
              SET phase = 'ACTIVE', primary_form_id = ?, updated_at = ? WHERE id = ?`,
            )
            .run(form.id, timestamp, parsed.creationItemId);
        } else {
          this.db
            .prepare('UPDATE creation_items SET updated_at = ? WHERE id = ?')
            .run(timestamp, parsed.creationItemId);
        }
        this.storage.recordChange('CREATION_FORM', form.id, 'CREATE', {
          creationItemId: parsed.creationItemId,
          role: form.role,
          entity: form.entity,
          anchorKey: form.anchorKey,
        });
        return creationFormAddOrGetResultSchema.parse({
          item: this.get(parsed.creationItemId),
          form,
          created: true,
        });
      })
      .immediate();
  }

  setPrimary(input: CreationItemSetPrimaryInput): CreationItemDto {
    const parsed = creationItemSetPrimaryInputSchema.parse(input);
    return this.db
      .transaction(() => {
        const item = this.mutableItemRow(parsed.creationItemId);
        const formRow = this.db
          .prepare(
            `SELECT * FROM creation_forms
            WHERE id = ? AND creation_item_id = ? AND deleted_at IS NULL`,
          )
          .get(parsed.formId, parsed.creationItemId) as JsonMap | undefined;
        if (!formRow) throw new Error('Creation form not found in this item');
        const form = formDto(formRow);
        if (!primaryRoles.has(form.role)) throw new Error('This creation form cannot be primary');
        const previousFormId = item.primary_form_id == null ? null : text(item.primary_form_id);
        if (previousFormId === form.id) return this.get(parsed.creationItemId);

        const timestamp = now();
        this.db
          .prepare(
            `UPDATE creation_items
            SET phase = 'ACTIVE', primary_form_id = ?, updated_at = ? WHERE id = ?`,
          )
          .run(form.id, timestamp, parsed.creationItemId);
        this.storage.recordChange('CREATION_ITEM', parsed.creationItemId, 'SET_PRIMARY_FORM', {
          previousFormId,
          formId: form.id,
          role: form.role,
        });
        return this.get(parsed.creationItemId);
      })
      .immediate();
  }

  setPinned(input: CreationItemSetPinnedInput): CreationItemDto {
    const parsed = creationItemSetPinnedInputSchema.parse(input);
    return this.db
      .transaction(() => {
        const item = this.mutableItemRow(parsed.creationItemId);
        if (Boolean(item.pinned) === parsed.pinned) return this.get(parsed.creationItemId);

        const timestamp = now();
        this.db
          .prepare('UPDATE creation_items SET pinned = ?, updated_at = ? WHERE id = ?')
          .run(parsed.pinned ? 1 : 0, timestamp, parsed.creationItemId);
        if (item.owner_album_id != null) this.touchAlbum(text(item.owner_album_id), timestamp);
        this.storage.recordChange('CREATION_ITEM', parsed.creationItemId, 'UPDATE', { pinned: parsed.pinned });
        return this.get(parsed.creationItemId);
      })
      .immediate();
  }

  move(input: CreationItemMoveInput): CreationItemDto {
    const parsed = creationItemMoveInputSchema.parse(input);
    return this.db
      .transaction(() => {
        this.mutableItemRow(parsed.creationItemId);
        this.assertAlbumAvailable(parsed.albumId);
        const timestamp = now();
        const changed = this.syncAlbumMembership(parsed.creationItemId, parsed.albumId, timestamp);
        if (changed) {
          this.syncFormEntityAlbums(parsed.creationItemId, parsed.albumId, timestamp);
          this.db
            .prepare('UPDATE creation_items SET updated_at = ? WHERE id = ?')
            .run(timestamp, parsed.creationItemId);
          this.storage.recordChange('CREATION_ITEM', parsed.creationItemId, 'MOVE', { albumId: parsed.albumId });
        }
        return this.get(parsed.creationItemId);
      })
      .immediate();
  }

  private itemRows(): CreationItemRow[] {
    return this.db
      .prepare(
        `SELECT item.*, membership.album_id AS owner_album_id,
          root_order.sort_order AS creator_root_sort_order
        FROM creation_items item
        LEFT JOIN album_members membership
          ON membership.target_type = 'CREATION_ITEM'
          AND membership.target_id = item.id AND membership.deleted_at IS NULL
        LEFT JOIN sidebar_root_order root_order
          ON root_order.scope = 'CREATOR' AND root_order.target_type = 'CREATION_ITEM'
          AND root_order.target_id = item.id
        WHERE item.deleted_at IS NULL
        ORDER BY item.updated_at DESC, item.id DESC`,
      )
      .all() as CreationItemRow[];
  }

  private itemRow(id: string): CreationItemRow | null {
    const row = this.db
      .prepare(
        `SELECT item.*, membership.album_id AS owner_album_id,
          root_order.sort_order AS creator_root_sort_order
        FROM creation_items item
        LEFT JOIN album_members membership
          ON membership.target_type = 'CREATION_ITEM'
          AND membership.target_id = item.id AND membership.deleted_at IS NULL
        LEFT JOIN sidebar_root_order root_order
          ON root_order.scope = 'CREATOR' AND root_order.target_type = 'CREATION_ITEM'
          AND root_order.target_id = item.id
        WHERE item.id = ? AND item.deleted_at IS NULL`,
      )
      .get(id) as CreationItemRow | undefined;
    return row ?? null;
  }

  private mutableItemRow(id: string): CreationItemRow {
    const row = this.itemRow(id);
    if (!row) throw new Error('Creation item not found');
    if (row.archived_at !== null && row.archived_at !== undefined) {
      throw new Error('Archived creation items cannot be changed');
    }
    return row;
  }

  private hydrate(rows: CreationItemRow[]): CreationItemDto[] {
    if (!rows.length) return [];
    const itemIds = rows.map((row) => text(row.id));
    const forms = this.db
      .prepare(
        `SELECT form.* FROM creation_forms form
        JOIN json_each(?) selected ON selected.value = form.creation_item_id
        WHERE form.deleted_at IS NULL
        ORDER BY form.creation_item_id, form.sort_order, form.created_at, form.id`,
      )
      .all(JSON.stringify(itemIds)) as JsonMap[];
    const formsByItem = new Map<string, CreationFormDto[]>();
    for (const row of forms) {
      const form = formDto(row);
      const values = formsByItem.get(form.creationItemId);
      if (values) values.push(form);
      else formsByItem.set(form.creationItemId, [form]);
    }
    return rows.map((row) => {
      const id = text(row.id);
      return creationItemSchema.parse({
        id,
        albumId: row.owner_album_id == null ? null : row.owner_album_id,
        phase: row.phase,
        lifecycle: row.archived_at == null ? 'ACTIVE' : 'ARCHIVED',
        pinned: Boolean(row.pinned),
        primaryFormId: row.primary_form_id == null ? null : row.primary_form_id,
        creatorRootSortOrder: row.creator_root_sort_order == null ? null : Number(row.creator_root_sort_order),
        forms: formsByItem.get(id) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    });
  }

  private insertForm(input: CreationFormAddOrGetInput, timestamp: string): CreationFormDto {
    const id = ulid();
    const sortOrder = Number(
      this.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM creation_forms
          WHERE creation_item_id = ? AND deleted_at IS NULL`,
        )
        .pluck()
        .get(input.creationItemId),
    );
    this.db
      .prepare(
        `INSERT INTO creation_forms
        (id, creation_item_id, role, entity_type, entity_id, anchor_key,
          sort_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.creationItemId,
        input.role,
        input.entity.kind,
        input.entity.id,
        input.anchorKey,
        sortOrder,
        timestamp,
        timestamp,
      );
    return creationFormSchema.parse({
      id,
      creationItemId: input.creationItemId,
      role: input.role,
      entity: input.entity,
      anchorKey: input.anchorKey,
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private assertEntityAvailable(entity: CreationFormEntityRef) {
    const table = {
      PROMPT_SERIES: 'prompt_series',
      INSPIRATION_STASH: 'inspiration_stashes',
      SOCIAL_POST: 'social_post_drafts',
      ARTICLE: 'articles',
      VIDEO_DOCUMENT: 'documents',
      DERIVED_VISUAL: 'derived_visuals',
    }[entity.kind];
    const deletionPredicate = entity.kind === 'DERIVED_VISUAL' ? '' : ' AND deleted_at IS NULL';
    const row = this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?${deletionPredicate}`).get(entity.id);
    if (!row) throw new Error('Creation form entity not found');
  }

  private assertAlbumAvailable(albumId: string | null) {
    if (!albumId) return;
    const album = this.db
      .prepare(
        `WITH RECURSIVE lineage(id, archived_at, deleted_at, intent) AS (
          SELECT id, archived_at, deleted_at, intent FROM albums WHERE id = ?
          UNION
          SELECT parent.id, parent.archived_at, parent.deleted_at, parent.intent
          FROM lineage child
          JOIN album_members relation ON relation.target_type = 'ALBUM'
            AND relation.target_id = child.id AND relation.deleted_at IS NULL
          JOIN albums parent ON parent.id = relation.album_id
        )
        SELECT
          MAX(CASE WHEN id = ? AND intent <> 'MATERIAL_LIBRARY' THEN 1 ELSE 0 END) AS target_is_creation_album,
          SUM(CASE WHEN archived_at IS NOT NULL OR deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS unavailable_count
        FROM lineage`,
      )
      .get(albumId, albumId) as JsonMap | undefined;
    if (!album || Number(album.target_is_creation_album) !== 1) throw new Error('Creation album not found');
    if (Number(album.unavailable_count) > 0) throw new Error('Archived albums cannot receive a creation item');
  }

  private syncAlbumMembership(creationItemId: string, albumId: string | null, timestamp: string) {
    const current = this.db
      .prepare(
        `SELECT id, album_id FROM album_members
        WHERE target_type = 'CREATION_ITEM' AND target_id = ? AND deleted_at IS NULL`,
      )
      .get(creationItemId) as JsonMap | undefined;
    if (current && text(current.album_id) === albumId) return false;

    if (current) {
      const memberId = text(current.id);
      const oldAlbumId = text(current.album_id);
      this.db
        .prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, memberId);
      this.db
        .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
        .run(ulid(), memberId, timestamp);
      this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
        albumId: oldAlbumId,
        targetType: 'CREATION_ITEM',
        targetId: creationItemId,
        movedToAlbumId: albumId,
      });
      this.touchAlbum(oldAlbumId, timestamp);
    }
    if (!albumId) return Boolean(current);

    const existing = this.db
      .prepare(
        `SELECT id FROM album_members
        WHERE album_id = ? AND target_type = 'CREATION_ITEM' AND target_id = ?`,
      )
      .get(albumId, creationItemId) as JsonMap | undefined;
    const sortOrder = Number(
      this.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM album_members
          WHERE album_id = ? AND deleted_at IS NULL`,
        )
        .pluck()
        .get(albumId),
    );
    if (existing) {
      const memberId = text(existing.id);
      this.db
        .prepare('UPDATE album_members SET sort_order = ?, updated_at = ?, deleted_at = NULL WHERE id = ?')
        .run(sortOrder, timestamp, memberId);
      this.storage.recordChange('ALBUM_MEMBER', memberId, 'RESTORE', {
        albumId,
        targetType: 'CREATION_ITEM',
        targetId: creationItemId,
      });
    } else {
      const memberId = ulid();
      this.db
        .prepare(
          `INSERT INTO album_members
          (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
          VALUES (?, ?, 'CREATION_ITEM', ?, ?, ?, ?, NULL)`,
        )
        .run(memberId, albumId, creationItemId, sortOrder, timestamp, timestamp);
      this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
        albumId,
        targetType: 'CREATION_ITEM',
        targetId: creationItemId,
      });
    }
    this.touchAlbum(albumId, timestamp);
    return true;
  }

  private syncFormEntityAlbums(creationItemId: string, albumId: string | null, timestamp: string) {
    const forms = this.db
      .prepare(
        `SELECT entity_type, entity_id FROM creation_forms
        WHERE creation_item_id = ? AND deleted_at IS NULL
          AND entity_type IN ('INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE')`,
      )
      .all(creationItemId) as JsonMap[];
    const locations = {
      INSPIRATION_STASH: { table: 'inspiration_stashes', changeType: 'INSPIRATION_STASH', affectsFileView: true },
      SOCIAL_POST: { table: 'social_post_drafts', changeType: 'SOCIAL_POST_DRAFT', affectsFileView: false },
      ARTICLE: { table: 'articles', changeType: 'ARTICLE', affectsFileView: false },
    } as const;

    for (const form of forms) {
      const entityType = text(form.entity_type) as keyof typeof locations;
      const entityId = text(form.entity_id);
      const location = locations[entityType];
      const row = this.db.prepare(`SELECT album_id FROM ${location.table} WHERE id = ?`).get(entityId) as
        JsonMap | undefined;
      if (!row) throw new Error('Creation form entity not found while moving its item');
      const currentAlbumId = row.album_id == null ? null : text(row.album_id);
      if (currentAlbumId === albumId) continue;
      this.db
        .prepare(`UPDATE ${location.table} SET album_id = ?, updated_at = ? WHERE id = ?`)
        .run(albumId, timestamp, entityId);
      this.storage.recordChange(
        location.changeType,
        entityId,
        'MOVE',
        { albumId, creationItemId },
        { affectsFileView: location.affectsFileView },
      );
    }
  }

  private touchAlbum(albumId: string, timestamp: string) {
    this.db
      .prepare(
        `UPDATE albums
        SET content_updated_at = MAX(COALESCE(content_updated_at, created_at), ?),
          updated_at = MAX(updated_at, ?)
        WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(timestamp, timestamp, albumId);
  }
}
