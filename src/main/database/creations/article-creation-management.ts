import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';
import { moveCreationBranchAlbums } from '@/main/database/creations/creation-hierarchy';
import { creationPrimaryFormRoleSchema } from '@/shared/contracts/creation-library';

interface FormRow {
  id: string;
  creation_item_id: string;
  source_form_id: string | null;
  role: string;
  entity_type: string;
  entity_id: string;
  updated_at: string;
}

const primaryRoles = new Set<string>(creationPrimaryFormRoleSchema.options);
const visualRoles = new Set(['ARTICLE_HEADER', 'ARTICLE_INLINE']);

/** A manuscript owns its visual work, but never another independently editable manuscript. */
export function articleCreationScope(storage: LibraryStorage, articleId: string) {
  const { db } = storage;
  const owner = db
    .prepare(
      `
    SELECT item.id, item.primary_form_id, item.updated_at, membership.album_id, edge.parent_creation_item_id,
      article.created_at AS article_created_at
    FROM creation_forms form
    JOIN creation_items item ON item.id = form.creation_item_id
      AND item.deleted_at IS NULL AND item.archived_at IS NULL
    JOIN articles article ON article.id = form.entity_id
      AND article.deleted_at IS NULL AND article.archived_at IS NULL
    LEFT JOIN album_members membership ON membership.target_type = 'CREATION_ITEM'
      AND membership.target_id = item.id AND membership.deleted_at IS NULL
    LEFT JOIN creation_item_parents edge ON edge.creation_item_id = item.id
    WHERE form.entity_type = 'ARTICLE' AND form.entity_id = ? AND form.deleted_at IS NULL
  `,
    )
    .get(articleId) as
    | {
        id: string;
        primary_form_id: string | null;
        updated_at: string;
        album_id: string | null;
        parent_creation_item_id: string | null;
        article_created_at: string;
      }
    | undefined;
  if (!owner) throw new Error('ARTICLE_MANAGEMENT_UNAVAILABLE');
  const forms = db
    .prepare(
      `
    SELECT id, creation_item_id, source_form_id, role, entity_type, entity_id, updated_at
    FROM creation_forms WHERE creation_item_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, created_at, id
  `,
    )
    .all(owner.id) as FormRow[];
  const article = forms.find((form) => form.entity_type === 'ARTICLE' && form.entity_id === articleId);
  if (!article) throw new Error('ARTICLE_MANAGEMENT_UNAVAILABLE');
  const ownedIds = new Set([article.id]);
  // Follow only visual descendants. A later manuscript keeps its own identity and lifecycle.
  const visualsBySource = new Map<string, FormRow[]>();
  for (const form of forms) {
    if (!visualRoles.has(form.role) || !form.source_form_id) continue;
    const siblings = visualsBySource.get(form.source_form_id) ?? [];
    siblings.push(form);
    visualsBySource.set(form.source_form_id, siblings);
  }
  const pending = [article.id];
  while (pending.length) {
    for (const form of visualsBySource.get(pending.pop()!) ?? []) {
      if (ownedIds.has(form.id)) continue;
      ownedIds.add(form.id);
      pending.push(form.id);
    }
  }
  const owned = forms.filter((form) => ownedIds.has(form.id));
  const remaining = forms.filter((form) => !ownedIds.has(form.id));
  if (
    remaining.length &&
    !remaining.some((form) => primaryRoles.has(form.role)) &&
    remaining.some((form) => form.role !== 'INSPIRATION')
  ) {
    throw new Error('ARTICLE_MANAGEMENT_REQUIRED');
  }
  return { owner, article, owned, remaining };
}

export type ArticleCreationScope = ReturnType<typeof articleCreationScope>;

/** Call inside the management transaction; cancellation and failed operations never split a manuscript. */
export function isolateArticleCreation(storage: LibraryStorage, scope: ArticleCreationScope) {
  if (!scope.remaining.length) return scope.owner.id;
  const { db } = storage;
  const timestamp = now();
  const id = ulid();
  db.prepare(
    `
    INSERT INTO creation_items (id, phase, primary_form_id, created_at, updated_at, archived_at, deleted_at)
    VALUES (?, 'DRAFT', ?, ?, ?, NULL, NULL)
  `,
  ).run(id, scope.article.id, scope.owner.article_created_at, timestamp);
  db.prepare(
    `
    UPDATE creation_forms SET creation_item_id = ?, updated_at = ?
    WHERE id IN (SELECT value FROM json_each(?)) AND creation_item_id = ? AND deleted_at IS NULL
  `,
  ).run(id, timestamp, JSON.stringify(scope.owned.map((form) => form.id)), scope.owner.id);
  const primary =
    scope.remaining.find((form) => form.id === scope.owner.primary_form_id) ??
    scope.remaining.find((form) => primaryRoles.has(form.role));
  db.prepare(
    `UPDATE creation_items SET primary_form_id = ?, phase = CASE WHEN ? IS NULL THEN 'DRAFT' ELSE phase END,
    updated_at = ? WHERE id = ?`,
  ).run(primary?.id ?? null, primary?.id ?? null, timestamp, scope.owner.id);
  const parentId = scope.remaining.some((form) => form.id === scope.article.source_form_id)
    ? scope.owner.id
    : scope.owner.parent_creation_item_id;
  if (parentId)
    db.prepare(
      `
    INSERT INTO creation_item_parents (creation_item_id, parent_creation_item_id, sort_order, updated_at)
    SELECT ?, ?, COALESCE(MAX(sort_order), -1) + 1, ? FROM creation_item_parents WHERE parent_creation_item_id = ?
  `,
    ).run(id, parentId, timestamp, parentId);
  moveCreationBranchAlbums(storage, [id], scope.owner.album_id, timestamp);
  for (const form of scope.owned) {
    storage.recordChange('CREATION_FORM', form.id, 'MOVE', {
      creationItemId: id,
      previousCreationItemId: scope.owner.id,
      sourceFormId: form.source_form_id,
    });
  }
  storage.recordChange('CREATION_ITEM', scope.owner.id, 'UPDATE', { separatedArticleId: scope.article.entity_id });
  storage.recordChange('CREATION_ITEM', id, 'CREATE', {
    albumId: scope.owner.album_id,
    parentCreationItemId: parentId,
    initialFormId: scope.article.id,
  });
  return id;
}
