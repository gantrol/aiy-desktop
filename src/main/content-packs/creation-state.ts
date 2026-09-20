import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { PackUpdateLocalStateDto } from '@/shared/contracts';
import { text, type JsonMap } from '@/main/database/core/values';

const id = z.string().min(1).max(240);
export const contentPackCreationLayoutSchema = z
  .object({
    contract: z.literal('CONTENT_PACK_CREATIONS_V1'),
    albumId: id,
    title: z.string(),
    titleLocale: z.enum(['zh', 'en']),
    description: z.string(),
    groups: z
      .array(z.object({ id, primaryWorkId: id, workIds: z.array(id).min(1).max(50) }).strict())
      .min(1)
      .max(25),
  })
  .strict();
export const contentPackWorkMetadataSchema = z
  .object({
    contract: z.literal('CONTENT_PACK_WORK_V1'),
    workKey: id,
    workId: id,
    kind: z.enum(['ARTICLE', 'OUTLINE']),
    file: z.string(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

type Item = { itemKey: string; objectType: string; contentHash: string; metadata: JsonMap };

/** One bounded batch for current work state and one for package ownership. */
export function contentPackCreationStates(db: Database.Database, packId: string, items: readonly Item[]) {
  const states = new Map<string, PackUpdateLocalStateDto>();
  const relevant = items.filter((item) => ['ARTICLE_REVISION', 'CREATION_COLLECTION'].includes(item.objectType));
  if (!relevant.length) return states;
  const mappings = db
    .prepare(
      `SELECT item.item_key, link.local_object_id, link.local_revision_id, item.content_hash
    FROM pack_object_links link JOIN pack_release_items item ON item.id = link.release_item_id
    JOIN pack_releases release ON release.id = item.release_id
    WHERE release.pack_id = ? AND link.deleted_at IS NULL
      AND item.object_type IN ('ARTICLE_REVISION', 'CREATION_COLLECTION')`,
    )
    .all(packId) as JsonMap[];
  const workItems = relevant.filter((item) => item.objectType === 'ARTICLE_REVISION');
  const workIds = workItems.map((item) => contentPackWorkMetadataSchema.parse(item.metadata).workId);
  const rows = db
    .prepare(
      `SELECT article.id, article.current_revision_id, article.status, article.deleted_at,
    owner.id AS owner_id, owner.archived_at AS owner_archived_at, owner.deleted_at AS owner_deleted_at,
    EXISTS(SELECT 1 FROM article_comments comment WHERE comment.article_id = article.id) AS has_comments
    FROM articles article JOIN json_each(?) selected ON selected.value = article.id
    LEFT JOIN creation_forms form ON form.entity_type = 'ARTICLE' AND form.entity_id = article.id AND form.deleted_at IS NULL
    LEFT JOIN creation_items owner ON owner.id = form.creation_item_id`,
    )
    .all(JSON.stringify(workIds)) as JsonMap[];
  const articles = new Map(rows.map((row) => [text(row.id), row]));
  for (const item of workItems) {
    const article = articles.get(contentPackWorkMetadataSchema.parse(item.metadata).workId);
    const owned = mappings.filter((mapping) => text(mapping.item_key) === item.itemKey);
    const state: PackUpdateLocalStateDto = !article
      ? owned.length
        ? 'CONFLICT'
        : 'FOLLOW_PACK'
      : article.deleted_at || !owned.length || !article.owner_id || article.owner_deleted_at
        ? 'CONFLICT'
        : text(article.status) !== 'ACTIVE' || article.owner_archived_at || Number(article.has_comments) > 0
          ? 'LOCAL_FORK'
          : owned.some((mapping) => text(mapping.local_revision_id) === text(article.current_revision_id))
            ? 'FOLLOW_PACK'
            : 'LOCAL_FORK';
    states.set(item.itemKey, state);
  }
  for (const item of relevant.filter((candidate) => candidate.objectType === 'CREATION_COLLECTION')) {
    const layout = contentPackCreationLayoutSchema.parse(item.metadata);
    const owned = mappings.filter((mapping) => text(mapping.item_key) === item.itemKey);
    const album = db
      .prepare('SELECT title, intent, archived_at, deleted_at FROM albums WHERE id = ?')
      .get(layout.albumId) as JsonMap | undefined;
    // Changing topology needs an explicit relation migration, not a blind pack update.
    if (
      owned.some((mapping) => text(mapping.content_hash) !== item.contentHash) ||
      (owned.length > 0 ? !album || album.deleted_at || album.archived_at : Boolean(album))
    ) {
      states.set(item.itemKey, 'CONFLICT');
      continue;
    }
    if (!owned.length) {
      states.set(item.itemKey, 'FOLLOW_PACK');
      continue;
    }
    const groups = db
      .prepare(
        `SELECT item.id, item.deleted_at, item.archived_at, form.entity_id AS primary_work_id
      FROM creation_items item LEFT JOIN creation_forms form ON form.id = item.primary_form_id AND form.deleted_at IS NULL
      JOIN json_each(?) selected ON selected.value = item.id`,
      )
      .all(JSON.stringify(layout.groups.map((group) => group.id))) as JsonMap[];
    if (groups.length !== layout.groups.length || groups.some((group) => group.deleted_at)) {
      states.set(item.itemKey, 'CONFLICT');
      continue;
    }
    const memberships = db
      .prepare(
        `SELECT target_id FROM album_members WHERE album_id = ?
      AND target_type = 'CREATION_ITEM' AND deleted_at IS NULL ORDER BY sort_order, id`,
      )
      .all(layout.albumId) as JsonMap[];
    const unchanged =
      text(album?.title) === layout.title &&
      text(album?.intent) === layout.description &&
      JSON.stringify(memberships.map((row) => text(row.target_id))) ===
        JSON.stringify(layout.groups.map((group) => group.id)) &&
      layout.groups.every((group) =>
        groups.some(
          (row) => text(row.id) === group.id && !row.archived_at && text(row.primary_work_id) === group.primaryWorkId,
        ),
      );
    states.set(item.itemKey, unchanged ? 'FOLLOW_PACK' : 'LOCAL_FORK');
  }
  return states;
}
