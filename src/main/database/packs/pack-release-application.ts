import type { LibraryStorage } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';
import { parsePackExampleMetadata } from '@/main/database/packs/pack-release-item-metadata';
import { parsePackReleaseItemMetadata } from '@/main/database/packs/pack-release-item-metadata';
import { contentPackCreationStates } from '@/main/content-packs/creation-state';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';

interface ReleaseItemRow extends JsonMap {
  id: string;
  item_key: string;
  object_type: string;
  metadata_json: string;
}

export interface PackReleaseApplicationResult {
  followedItems: number;
  localForks: number;
  retiredItems: number;
  exampleItems: number;
  coverConflicts: number;
}

function releaseItems(storage: LibraryStorage, releaseId: string) {
  return storage.db
    .prepare('SELECT * FROM pack_release_items WHERE release_id = ? ORDER BY sort_order, id')
    .all(releaseId) as ReleaseItemRow[];
}

function localMapping(storage: LibraryStorage, spaceId: string, itemId: string) {
  return storage.db
    .prepare(
      `SELECT local_object_type, local_object_id, local_revision_id
      FROM pack_object_links
      WHERE space_id = ? AND release_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(spaceId, itemId) as JsonMap | undefined;
}

function revisionBelongsToPackItem(
  storage: LibraryStorage,
  spaceId: string,
  packId: string,
  itemKey: string,
  revisionId: string,
) {
  if (!revisionId) return false;
  return Boolean(
    storage.db
      .prepare(
        `SELECT 1
        FROM pack_object_links link
        JOIN pack_release_items item ON item.id = link.release_item_id
        JOIN pack_releases release ON release.id = item.release_id
        WHERE link.space_id = ? AND release.pack_id = ? AND item.item_key = ?
          AND link.local_revision_id = ? AND link.deleted_at IS NULL
        LIMIT 1`,
      )
      .get(spaceId, packId, itemKey, revisionId),
  );
}

function applyRevisionItem(storage: LibraryStorage, spaceId: string, packId: string, item: ReleaseItemRow) {
  const mapping = localMapping(storage, spaceId, text(item.id));
  if (!mapping) throw new Error(`Pack release item has no local mapping: ${text(item.item_key)}`);
  const localObjectId = text(mapping.local_object_id);
  const targetRevisionId = text(mapping.local_revision_id);
  const isTerm = text(item.object_type) === 'TERM_REVISION';
  const table = isTerm ? 'terms' : 'word_palettes';
  const current = storage.db.prepare(`SELECT current_revision_id FROM ${table} WHERE id = ?`).get(localObjectId) as
    JsonMap | undefined;
  if (!current) throw new Error(`Pack object is unavailable: ${text(item.item_key)}`);
  const currentRevisionId = text(current.current_revision_id);
  const followsPack =
    !currentRevisionId ||
    currentRevisionId === targetRevisionId ||
    revisionBelongsToPackItem(storage, spaceId, packId, text(item.item_key), currentRevisionId);
  if (!followsPack) return false;
  if (isTerm) {
    storage.db
      .prepare('UPDATE terms SET current_revision_id = ?, archived_at = NULL WHERE id = ?')
      .run(targetRevisionId, localObjectId);
  } else {
    storage.db
      .prepare('UPDATE word_palettes SET current_revision_id = ?, archived_at = NULL, updated_at = ? WHERE id = ?')
      .run(targetRevisionId, now(), localObjectId);
  }
  return true;
}

function applyArticleRevisionItem(storage: LibraryStorage, spaceId: string, packId: string, item: ReleaseItemRow) {
  const mapping = localMapping(storage, spaceId, text(item.id));
  if (!mapping) throw new Error('Content pack work has no local mapping');
  const articleId = text(mapping.local_object_id);
  const revisionId = text(mapping.local_revision_id);
  const current = storage.db
    .prepare(
      `SELECT article.current_revision_id, article.status, article.deleted_at,
    owner.id AS owner_id, owner.archived_at AS owner_archived_at, owner.deleted_at AS owner_deleted_at,
    EXISTS(SELECT 1 FROM article_comments comment WHERE comment.article_id = article.id) AS has_comments
    FROM articles article
    LEFT JOIN creation_forms form ON form.entity_type = 'ARTICLE' AND form.entity_id = article.id AND form.deleted_at IS NULL
    LEFT JOIN creation_items owner ON owner.id = form.creation_item_id WHERE article.id = ?`,
    )
    .get(articleId) as JsonMap | undefined;
  if (!current || current.deleted_at || !current.owner_id || current.owner_deleted_at)
    throw new Error('Content pack work is no longer available');
  if (
    text(current.status) !== 'ACTIVE' ||
    current.owner_archived_at ||
    Number(current.has_comments) > 0 ||
    !revisionBelongsToPackItem(storage, spaceId, packId, text(item.item_key), text(current.current_revision_id))
  )
    return false;
  if (!storage.db.prepare('SELECT 1 FROM article_revisions WHERE id = ? AND article_id = ?').get(revisionId, articleId))
    throw new Error('Content pack work revision is missing');
  if (text(current.current_revision_id) === revisionId) return true;
  storage.db
    .prepare('UPDATE articles SET current_revision_id = ?, updated_at = ? WHERE id = ?')
    .run(revisionId, now(), articleId);
  new CreationItemRepository(storage).touchForEntity({ kind: 'ARTICLE', id: articleId });
  storage.recordChange(
    'ARTICLE',
    articleId,
    'UPDATE',
    { revisionId, source: 'CONTENT_PACKAGE', packId },
    { affectsFileView: false },
  );
  return true;
}

function retireRemovedRevisionItem(storage: LibraryStorage, spaceId: string, packId: string, item: ReleaseItemRow) {
  const mapping = localMapping(storage, spaceId, text(item.id));
  if (!mapping) return false;
  const localObjectId = text(mapping.local_object_id);
  const isTerm = text(item.object_type) === 'TERM_REVISION';
  const table = isTerm ? 'terms' : 'word_palettes';
  const current = storage.db.prepare(`SELECT current_revision_id FROM ${table} WHERE id = ?`).get(localObjectId) as
    JsonMap | undefined;
  const currentRevisionId = text(current?.current_revision_id);
  if (!revisionBelongsToPackItem(storage, spaceId, packId, text(item.item_key), currentRevisionId)) return false;
  if (isTerm) {
    storage.db
      .prepare('UPDATE terms SET archived_at = COALESCE(archived_at, ?) WHERE id = ?')
      .run(now(), localObjectId);
  } else {
    storage.db
      .prepare('UPDATE word_palettes SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?')
      .run(now(), now(), localObjectId);
  }
  return true;
}

function exampleIds(item: ReleaseItemRow) {
  const metadata = parsePackExampleMetadata(item.metadata_json, {
    itemKey: text(item.item_key),
    objectType: text(item.object_type),
  });
  return {
    termStableKey: text(metadata.termStableKey),
    status: text(metadata.status),
    role: text(metadata.role),
    note: text(metadata.note),
    assetId: text(metadata.assetId),
    mediaId: text(metadata.mediaId),
    evidenceId: text(metadata.evidenceId),
  };
}

function deactivateExample(storage: LibraryStorage, item: ReleaseItemRow) {
  const example = exampleIds(item);
  const timestamp = now();
  if (example.mediaId) {
    storage.db
      .prepare('UPDATE term_media_links SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?')
      .run(timestamp, example.mediaId);
  }
  if (example.evidenceId) storage.db.prepare('DELETE FROM term_evidence WHERE id = ?').run(example.evidenceId);
}

function managedMediaIds(storage: LibraryStorage, packId: string) {
  const rows = storage.db
    .prepare(
      `SELECT item.item_key, item.object_type, item.metadata_json
      FROM pack_release_items item
      JOIN pack_releases release ON release.id = item.release_id
      WHERE release.pack_id = ? AND item.object_type = 'TERM_EXAMPLE'`,
    )
    .all(packId) as JsonMap[];
  return new Set(
    rows.map(
      (row) =>
        parsePackExampleMetadata(row.metadata_json, {
          itemKey: text(row.item_key),
          objectType: text(row.object_type),
        }).mediaId,
    ),
  );
}

function activateExample(
  storage: LibraryStorage,
  item: ReleaseItemRow,
  sortOrder: number,
  packMediaIds: ReadonlySet<string>,
) {
  const example = exampleIds(item);
  if (!example.termStableKey || !example.assetId || !example.evidenceId) {
    throw new Error(`Pack example metadata is incomplete: ${text(item.item_key)}`);
  }
  const term = storage.db.prepare('SELECT id FROM terms WHERE stable_key = ?').get(example.termStableKey) as
    JsonMap | undefined;
  if (!term) throw new Error(`Pack example term is unavailable: ${example.termStableKey}`);
  if (!storage.db.prepare('SELECT 1 FROM image_assets WHERE id = ? AND deleted_at IS NULL').get(example.assetId)) {
    throw new Error(`Pack example asset is unavailable: ${example.assetId}`);
  }
  const termId = text(term.id);
  const timestamp = now();
  storage.db
    .prepare(
      `INSERT INTO term_evidence(id, term_id, image_asset_id, verdict, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET term_id = excluded.term_id, image_asset_id = excluded.image_asset_id,
        verdict = excluded.verdict, note = excluded.note`,
    )
    .run(
      example.evidenceId,
      termId,
      example.assetId,
      example.status === 'REJECTED' ? 'NEGATIVE' : 'POSITIVE',
      example.note,
      timestamp,
    );

  if (example.status === 'REJECTED') {
    if (example.mediaId)
      storage.db.prepare('UPDATE term_media_links SET deleted_at = ? WHERE id = ?').run(timestamp, example.mediaId);
    return false;
  }
  if (!example.mediaId) throw new Error(`Accepted pack example needs a media identity: ${text(item.item_key)}`);

  let role: 'COVER' | 'RELATED' = example.role === 'COVER' ? 'COVER' : 'RELATED';
  let coverConflict = false;
  if (role === 'COVER') {
    const activeCovers = storage.db
      .prepare("SELECT id FROM term_media_links WHERE term_id = ? AND role = 'COVER' AND deleted_at IS NULL")
      .all(termId) as JsonMap[];
    const externalCover = activeCovers.find((row) => {
      const id = text(row.id);
      return id !== example.mediaId && !packMediaIds.has(id);
    });
    coverConflict = Boolean(externalCover);
    if (coverConflict) role = 'RELATED';
    for (const row of activeCovers) {
      const id = text(row.id);
      if (id !== example.mediaId && packMediaIds.has(id)) {
        storage.db.prepare('UPDATE term_media_links SET deleted_at = ? WHERE id = ?').run(timestamp, id);
      }
    }
  }
  storage.db
    .prepare(
      `INSERT INTO term_media_links
      (id, term_id, image_asset_id, role, sort_order, focal_x, focal_y, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, 0.5, 0.5, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET term_id = excluded.term_id, image_asset_id = excluded.image_asset_id,
        role = excluded.role, sort_order = excluded.sort_order, focal_x = excluded.focal_x,
        focal_y = excluded.focal_y, deleted_at = NULL`,
    )
    .run(example.mediaId, termId, example.assetId, role, sortOrder, timestamp);
  return coverConflict;
}

export function applyPackReleaseSelection(
  storage: LibraryStorage,
  packId: string,
  targetReleaseId: string,
  previousReleaseId: string | null,
): PackReleaseApplicationResult {
  const release = storage.db
    .prepare('SELECT pack_id FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL')
    .get(targetReleaseId) as JsonMap | undefined;
  if (!release || text(release.pack_id) !== packId) throw new Error('Pack release cannot be applied');

  const spaceId = text(storage.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get());
  const targetItems = releaseItems(storage, targetReleaseId);
  const previousItems = previousReleaseId ? releaseItems(storage, previousReleaseId) : [];
  const targetKeys = new Set(targetItems.map((item) => text(item.item_key)));
  const creationStates = contentPackCreationStates(
    storage.db,
    packId,
    targetItems.map((item) => ({
      itemKey: text(item.item_key),
      objectType: text(item.object_type),
      contentHash: text(item.content_hash),
      metadata: parsePackReleaseItemMetadata(item.metadata_json, {
        itemKey: text(item.item_key),
        objectType: text(item.object_type),
      }),
    })),
  );
  if (
    [...creationStates.values()].includes('CONFLICT') ||
    previousItems.some(
      (item) => text(item.object_type) === 'CREATION_COLLECTION' && !targetKeys.has(text(item.item_key)),
    )
  )
    throw new Error('CONTENT_PACK_CREATION_CONFLICT');
  const packMediaIds = managedMediaIds(storage, packId);
  let followedItems = 0;
  let localForks = 0;
  let retiredItems = 0;
  let exampleItems = 0;
  let coverConflicts = 0;

  for (const item of previousItems) {
    if (targetKeys.has(text(item.item_key))) continue;
    if (text(item.object_type) === 'TERM_EXAMPLE') {
      deactivateExample(storage, item);
    } else if (['TERM_REVISION', 'RECIPE_REVISION'].includes(text(item.object_type))) {
      if (retireRemovedRevisionItem(storage, spaceId, packId, item)) retiredItems += 1;
    }
  }

  for (const item of targetItems) {
    if (text(item.object_type) === 'ARTICLE_REVISION') {
      if (applyArticleRevisionItem(storage, spaceId, packId, item)) followedItems += 1;
      else localForks += 1;
    }
    if (['TERM_REVISION', 'RECIPE_REVISION'].includes(text(item.object_type))) {
      if (applyRevisionItem(storage, spaceId, packId, item)) followedItems += 1;
      else localForks += 1;
    }
  }

  const exampleSortOrders = new Map<string, number>();
  for (const item of targetItems.filter((candidate) => text(candidate.object_type) === 'TERM_EXAMPLE')) {
    const termStableKey = exampleIds(item).termStableKey;
    const sortOrder = exampleSortOrders.get(termStableKey) ?? 0;
    exampleSortOrders.set(termStableKey, sortOrder + 1);
    if (activateExample(storage, item, sortOrder, packMediaIds)) coverConflicts += 1;
    exampleItems += 1;
  }

  if (previousReleaseId && previousReleaseId !== targetReleaseId) {
    storage.db
      .prepare(
        `UPDATE context_pack_activations SET pack_release_id = ?, updated_at = ?
        WHERE pack_id = ? AND pack_release_id = ? AND deleted_at IS NULL`,
      )
      .run(targetReleaseId, now(), packId, previousReleaseId);
  }
  return { followedItems, localForks, retiredItems, exampleItems, coverConflicts };
}
