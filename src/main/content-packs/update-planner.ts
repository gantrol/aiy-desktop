import type Database from 'better-sqlite3';
import type {
  PackImportPreviewDto,
  PackUpdateChangeDto,
  PackUpdateLocalStateDto,
  PackUpdateOperationDto,
} from '@/shared/contracts';
import type { FixturePackSource } from '@/main/database/packs/fixture-pack-source';
import { text, type JsonMap } from '@/main/database/core/values';
import {
  PackMetadataInvalidError,
  parsePackExampleMetadata,
  parsePackReleaseItemMetadata,
} from '@/main/database/packs/pack-release-item-metadata';

const MAX_VISIBLE_CHANGES = 500;

interface PlannedItem {
  itemKey: string;
  objectType: string;
  contentHash: string;
  metadata: JsonMap;
}

function targetItems(source: FixturePackSource): PlannedItem[] {
  return [
    ...source.terms.map((item) => ({
      itemKey: item.itemKey,
      objectType: 'TERM_REVISION',
      contentHash: item.contentHash,
      metadata: { stableKey: item.stableKey },
    })),
    ...source.recipes.map((item) => ({
      itemKey: item.itemKey,
      objectType: 'RECIPE_REVISION',
      contentHash: item.contentHash,
      metadata: { stableKey: item.stableKey },
    })),
    ...source.supplementalItems.map((item) => ({
      itemKey: item.itemKey,
      objectType: item.objectType,
      contentHash: item.contentHash,
      metadata: item.metadata,
    })),
  ];
}

function compareVersions(left: string, right: string) {
  const parse = (value: string) => {
    const [withoutBuild] = value.split('+', 1);
    const separator = withoutBuild.indexOf('-');
    const core = separator < 0 ? withoutBuild : withoutBuild.slice(0, separator);
    const prerelease = separator < 0 ? [] : withoutBuild.slice(separator + 1).split('.');
    return { core: core.split('.').map((part) => Number.parseInt(part, 10)), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length ? -1 : 1;
  }
  const identifierCount = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) < Number(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function operationFor(currentVersion: string | null, targetVersion: string): PackUpdateOperationDto {
  if (!currentVersion) return 'INSTALL';
  const comparison = compareVersions(targetVersion, currentVersion);
  if (comparison < 0) return 'DOWNGRADE';
  if (comparison > 0) return 'UPDATE';
  return 'REINSTALL';
}

interface LocalStateIndex {
  termRevisionByStableKey: ReadonlyMap<string, string>;
  recipeRevisionByStableKey: ReadonlyMap<string, string>;
  linkedRevisions: ReadonlySet<string>;
  activeCoverIdsByStableKey: ReadonlyMap<string, readonly string[]>;
  managedMediaIds: ReadonlySet<string>;
}

function requiredMetadataText(item: PlannedItem, key: string) {
  const value = text(item.metadata[key]);
  if (!value) throw new PackMetadataInvalidError(item.itemKey, item.objectType);
  return value;
}

function paletteId(stableKey: string) {
  return `palette_catalog_${stableKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
}

function revisionLinkKey(itemKey: string, revisionId: string) {
  return `${itemKey}\u0000${revisionId}`;
}

function buildLocalStateIndex(db: Database.Database, packId: string, items: readonly PlannedItem[]): LocalStateIndex {
  if (!items.length) {
    return {
      termRevisionByStableKey: new Map(),
      recipeRevisionByStableKey: new Map(),
      linkedRevisions: new Set(),
      activeCoverIdsByStableKey: new Map(),
      managedMediaIds: new Set(),
    };
  }
  const termStableKeys = [
    ...new Set(
      items
        .filter(({ objectType }) => objectType === 'TERM_REVISION')
        .map((item) => requiredMetadataText(item, 'stableKey')),
    ),
  ];
  const recipeStableKeys = [
    ...new Set(
      items
        .filter(({ objectType }) => objectType === 'RECIPE_REVISION')
        .map((item) => requiredMetadataText(item, 'stableKey')),
    ),
  ];
  const coverStableKeys = [
    ...new Set(
      items.flatMap((item) =>
        item.objectType === 'TERM_EXAMPLE' &&
        text(item.metadata.role) === 'COVER' &&
        text(item.metadata.status) === 'ACCEPTED'
          ? [requiredMetadataText(item, 'termStableKey')]
          : [],
      ),
    ),
  ];
  const termRevisionByStableKey = new Map<string, string>();
  for (let offset = 0; offset < termStableKeys.length; offset += 400) {
    const chunk = termStableKeys.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT stable_key, current_revision_id FROM terms WHERE stable_key IN (${placeholders})`)
      .all(...chunk) as JsonMap[];
    for (const row of rows) termRevisionByStableKey.set(text(row.stable_key), text(row.current_revision_id));
  }
  const recipeRevisionByStableKey = new Map<string, string>();
  const recipeStableKeyById = new Map(recipeStableKeys.map((stableKey) => [paletteId(stableKey), stableKey]));
  const recipeIds = [...recipeStableKeyById.keys()];
  for (let offset = 0; offset < recipeIds.length; offset += 400) {
    const chunk = recipeIds.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT id, current_revision_id FROM word_palettes
        WHERE deleted_at IS NULL AND id IN (${placeholders})`,
      )
      .all(...chunk) as JsonMap[];
    for (const row of rows) {
      const stableKey = recipeStableKeyById.get(text(row.id));
      if (stableKey) recipeRevisionByStableKey.set(stableKey, text(row.current_revision_id));
    }
  }
  const linkedRows = db
    .prepare(
      `SELECT item.item_key, link.local_revision_id
      FROM pack_object_links link
      JOIN pack_release_items item ON item.id = link.release_item_id
      JOIN pack_releases release ON release.id = item.release_id
      WHERE release.pack_id = ? AND link.deleted_at IS NULL`,
    )
    .all(packId) as JsonMap[];
  const linkedRevisions = new Set(
    linkedRows.map((row) => revisionLinkKey(text(row.item_key), text(row.local_revision_id))),
  );
  const activeCoverIdsByStableKey = new Map<string, string[]>();
  for (let offset = 0; offset < coverStableKeys.length; offset += 400) {
    const chunk = coverStableKeys.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT term.stable_key, link.id
        FROM term_media_links link
        JOIN terms term ON term.id = link.term_id
        WHERE term.stable_key IN (${placeholders})
          AND link.role = 'COVER' AND link.deleted_at IS NULL`,
      )
      .all(...chunk) as JsonMap[];
    for (const row of rows) {
      const stableKey = text(row.stable_key);
      const existing = activeCoverIdsByStableKey.get(stableKey);
      if (existing) existing.push(text(row.id));
      else activeCoverIdsByStableKey.set(stableKey, [text(row.id)]);
    }
  }
  const managedRows = db
    .prepare(
      `SELECT item.item_key, item.object_type, item.metadata_json
      FROM pack_release_items item
      JOIN pack_releases release ON release.id = item.release_id
      WHERE release.pack_id = ? AND item.object_type = 'TERM_EXAMPLE'`,
    )
    .all(packId) as JsonMap[];
  const managedMediaIds = new Set(
    managedRows.map(
      (row) =>
        parsePackExampleMetadata(row.metadata_json, {
          itemKey: text(row.item_key),
          objectType: text(row.object_type),
        }).mediaId,
    ),
  );
  return {
    termRevisionByStableKey,
    recipeRevisionByStableKey,
    linkedRevisions,
    activeCoverIdsByStableKey,
    managedMediaIds,
  };
}

function localState(index: LocalStateIndex, item: PlannedItem): PackUpdateLocalStateDto {
  if (item.objectType === 'TERM_REVISION' || item.objectType === 'RECIPE_REVISION') {
    const stableKey = requiredMetadataText(item, 'stableKey');
    const currentRevisionId =
      item.objectType === 'TERM_REVISION'
        ? index.termRevisionByStableKey.get(stableKey)
        : index.recipeRevisionByStableKey.get(stableKey);
    if (!currentRevisionId) return 'FOLLOW_PACK';
    return index.linkedRevisions.has(revisionLinkKey(item.itemKey, currentRevisionId)) ? 'FOLLOW_PACK' : 'LOCAL_FORK';
  }
  if (item.objectType !== 'TERM_EXAMPLE') return 'FOLLOW_PACK';
  if (text(item.metadata.role) !== 'COVER' || text(item.metadata.status) !== 'ACCEPTED') return 'FOLLOW_PACK';
  const stableKey = requiredMetadataText(item, 'termStableKey');
  const activeCoverIds = index.activeCoverIdsByStableKey.get(stableKey) ?? [];
  return activeCoverIds.some((id) => !index.managedMediaIds.has(id)) ? 'CONFLICT' : 'FOLLOW_PACK';
}

export function planContentPackUpdate(
  db: Database.Database,
  source: FixturePackSource,
): Omit<PackImportPreviewDto, 'requestId'> {
  const installation = db
    .prepare(
      `SELECT selected_release_id FROM pack_installations
      WHERE pack_id = ? AND deleted_at IS NULL AND selected_release_id IS NOT NULL`,
    )
    .get(source.profile.id) as JsonMap | undefined;
  const currentReleaseId = text(installation?.selected_release_id) || null;
  const currentRelease = currentReleaseId
    ? (db.prepare('SELECT version FROM pack_releases WHERE id = ?').get(currentReleaseId) as JsonMap | undefined)
    : undefined;
  const currentVersion = currentRelease ? text(currentRelease.version) : null;
  const currentRows = currentReleaseId
    ? (db
        .prepare(
          'SELECT item_key, object_type, content_hash, metadata_json FROM pack_release_items WHERE release_id = ?',
        )
        .all(currentReleaseId) as JsonMap[])
    : [];
  const currentItems = new Map(
    currentRows.map((row) => {
      const itemKey = text(row.item_key);
      const objectType = text(row.object_type);
      return [
        itemKey,
        {
          itemKey,
          objectType,
          contentHash: text(row.content_hash),
          metadata: parsePackReleaseItemMetadata(row.metadata_json, { itemKey, objectType }),
        } satisfies PlannedItem,
      ] as const;
    }),
  );
  const nextItems = targetItems(source);
  const nextKeys = new Set(nextItems.map((item) => item.itemKey));
  const pendingChanges: Array<{ item: PlannedItem; changeKind: PackUpdateChangeDto['changeKind'] }> = [];
  let unchanged = 0;
  for (const item of nextItems) {
    const current = currentItems.get(item.itemKey);
    if (current?.contentHash === item.contentHash && current.objectType === item.objectType) {
      unchanged += 1;
      continue;
    }
    pendingChanges.push({ item, changeKind: current ? 'UPDATED' : 'ADDED' });
  }
  for (const item of currentItems.values()) {
    if (nextKeys.has(item.itemKey)) continue;
    pendingChanges.push({ item, changeKind: 'REMOVED' });
  }
  const localStateIndex = buildLocalStateIndex(
    db,
    source.profile.id,
    pendingChanges.map(({ item }) => item),
  );
  const changes: PackUpdateChangeDto[] = pendingChanges.map(({ item, changeKind }) => ({
    itemKey: item.itemKey,
    objectType: item.objectType,
    changeKind,
    localState: localState(localStateIndex, item),
  }));
  const summary = {
    added: changes.filter((item) => item.changeKind === 'ADDED').length,
    updated: changes.filter((item) => item.changeKind === 'UPDATED').length,
    removed: changes.filter((item) => item.changeKind === 'REMOVED').length,
    unchanged,
    localForks: changes.filter((item) => item.localState === 'LOCAL_FORK').length,
    conflicts: changes.filter((item) => item.localState === 'CONFLICT').length,
  };
  return {
    packId: source.profile.id,
    displayName: source.profile.displayName,
    operation: operationFor(currentVersion, source.releaseVersion),
    currentReleaseId,
    currentVersion,
    targetReleaseId: source.releaseId,
    targetVersion: source.releaseVersion,
    targetContentHash: `sha256:${source.sourceDigest}`,
    summary,
    changes: changes.slice(0, MAX_VISIBLE_CHANGES),
    changesTruncated: changes.length > MAX_VISIBLE_CHANGES,
  };
}
