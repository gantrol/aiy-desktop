import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import type {
  AssetFileRevealContext,
  AssetFileRevealTargetContext,
  AssetFileRevealTargetDto,
} from '@/shared/contracts';
import { AssetFileRepository, type ResolvedAssetFile, safeAssetFileName } from '@/main/database/asset-file-repository';
import type { LibraryStorage, RecordedLibraryChange } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';
import { trimTrailingCharacters } from '@/shared/string-boundaries';

const albumsDirectoryName = '图集';
const termsDirectoryName = '词典';
const maximumConflictAttempts = 10_000;
const synchronizationBatchDelayMs = 180;
const projectionCacheAlgorithmVersion = '1';
const projectionCacheVersionKey = 'library_file_view_cache_algorithm_version';
const projectionCacheStateKey = 'library_file_view_cache_state';
const projectionCacheChangeRowIdKey = 'library_file_view_cache_change_rowid';
const projectionCacheSchemaVersionKey = 'library_file_view_cache_schema_version';
const projectionCacheDirectoryCountKey = 'library_file_view_cache_directory_count';
const projectionCacheLinkCountKey = 'library_file_view_cache_link_count';
const projectionCacheTermPlacementCountKey = 'library_file_view_cache_term_placement_count';
const projectionCacheMetadataKeys = [
  projectionCacheVersionKey,
  projectionCacheStateKey,
  projectionCacheChangeRowIdKey,
  projectionCacheSchemaVersionKey,
  projectionCacheDirectoryCountKey,
  projectionCacheLinkCountKey,
  projectionCacheTermPlacementCountKey,
];

const directProjectionChangeTypeValues: readonly string[] = ['ALBUM', 'ALBUM_MEMBER', 'TERM', 'TERM_MEDIA_LINK'];
const directProjectionChangeTypes = new Set(directProjectionChangeTypeValues);
const creationProjectionChangeTypes = new Set([
  'CREATION_OUTPUT_IMPORT',
  'GENERATION_RUN',
  'PROMPT_SERIES',
  'PROMPT_VERSION',
]);
const assetProjectionChangeTypes = new Set(['IMAGE_ASSET']);
const materialProjectionChangeTypes = new Set(['MATERIAL', 'EXTERNAL_MATERIAL_METADATA']);

type ProjectionDirectoryType = 'ALBUM' | 'TERM_DOMAIN' | 'TERM_TYPE' | 'TERM';
type ProjectionLinkType = 'ALBUM' | 'TERM';
type ProjectionState = 'PENDING_CREATE' | 'ACTIVE' | 'PENDING_DELETE' | 'ERROR' | 'RETIRED';

interface AlbumNode {
  id: string;
  title: string;
  parentId: string | null;
  createdAt: string;
}

interface TermDirectoryNode {
  id: string;
  name: string;
  domainId: string;
  domainName: string;
  typeId: string;
  typeName: string;
  createdAt: string;
}

interface IndexedDirectory {
  key: string;
  contextType: ProjectionDirectoryType;
  contextId: string;
  parentKey: string | null;
  state: ProjectionState;
  relativePath: string;
  preferredLabel: string;
}

interface IndexedLink {
  key: string;
  contextType: ProjectionLinkType;
  contextId: string;
  directoryKey: string;
  state: ProjectionState;
  assetId: string;
  relativePath: string;
  sourceRelativePath: string;
  sourceObjectHash: string;
  preferredName: string;
}

interface FileViewIndex {
  directories: IndexedDirectory[];
  links: IndexedLink[];
}

interface DesiredLink {
  key: string;
  asset: ResolvedAssetFile;
  directoryPath: string;
  preferredName: string;
  contextType: ProjectionLinkType;
  contextId: string;
  directoryKey: string;
  allocationOrder: number;
}

function storedNonNegativeInteger(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isPathInsideOrEqual(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function nodeErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
}

function safeDirectoryLabel(value: string, fallback = '图集') {
  const sentinelExtension = '.aiy-directory';
  const fileName = safeAssetFileName(`${value}${sentinelExtension}`, fallback, sentinelExtension);
  return Array.from(path.basename(fileName, sentinelExtension)).slice(0, 96).join('');
}

function collisionKey(value: string) {
  return trimTrailingCharacters(value.normalize('NFKC').toLowerCase(), '. ');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNumberedDirectoryName(value: string, preferred: string) {
  return value === preferred || new RegExp(`^${escapeRegExp(preferred)} \\(\\d+\\)$`, 'u').test(value);
}

function isNumberedFileName(value: string, preferred: string) {
  if (value === preferred) return true;
  const extension = path.extname(preferred);
  const stem = path.basename(preferred, extension);
  return new RegExp(`^${escapeRegExp(stem)} \\(\\d+\\)${escapeRegExp(extension)}$`, 'u').test(value);
}

function numberedDirectoryName(preferred: string, attempt: number) {
  if (attempt === 1) return preferred;
  const suffix = ` (${attempt})`;
  const stem = Array.from(preferred)
    .slice(0, Math.max(1, 96 - Array.from(suffix).length))
    .join('');
  return `${stem}${suffix}`;
}

function numberedFileName(preferred: string, attempt: number) {
  if (attempt === 1) return preferred;
  const extension = path.extname(preferred);
  const stem = path.basename(preferred, extension);
  const suffix = ` (${attempt})`;
  const boundedStem = Array.from(stem)
    .slice(0, Math.max(1, 120 - Array.from(suffix).length))
    .join('');
  return safeAssetFileName(`${boundedStem}${suffix}${extension}`, 'image', extension);
}

function sameFile(leftPath: string, rightPath: string) {
  if (path.resolve(leftPath) === path.resolve(rightPath)) return true;
  try {
    const rightEntry = lstatSync(rightPath);
    if (rightEntry.isSymbolicLink() || !rightEntry.isFile()) return false;
    const left = statSync(leftPath, { bigint: true });
    const right = statSync(rightPath, { bigint: true });
    return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}

function ensureReadOnly(filePath: string) {
  const current = statSync(filePath);
  const readOnlyMode = current.mode & ~0o222;
  if (readOnlyMode !== current.mode) chmodSync(filePath, readOnlyMode);
}

function linkKey(assetId: string, albumId?: string) {
  return albumId ? `ALBUM:${albumId}:${assetId}` : `ALL:${assetId}`;
}

function termLinkKey(assetId: string, termId: string) {
  return `TERM:${termId}:${assetId}`;
}

function directoryKey(contextType: ProjectionDirectoryType, contextId: string) {
  return `${contextType}:${contextId}`;
}

/**
 * Maintains the human-facing directory projection of the immutable object
 * store. SQLite remains authoritative; this view can always be reconciled.
 * Only indexed hard links are removed, and only while they still point to the
 * expected source object. User-created or replaced files are never overwritten.
 */
export class LibraryFileViewRepository {
  private readonly assetFiles: AssetFileRepository;
  private started = false;
  private synchronizationTimer: ReturnType<typeof setTimeout> | null = null;
  private synchronizationRequested = false;
  private synchronizationRunning = false;
  private synchronizationPromise: Promise<void> | null = null;
  private backgroundSynchronizer: (() => Promise<void>) | null = null;

  constructor(private readonly storage: LibraryStorage) {
    this.assetFiles = new AssetFileRepository(storage);
  }

  setBackgroundSynchronizer(synchronizer: (() => Promise<void>) | null) {
    this.backgroundSynchronizer = synchronizer;
  }

  startSynchronization() {
    this.assertProjectionSchemaReady();
    if (!this.started) {
      this.started = true;
      this.storage.setChangeListener(this.onRecordedChange);
    }
    if (this.backgroundSynchronizer) {
      this.scheduleSynchronization();
      return null;
    }
    return this.refresh();
  }

  stopSynchronization() {
    const shouldFlush = this.started;
    this.started = false;
    if (this.synchronizationTimer) clearTimeout(this.synchronizationTimer);
    this.synchronizationTimer = null;
    this.storage.setChangeListener(null);
    try {
      if (
        !this.backgroundSynchronizer &&
        shouldFlush &&
        (this.synchronizationRequested || !this.loadReusableProjection())
      ) {
        this.reconcileAndCheckpoint();
      }
    } catch (error) {
      // Keep the dirty checkpoint so the next launch performs a full repair.
      console.error('[library-file-view] shutdown synchronization failed', error);
    } finally {
      this.synchronizationRequested = false;
    }
  }

  async drainSynchronization() {
    this.stopSynchronization();
    await this.synchronizationPromise;
  }

  scheduleSynchronization() {
    if (!this.started) return;
    this.synchronizationRequested = true;
    if (this.synchronizationTimer || this.synchronizationRunning) return;
    this.synchronizationTimer = setTimeout(() => {
      this.synchronizationTimer = null;
      if (!this.started || !this.synchronizationRequested) return;
      this.synchronizationRequested = false;
      this.synchronizationRunning = true;
      const synchronize = this.backgroundSynchronizer
        ? this.backgroundSynchronizer
        : () => {
            this.reconcileAndCheckpoint();
            return Promise.resolve();
          };
      const synchronization = Promise.resolve()
        .then(synchronize)
        .catch((error) => console.error('[library-file-view] synchronization failed', error))
        .finally(() => {
          if (this.synchronizationPromise === synchronization) this.synchronizationPromise = null;
          this.synchronizationRunning = false;
          if (this.synchronizationRequested) this.scheduleSynchronization();
        });
      this.synchronizationPromise = synchronization;
    }, synchronizationBatchDelayMs);
    this.synchronizationTimer.unref?.();
  }

  synchronize() {
    return this.reconcileAndCheckpoint();
  }

  refresh() {
    return this.loadReusableProjection() ?? this.reconcileAndCheckpoint();
  }

  resolveRevealPath(asset: ResolvedAssetFile, context?: AssetFileRevealContext, repair = true): string {
    this.assertProjectionSchemaReady();
    const effectiveContext = context ?? { kind: 'ALL_MATERIALS' };
    const root = realpathSync(this.storage.libraryRoot);
    let contextualKey = '';
    if (effectiveContext.kind === 'TERM') {
      const belongsToTerm = this.db
        .prepare(
          `SELECT 1 FROM term_media_links
        WHERE term_id = ? AND image_asset_id = ? AND deleted_at IS NULL LIMIT 1`,
        )
        .get(effectiveContext.termId, asset.assetId);
      if (!belongsToTerm) throw new Error('Asset is not part of the requested term');
      contextualKey = termLinkKey(asset.assetId, effectiveContext.termId);
    } else if (effectiveContext.kind === 'ALBUM') {
      const contextualAlbumId = this.albumForAlbumContext(
        asset.assetId,
        effectiveContext.albumId,
        this.loadAlbumTree(),
      );
      if (contextualAlbumId) contextualKey = linkKey(asset.assetId, contextualAlbumId);
    } else if (effectiveContext.kind === 'CREATION') {
      const contextualAlbumId = this.albumForCreationContext(
        asset.assetId,
        effectiveContext.seriesId,
        this.loadAlbumTree(),
      );
      if (contextualAlbumId) contextualKey = linkKey(asset.assetId, contextualAlbumId);
    }

    const resolveIndexedPath = (index: FileViewIndex): string | null => {
      if (effectiveContext.kind === 'ALL_MATERIALS' || effectiveContext.kind === 'DICTIONARY') {
        const targets = this.activeRevealEntries(root, index, asset, effectiveContext);
        if (targets.length !== 1) return null;
        return this.absoluteManagedPath(root, targets[0].relativePath);
      }
      if (!contextualKey) return null;
      const entry = index.links.find((candidate) => candidate.key === contextualKey && candidate.state === 'ACTIVE');
      if (entry) {
        const candidate = this.absoluteManagedPath(root, entry.relativePath);
        if (sameFile(asset.absolutePath, candidate)) return candidate;
      }
      return null;
    };

    const existing = resolveIndexedPath(this.loadIndex(root));
    if (existing) return existing;
    const repaired = repair ? resolveIndexedPath(this.reconcileAndCheckpoint()) : null;
    if (repaired) return repaired;
    if (effectiveContext.kind === 'ALL_MATERIALS' || effectiveContext.kind === 'DICTIONARY') {
      const targets = this.listRevealTargets(asset, effectiveContext);
      if (targets.length > 1) throw new Error('Asset has more than one organized directory');
      throw new Error(
        effectiveContext.kind === 'DICTIONARY'
          ? 'Asset has not been added to a dictionary term'
          : 'Asset has not been added to an album or dictionary term',
      );
    }
    throw new Error('Asset is missing from the requested managed directory');
  }

  async resolveRevealPathAsync(asset: ResolvedAssetFile, context?: AssetFileRevealContext): Promise<string> {
    const effectiveContext = context ?? { kind: 'ALL_MATERIALS' };
    if (!this.backgroundSynchronizer) return this.resolveRevealPath(asset, effectiveContext);
    try {
      return this.resolveRevealPath(asset, effectiveContext, false);
    } catch {
      // Missing/stale managed paths may require a full library reconciliation.
      // Keep that scan in the detached worker, then resolve only from its
      // checkpoint on the Electron host.
      await this.backgroundSynchronizer();
      return this.resolveRevealPath(asset, effectiveContext, false);
    }
  }

  listRevealTargets(asset: ResolvedAssetFile, context?: AssetFileRevealTargetContext): AssetFileRevealTargetDto[] {
    this.assertProjectionSchemaReady();
    const effectiveContext = context ?? { kind: 'ALL_MATERIALS' };
    const root = realpathSync(this.storage.libraryRoot);
    const entries = this.activeRevealEntries(root, this.loadIndex(root), asset, effectiveContext);
    return entries.map((entry) => {
      const directory = path.dirname(entry.relativePath).split(path.sep).join('/');
      if (entry.contextType === 'ALBUM') {
        const row = this.db
          .prepare(
            `SELECT title FROM albums
          WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(entry.contextId) as JsonMap | undefined;
        return {
          context: { kind: 'ALBUM', albumId: entry.contextId },
          label: row ? text(row.title) : path.basename(directory),
          relativeDirectory: directory,
        };
      }
      const row = this.db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(revision.title), ''), '未命名词条') AS title
        FROM terms term
        JOIN term_revisions revision ON revision.id = term.current_revision_id
        WHERE term.id = ?`,
        )
        .get(entry.contextId) as JsonMap | undefined;
      return {
        context: { kind: 'TERM', termId: entry.contextId },
        label: row ? text(row.title) : path.basename(directory),
        relativeDirectory: directory,
      };
    });
  }

  private readonly onRecordedChange = (change: RecordedLibraryChange) => {
    if (change.affectsFileView === false || !this.changeAffectsProjection(change)) return;
    this.scheduleSynchronization();
  };

  private changeAffectsProjection(change: RecordedLibraryChange) {
    if (directProjectionChangeTypes.has(change.entityType)) return true;
    if (creationProjectionChangeTypes.has(change.entityType)) {
      const seriesId =
        change.entityType === 'PROMPT_SERIES'
          ? change.entityId
          : change.entityType === 'PROMPT_VERSION'
            ? text(
                (
                  this.db.prepare('SELECT series_id FROM prompt_versions WHERE id = ?').get(change.entityId) as
                    JsonMap | undefined
                )?.series_id,
              )
            : change.entityType === 'GENERATION_RUN'
              ? text(
                  (
                    this.db
                      .prepare(
                        `SELECT version.series_id FROM generation_runs run
                      JOIN prompt_versions version ON version.id = run.prompt_version_id
                      WHERE run.id = ?`,
                      )
                      .get(change.entityId) as JsonMap | undefined
                  )?.series_id,
                )
              : text(
                  (
                    this.db
                      .prepare('SELECT series_id FROM creation_output_imports WHERE id = ?')
                      .get(change.entityId) as JsonMap | undefined
                  )?.series_id,
                );
      if (!seriesId) return false;
      return Boolean(
        this.db
          .prepare(
            `SELECT 1 FROM album_members member
          JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
          WHERE member.target_type = 'SERIES' AND member.target_id = ?
            AND member.deleted_at IS NULL LIMIT 1`,
          )
          .get(seriesId),
      );
    }

    // A newly stored object or material cannot belong to a managed album/term
    // yet. The relationship mutation that follows is the projection trigger.
    // Skipping these hot-path events prevents plain imports from scheduling an
    // unrelated full managed-folder reconciliation.
    if (assetProjectionChangeTypes.has(change.entityType)) {
      if (change.operation === 'IMPORT') return false;
      return Boolean(
        this.db
          .prepare(
            `SELECT 1 FROM file_projection_links
          WHERE image_asset_id = ? LIMIT 1`,
          )
          .get(change.entityId),
      );
    }

    if (materialProjectionChangeTypes.has(change.entityType)) {
      if (change.entityType === 'MATERIAL' && change.operation === 'CREATE') return false;
      return Boolean(
        this.db
          .prepare(
            `SELECT 1
          FROM materials material
          JOIN file_projection_links link ON link.image_asset_id = material.image_asset_id
          WHERE material.id = ? LIMIT 1`,
          )
          .get(change.entityId),
      );
    }

    return false;
  }

  private activeRevealEntries(
    root: string,
    index: FileViewIndex,
    asset: ResolvedAssetFile,
    context: AssetFileRevealTargetContext,
  ) {
    return index.links
      .filter(
        (entry) =>
          entry.assetId === asset.assetId &&
          entry.state === 'ACTIVE' &&
          (context.kind === 'DICTIONARY'
            ? entry.contextType === 'TERM'
            : entry.contextType === 'ALBUM' || entry.contextType === 'TERM'),
      )
      .filter((entry) => sameFile(asset.absolutePath, this.absoluteManagedPath(root, entry.relativePath)))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  private get db() {
    return this.storage.db;
  }

  private loadReusableProjection(): FileViewIndex | null {
    const placeholders = projectionCacheMetadataKeys.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT key, value FROM app_meta
      WHERE key IN (${placeholders})`,
      )
      .all(...projectionCacheMetadataKeys) as JsonMap[];
    const metadata = new Map(rows.map((row) => [text(row.key), text(row.value)]));
    if (
      metadata.get(projectionCacheVersionKey) !== projectionCacheAlgorithmVersion ||
      metadata.get(projectionCacheStateKey) !== 'CLEAN'
    )
      return null;

    const checkpointRowId = storedNonNegativeInteger(metadata.get(projectionCacheChangeRowIdKey));
    const checkpointSchemaVersion = storedNonNegativeInteger(metadata.get(projectionCacheSchemaVersionKey));
    const expectedDirectoryCount = storedNonNegativeInteger(metadata.get(projectionCacheDirectoryCountKey));
    const expectedLinkCount = storedNonNegativeInteger(metadata.get(projectionCacheLinkCountKey));
    const expectedTermPlacementCount = storedNonNegativeInteger(metadata.get(projectionCacheTermPlacementCountKey));
    if (
      checkpointRowId === null ||
      checkpointSchemaVersion === null ||
      expectedDirectoryCount === null ||
      expectedLinkCount === null ||
      expectedTermPlacementCount === null ||
      checkpointSchemaVersion !== this.currentSchemaVersion() ||
      this.hasUnsettledProjectionRows()
    )
      return null;

    const currentChangeRowId = this.currentChangeRowId();
    if (currentChangeRowId < checkpointRowId || this.hasRelevantProjectionChangesAfter(checkpointRowId)) return null;

    const root = realpathSync(this.storage.libraryRoot);
    const index = this.loadIndex(root);
    const activeDirectoryCount = index.directories.filter((entry) => entry.state === 'ACTIVE').length;
    const activeLinkCount = index.links.filter((entry) => entry.state === 'ACTIVE').length;
    const termPlacementCount = Number(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
      FROM term_directory_placements`,
        )
        .pluck()
        .get(),
    );
    if (
      activeDirectoryCount !== expectedDirectoryCount ||
      activeLinkCount !== expectedLinkCount ||
      termPlacementCount !== expectedTermPlacementCount
    )
      return null;

    // Ignore unrelated change events without carrying an ever-growing scan range.
    if (currentChangeRowId > checkpointRowId) {
      this.writeProjectionCacheValue(projectionCacheChangeRowIdKey, String(currentChangeRowId));
    }
    return index;
  }

  private reconcileAndCheckpoint(): FileViewIndex {
    // This is a projection-work marker, not a process-lifetime marker. A dev
    // watcher may terminate Electron abruptly while an already-clean projection
    // remains safe to reuse; an interrupted reconciliation remains DIRTY.
    this.writeProjectionCacheValue(projectionCacheStateKey, 'DIRTY');
    const checkpointRowId = this.currentChangeRowId();
    const schemaVersion = this.currentSchemaVersion();
    const index = this.reconcile();
    this.persistProjectionCheckpoint(index, checkpointRowId, schemaVersion);
    return index;
  }

  private persistProjectionCheckpoint(index: FileViewIndex, changeRowId: number, schemaVersion: number) {
    const activeDirectoryCount = index.directories.filter((entry) => entry.state === 'ACTIVE').length;
    const activeLinkCount = index.links.filter((entry) => entry.state === 'ACTIVE').length;
    const termPlacementCount = Number(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
      FROM term_directory_placements`,
        )
        .pluck()
        .get(),
    );
    const values = [
      [projectionCacheVersionKey, projectionCacheAlgorithmVersion],
      [projectionCacheStateKey, 'CLEAN'],
      [projectionCacheChangeRowIdKey, String(changeRowId)],
      [projectionCacheSchemaVersionKey, String(schemaVersion)],
      [projectionCacheDirectoryCountKey, String(activeDirectoryCount)],
      [projectionCacheLinkCountKey, String(activeLinkCount)],
      [projectionCacheTermPlacementCountKey, String(termPlacementCount)],
    ] as const;
    const upsert = this.db.prepare(`INSERT INTO app_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    this.db.transaction(() => {
      for (const [key, value] of values) upsert.run(key, value);
    })();
  }

  private writeProjectionCacheValue(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO app_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  private currentChangeRowId() {
    const value = Number(
      this.db
        .prepare(
          `SELECT COALESCE(MAX(rowid), 0)
      FROM change_events`,
        )
        .pluck()
        .get(),
    );
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private currentSchemaVersion() {
    const value = Number(
      this.db
        .prepare(
          `SELECT value FROM app_meta
      WHERE key = 'database_schema_revision'`,
        )
        .pluck()
        .get(),
    );
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private hasRelevantProjectionChangesAfter(changeRowId: number) {
    const placeholders = directProjectionChangeTypeValues.map(() => '?').join(', ');
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM change_events
      WHERE rowid > ? AND (
        entity_type IN (${placeholders})
        OR (
          entity_type = 'IMAGE_ASSET'
          AND EXISTS (
            SELECT 1 FROM file_projection_links link
            WHERE link.image_asset_id = change_events.entity_id
          )
        )
        OR (
          entity_type IN ('MATERIAL', 'EXTERNAL_MATERIAL_METADATA')
          AND EXISTS (
            SELECT 1 FROM materials material
            JOIN file_projection_links link ON link.image_asset_id = material.image_asset_id
            WHERE material.id = change_events.entity_id
          )
        )
      ) LIMIT 1`,
        )
        .get(changeRowId, ...directProjectionChangeTypeValues),
    );
  }

  private hasUnsettledProjectionRows() {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM file_projection_directories
      WHERE state NOT IN ('ACTIVE', 'RETIRED') LIMIT 1`,
        )
        .get() ||
      this.db
        .prepare(
          `SELECT 1 FROM file_projection_links
        WHERE state NOT IN ('ACTIVE', 'RETIRED') LIMIT 1`,
        )
        .get(),
    );
  }

  private reconcile(): FileViewIndex {
    this.assertProjectionSchemaReady();
    const root = realpathSync(this.storage.libraryRoot);
    const albumsRoot = this.ensureExactDirectory(root, albumsDirectoryName);
    const termsRoot = this.ensureExactDirectory(root, termsDirectoryName);
    const previousIndex = this.loadIndex(root);
    this.retireUnavailableProjectionReservations(root, previousIndex);
    const albums = this.loadAlbumTree();
    const terms = this.loadTermDirectoryNodes();
    const assets = this.loadAssets();
    const previousDirectories = previousIndex.directories;
    const albumDirectories = this.reconcileAlbumDirectories(root, albumsRoot, albums, previousDirectories);
    const termProjection = this.reconcileTermDirectories(root, termsRoot, terms, previousDirectories);
    const currentDirectories = [
      ...[...albumDirectories.entries()].map(([albumId, absolutePath]) => ({
        key: directoryKey('ALBUM', albumId),
        contextType: 'ALBUM' as const,
        contextId: albumId,
        parentKey: albums.get(albumId)?.parentId ? directoryKey('ALBUM', albums.get(albumId)!.parentId!) : null,
        state: 'ACTIVE' as const,
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel: safeDirectoryLabel(albums.get(albumId)?.title ?? ''),
      })),
      ...termProjection.directories,
    ];
    this.persistCurrentDirectories(currentDirectories);
    const desiredLinks = this.buildDesiredLinks(root, assets, albumDirectories, termProjection.termDirectories, terms);
    const previousLinks = previousIndex.links;
    const links = this.reconcileLinks(root, desiredLinks, previousLinks);
    this.removeEmptyManagedDirectories(root, previousDirectories, currentDirectories);

    const nextIndex: FileViewIndex = {
      directories: currentDirectories,
      links,
    };
    this.saveIndex(nextIndex);
    return nextIndex;
  }

  private loadAssets() {
    const rows = this.db
      .prepare(
        `WITH projected_asset_ids AS (
          SELECT material.image_asset_id AS asset_id
          FROM album_members member
          JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
          JOIN materials material ON material.id = member.target_id
            AND material.kind = 'IMAGE' AND material.deleted_at IS NULL
          WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
          UNION
          SELECT run.result_asset_id AS asset_id
          FROM album_members member
          JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
          JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
          JOIN prompt_versions version ON version.series_id = series.id
          JOIN generation_runs run ON run.prompt_version_id = version.id
          WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
            AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
          UNION
          SELECT imported.image_asset_id AS asset_id
          FROM album_members member
          JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
          JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
          JOIN creation_output_imports imported ON imported.series_id = series.id
            AND imported.deleted_at IS NULL
          WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
          UNION
          SELECT binding.image_asset_id AS asset_id
          FROM album_members member
          JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
          JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
          JOIN prompt_versions version ON version.series_id = series.id
          JOIN reference_bindings binding ON binding.prompt_version_id = version.id
          WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
          UNION
          SELECT media.image_asset_id AS asset_id
          FROM term_media_links media
          JOIN terms term ON term.id = media.term_id AND term.archived_at IS NULL
          WHERE media.deleted_at IS NULL
        )
        SELECT asset.id
        FROM projected_asset_ids projected
        JOIN image_assets asset ON asset.id = projected.asset_id AND asset.deleted_at IS NULL
        ORDER BY asset.created_at, asset.id`,
      )
      .all() as JsonMap[];
    const assets = new Map<string, ResolvedAssetFile>();
    for (const row of rows) {
      const asset = this.assetFiles.resolve(text(row.id));
      if (asset) assets.set(asset.assetId, asset);
    }
    return assets;
  }

  private retireUnavailableProjectionReservations(root: string, index: FileViewIndex) {
    const missingDirectoryKeys = index.directories
      .filter((entry) => entry.state !== 'RETIRED')
      .filter((entry) => !existsSync(this.absoluteManagedPath(root, entry.relativePath)))
      .map((entry) => entry.key);
    const missingLinkKeys = index.links
      .filter((entry) => entry.state !== 'RETIRED')
      .filter((entry) => !existsSync(this.absoluteManagedPath(root, entry.relativePath)))
      .map((entry) => entry.key);
    if (missingDirectoryKeys.length === 0 && missingLinkKeys.length === 0) return;

    const timestamp = now();
    const retireDirectory = this.db.prepare(`UPDATE file_projection_directories
      SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
      WHERE projection_key = ? AND state <> 'RETIRED'`);
    const retireLink = this.db.prepare(`UPDATE file_projection_links
      SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
      WHERE projection_key = ? AND state <> 'RETIRED'`);
    this.db.transaction(() => {
      for (const key of missingDirectoryKeys) retireDirectory.run(timestamp, timestamp, key);
      for (const key of missingLinkKeys) retireLink.run(timestamp, timestamp, key);
    })();
  }

  private loadIndex(root: string): FileViewIndex {
    const directoryRows = this.db
      .prepare(
        `SELECT projection_key, context_type, context_id, parent_projection_key, state,
        relative_path, preferred_name
      FROM file_projection_directories
      ORDER BY projection_key`,
      )
      .all() as JsonMap[];
    const linkRows = this.db
      .prepare(
        `SELECT projection_key, context_type, context_id, directory_projection_key, state,
        image_asset_id,
        relative_path, source_relative_path, source_object_hash, preferred_name
      FROM file_projection_links
      ORDER BY projection_key`,
      )
      .all() as JsonMap[];
    return {
      directories: directoryRows
        .map((row): IndexedDirectory => ({
          key: text(row.projection_key),
          contextType: text(row.context_type) as ProjectionDirectoryType,
          contextId: text(row.context_id),
          parentKey: text(row.parent_projection_key) || null,
          state: text(row.state) as ProjectionState,
          relativePath: text(row.relative_path),
          preferredLabel: text(row.preferred_name),
        }))
        .filter((entry) => this.isValidDirectoryRecord(root, entry)),
      links: linkRows
        .map((row): IndexedLink => ({
          key: text(row.projection_key),
          contextType: text(row.context_type) as ProjectionLinkType,
          contextId: text(row.context_id),
          directoryKey: text(row.directory_projection_key),
          state: text(row.state) as ProjectionState,
          assetId: text(row.image_asset_id),
          relativePath: text(row.relative_path),
          sourceRelativePath: text(row.source_relative_path),
          sourceObjectHash: text(row.source_object_hash),
          preferredName: text(row.preferred_name),
        }))
        .filter((entry) => this.isValidLinkRecord(root, entry)),
    } satisfies FileViewIndex;
  }

  private persistCurrentDirectories(directories: IndexedDirectory[]) {
    const timestamp = now();
    const upsert = this.db.prepare(`INSERT INTO file_projection_directories
      (projection_key, context_type, context_id, parent_projection_key,
        relative_path, relative_path_key, previous_relative_path,
        preferred_name, allocated_name, allocated_name_key,
        state, reserved_until, last_error, verified_at, retired_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'ACTIVE', NULL, NULL, ?, NULL, ?, ?)
      ON CONFLICT(projection_key) DO UPDATE SET
        context_type = excluded.context_type,
        context_id = excluded.context_id,
        parent_projection_key = excluded.parent_projection_key,
        previous_relative_path = CASE
          WHEN file_projection_directories.relative_path <> excluded.relative_path
            THEN file_projection_directories.relative_path
          ELSE file_projection_directories.previous_relative_path
        END,
        relative_path = excluded.relative_path,
        relative_path_key = excluded.relative_path_key,
        preferred_name = excluded.preferred_name,
        allocated_name = excluded.allocated_name,
        allocated_name_key = excluded.allocated_name_key,
        state = 'ACTIVE',
        last_error = NULL,
        verified_at = excluded.verified_at,
        retired_at = NULL,
        updated_at = excluded.updated_at`);
    this.db.transaction(() => {
      for (const entry of directories) {
        const allocatedName = path.basename(entry.relativePath);
        upsert.run(
          entry.key,
          entry.contextType,
          entry.contextId,
          entry.parentKey,
          entry.relativePath,
          collisionKey(entry.relativePath),
          entry.preferredLabel,
          allocatedName,
          collisionKey(allocatedName),
          timestamp,
          timestamp,
          timestamp,
        );
      }
    })();
  }

  private saveIndex(index: FileViewIndex) {
    this.db.transaction(() => {
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE file_projection_links
        SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
        WHERE state <> 'RETIRED'`,
        )
        .run(timestamp, timestamp);
      this.db
        .prepare(
          `UPDATE file_projection_directories
        SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
        WHERE state <> 'RETIRED'`,
        )
        .run(timestamp, timestamp);
      const insertDirectory = this.db.prepare(`INSERT INTO file_projection_directories
        (projection_key, context_type, context_id, parent_projection_key,
          relative_path, relative_path_key, preferred_name,
          allocated_name, allocated_name_key, state, last_error, verified_at, retired_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, NULL, ?, ?)
        ON CONFLICT(projection_key) DO UPDATE SET
          context_type = excluded.context_type,
          context_id = excluded.context_id,
          parent_projection_key = excluded.parent_projection_key,
          relative_path = excluded.relative_path,
          relative_path_key = excluded.relative_path_key,
          preferred_name = excluded.preferred_name,
          allocated_name = excluded.allocated_name,
          allocated_name_key = excluded.allocated_name_key,
          state = 'ACTIVE',
          last_error = NULL,
          verified_at = excluded.verified_at,
          retired_at = NULL,
          updated_at = excluded.updated_at`);
      for (const entry of index.directories) {
        const allocatedName = path.basename(entry.relativePath);
        insertDirectory.run(
          entry.key,
          entry.contextType,
          entry.contextId,
          entry.parentKey,
          entry.relativePath,
          collisionKey(entry.relativePath),
          entry.preferredLabel,
          allocatedName,
          collisionKey(allocatedName),
          timestamp,
          timestamp,
          timestamp,
        );
      }
      const insertLink = this.db.prepare(`INSERT INTO file_projection_links
        (projection_key, context_type, context_id, directory_projection_key,
          image_asset_id, relative_path, relative_path_key,
          source_relative_path, source_object_hash, preferred_name, allocated_name, allocated_name_key,
          state, last_error, verified_at, retired_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, NULL, ?, ?)
        ON CONFLICT(projection_key) DO UPDATE SET
          context_type = excluded.context_type,
          context_id = excluded.context_id,
          directory_projection_key = excluded.directory_projection_key,
          image_asset_id = excluded.image_asset_id,
          relative_path = excluded.relative_path,
          relative_path_key = excluded.relative_path_key,
          source_relative_path = excluded.source_relative_path,
          source_object_hash = excluded.source_object_hash,
          preferred_name = excluded.preferred_name,
          allocated_name = excluded.allocated_name,
          allocated_name_key = excluded.allocated_name_key,
          state = 'ACTIVE',
          last_error = NULL,
          verified_at = excluded.verified_at,
          retired_at = NULL,
          updated_at = excluded.updated_at`);
      for (const entry of index.links) {
        const allocatedName = path.basename(entry.relativePath);
        insertLink.run(
          entry.key,
          entry.contextType,
          entry.contextId,
          entry.directoryKey || null,
          entry.assetId,
          entry.relativePath,
          collisionKey(entry.relativePath),
          entry.sourceRelativePath,
          entry.sourceObjectHash,
          entry.preferredName,
          allocatedName,
          collisionKey(allocatedName),
          timestamp,
          timestamp,
          timestamp,
        );
      }
    })();
  }

  private persistPendingLink(root: string, entry: DesiredLink, destination: string) {
    const timestamp = now();
    const relativePath = this.relativeManagedPath(root, destination);
    const sourceRelativePath = this.relativeSafePath(root, entry.asset.absolutePath);
    const allocatedName = path.basename(destination);
    this.db
      .prepare(
        `INSERT INTO file_projection_links
      (projection_key, context_type, context_id, directory_projection_key, image_asset_id,
        relative_path, relative_path_key, previous_relative_path,
        source_relative_path, source_object_hash, preferred_name, allocated_name, allocated_name_key,
        state, reserved_until, last_error, verified_at, retired_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'PENDING_CREATE', NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(projection_key) DO UPDATE SET
        context_type = excluded.context_type,
        context_id = excluded.context_id,
        directory_projection_key = excluded.directory_projection_key,
        image_asset_id = excluded.image_asset_id,
        previous_relative_path = CASE
          WHEN file_projection_links.relative_path <> excluded.relative_path
            THEN file_projection_links.relative_path
          ELSE file_projection_links.previous_relative_path
        END,
        relative_path = excluded.relative_path,
        relative_path_key = excluded.relative_path_key,
        source_relative_path = excluded.source_relative_path,
        source_object_hash = excluded.source_object_hash,
        preferred_name = excluded.preferred_name,
        allocated_name = excluded.allocated_name,
        allocated_name_key = excluded.allocated_name_key,
        state = 'PENDING_CREATE',
        last_error = NULL,
        retired_at = NULL,
        updated_at = excluded.updated_at`,
      )
      .run(
        entry.key,
        entry.contextType,
        entry.contextId,
        entry.directoryKey || null,
        entry.asset.assetId,
        relativePath,
        collisionKey(relativePath),
        sourceRelativePath,
        entry.asset.objectHash,
        entry.preferredName,
        allocatedName,
        collisionKey(allocatedName),
        timestamp,
        timestamp,
      );
  }

  private updateLinkState(key: string, state: ProjectionState, error: unknown = null) {
    const timestamp = now();
    const lastError = error instanceof Error ? error.message : error ? String(error) : null;
    this.db
      .prepare(
        `UPDATE file_projection_links
      SET state = ?, last_error = ?,
        verified_at = CASE WHEN ? = 'ACTIVE' THEN ? ELSE verified_at END,
        retired_at = CASE WHEN ? = 'RETIRED' THEN ? ELSE NULL END,
        updated_at = ?
      WHERE projection_key = ?`,
      )
      .run(state, lastError, state, timestamp, state, timestamp, timestamp, key);
  }

  private isValidDirectoryRecord(root: string, value: unknown): value is IndexedDirectory {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<IndexedDirectory>;
    return (
      typeof entry.key === 'string' &&
      ['ALBUM', 'TERM_DOMAIN', 'TERM_TYPE', 'TERM'].includes(entry.contextType ?? '') &&
      typeof entry.contextId === 'string' &&
      (entry.parentKey === null || typeof entry.parentKey === 'string') &&
      ['PENDING_CREATE', 'ACTIVE', 'PENDING_DELETE', 'ERROR', 'RETIRED'].includes(entry.state ?? '') &&
      typeof entry.relativePath === 'string' &&
      typeof entry.preferredLabel === 'string' &&
      this.isManagedViewPath(root, entry.relativePath)
    );
  }

  private isValidLinkRecord(root: string, value: unknown): value is IndexedLink {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<IndexedLink>;
    return (
      typeof entry.key === 'string' &&
      ['ALBUM', 'TERM'].includes(entry.contextType ?? '') &&
      typeof entry.contextId === 'string' &&
      typeof entry.directoryKey === 'string' &&
      ['PENDING_CREATE', 'ACTIVE', 'PENDING_DELETE', 'ERROR', 'RETIRED'].includes(entry.state ?? '') &&
      typeof entry.assetId === 'string' &&
      typeof entry.relativePath === 'string' &&
      typeof entry.sourceRelativePath === 'string' &&
      typeof entry.sourceObjectHash === 'string' &&
      typeof entry.preferredName === 'string' &&
      this.isManagedViewPath(root, entry.relativePath) &&
      this.isSafeRelativePath(root, entry.sourceRelativePath)
    );
  }

  private reconcileAlbumDirectories(
    root: string,
    albumsRoot: string,
    albums: Map<string, AlbumNode>,
    previousDirectories: IndexedDirectory[],
  ) {
    const directories = new Map<string, string>();
    const previousByAlbum = new Map<string, IndexedDirectory>();
    for (const entry of previousDirectories) {
      if (entry.contextType !== 'ALBUM') continue;
      const existing = previousByAlbum.get(entry.contextId);
      if (!existing || (entry.preferredLabel && !existing.preferredLabel)) {
        previousByAlbum.set(entry.contextId, entry);
      }
    }

    const nodes = [...albums.values()].sort((left, right) => {
      const depthDifference = this.albumDepth(left.id, albums) - this.albumDepth(right.id, albums);
      if (depthDifference) return depthDifference;
      const leftPrevious = previousByAlbum.get(left.id);
      const rightPrevious = previousByAlbum.get(right.id);
      const leftStable = leftPrevious?.preferredLabel === safeDirectoryLabel(left.title) ? 0 : 1;
      const rightStable = rightPrevious?.preferredLabel === safeDirectoryLabel(right.title) ? 0 : 1;
      return (
        leftStable - rightStable || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
    });

    const claimedByParent = new Map<string, Set<string>>();
    for (const node of nodes) {
      const parentDirectory = node.parentId ? directories.get(node.parentId) : albumsRoot;
      if (!parentDirectory) continue;
      const parentKey = this.absolutePathKey(parentDirectory);
      let claimed = claimedByParent.get(parentKey);
      if (!claimed) {
        claimed = new Set(readdirSync(parentDirectory).map((name) => collisionKey(name)));
        claimedByParent.set(parentKey, claimed);
      }

      const preferredLabel = safeDirectoryLabel(node.title);
      const previous = previousByAlbum.get(node.id);
      let selectedName = '';
      if (previous?.preferredLabel === preferredLabel) {
        const previousName = path.basename(this.absoluteManagedPath(root, previous.relativePath));
        const previousParent = path.dirname(this.absoluteManagedPath(root, previous.relativePath));
        if (isNumberedDirectoryName(previousName, preferredLabel)) {
          if (this.absolutePathKey(previousParent) === parentKey) claimed.delete(collisionKey(previousName));
          if (!claimed.has(collisionKey(previousName))) selectedName = previousName;
        }
      }
      if (!selectedName) {
        for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
          const candidate = numberedDirectoryName(preferredLabel, attempt);
          if (!claimed.has(collisionKey(candidate))) {
            selectedName = candidate;
            break;
          }
        }
      }
      if (!selectedName) throw new Error(`Unable to allocate a directory name for album ${node.id}`);
      claimed.add(collisionKey(selectedName));

      const destination = path.resolve(parentDirectory, selectedName);
      this.assertInside(root, destination);
      if (!existsSync(destination)) mkdirSync(destination);
      const entry = lstatSync(destination);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`Album directory is unavailable: ${selectedName}`);
      }
      const resolved = realpathSync(destination);
      this.assertInside(root, resolved);
      directories.set(node.id, resolved);
    }
    return directories;
  }

  private reconcileTermDirectories(
    root: string,
    termsRoot: string,
    terms: TermDirectoryNode[],
    previousDirectories: IndexedDirectory[],
  ) {
    const previousByKey = new Map(
      previousDirectories.filter((entry) => entry.contextType !== 'ALBUM').map((entry) => [entry.key, entry]),
    );
    const claimedByParent = new Map<string, Set<string>>();
    const directories: IndexedDirectory[] = [];
    const domainDirectories = new Map<string, string>();
    const typeDirectories = new Map<string, string>();
    const termDirectories = new Map<string, string>();

    const domains = new Map<string, { id: string; name: string; createdAt: string }>();
    for (const term of terms) {
      const current = domains.get(term.domainId);
      if (!current || term.createdAt < current.createdAt) {
        domains.set(term.domainId, { id: term.domainId, name: term.domainName, createdAt: term.createdAt });
      }
    }
    const sortedDomains = [...domains.values()].sort((left, right) =>
      this.stableDirectoryOrder(
        directoryKey('TERM_DOMAIN', left.id),
        left.name,
        left.createdAt,
        directoryKey('TERM_DOMAIN', right.id),
        right.name,
        right.createdAt,
        previousByKey,
      ),
    );
    for (const domain of sortedDomains) {
      const key = directoryKey('TERM_DOMAIN', domain.id);
      const preferredLabel = safeDirectoryLabel(domain.name, '未分类');
      const absolutePath = this.allocateProjectionDirectory(
        root,
        termsRoot,
        preferredLabel,
        previousByKey.get(key),
        claimedByParent,
      );
      domainDirectories.set(domain.id, absolutePath);
      directories.push({
        key,
        contextType: 'TERM_DOMAIN',
        contextId: domain.id,
        parentKey: null,
        state: 'ACTIVE',
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel,
      });
    }

    const types = new Map<
      string,
      {
        contextId: string;
        domainId: string;
        name: string;
        createdAt: string;
      }
    >();
    for (const term of terms) {
      if (!term.typeId) continue;
      const contextId = JSON.stringify([term.domainId, term.typeId]);
      const current = types.get(contextId);
      if (!current || term.createdAt < current.createdAt) {
        types.set(contextId, {
          contextId,
          domainId: term.domainId,
          name: term.typeName,
          createdAt: term.createdAt,
        });
      }
    }
    const sortedTypes = [...types.values()].sort(
      (left, right) =>
        left.domainId.localeCompare(right.domainId) ||
        this.stableDirectoryOrder(
          directoryKey('TERM_TYPE', left.contextId),
          left.name,
          left.createdAt,
          directoryKey('TERM_TYPE', right.contextId),
          right.name,
          right.createdAt,
          previousByKey,
        ),
    );
    for (const type of sortedTypes) {
      const parentDirectory = domainDirectories.get(type.domainId);
      if (!parentDirectory) continue;
      const key = directoryKey('TERM_TYPE', type.contextId);
      const preferredLabel = safeDirectoryLabel(type.name, '未分类');
      const absolutePath = this.allocateProjectionDirectory(
        root,
        parentDirectory,
        preferredLabel,
        previousByKey.get(key),
        claimedByParent,
      );
      typeDirectories.set(type.contextId, absolutePath);
      directories.push({
        key,
        contextType: 'TERM_TYPE',
        contextId: type.contextId,
        parentKey: directoryKey('TERM_DOMAIN', type.domainId),
        state: 'ACTIVE',
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel,
      });
    }

    const sortedTerms = [...terms].sort((left, right) => {
      const leftParent = left.typeId ? JSON.stringify([left.domainId, left.typeId]) : left.domainId;
      const rightParent = right.typeId ? JSON.stringify([right.domainId, right.typeId]) : right.domainId;
      return (
        leftParent.localeCompare(rightParent) ||
        this.stableDirectoryOrder(
          directoryKey('TERM', left.id),
          left.name,
          left.createdAt,
          directoryKey('TERM', right.id),
          right.name,
          right.createdAt,
          previousByKey,
        )
      );
    });
    for (const term of sortedTerms) {
      const typeContextId = JSON.stringify([term.domainId, term.typeId]);
      const parentDirectory = term.typeId ? typeDirectories.get(typeContextId) : domainDirectories.get(term.domainId);
      if (!parentDirectory) continue;
      const key = directoryKey('TERM', term.id);
      const preferredLabel = safeDirectoryLabel(term.name, '未命名词条');
      const absolutePath = this.allocateProjectionDirectory(
        root,
        parentDirectory,
        preferredLabel,
        previousByKey.get(key),
        claimedByParent,
      );
      termDirectories.set(term.id, absolutePath);
      directories.push({
        key,
        contextType: 'TERM',
        contextId: term.id,
        parentKey: term.typeId ? directoryKey('TERM_TYPE', typeContextId) : directoryKey('TERM_DOMAIN', term.domainId),
        state: 'ACTIVE',
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel,
      });
    }
    return { termDirectories, directories };
  }

  private stableDirectoryOrder(
    leftKey: string,
    leftName: string,
    leftCreatedAt: string,
    rightKey: string,
    rightName: string,
    rightCreatedAt: string,
    previousByKey: Map<string, IndexedDirectory>,
  ) {
    const leftStable = previousByKey.get(leftKey)?.preferredLabel === safeDirectoryLabel(leftName, '未分类') ? 0 : 1;
    const rightStable = previousByKey.get(rightKey)?.preferredLabel === safeDirectoryLabel(rightName, '未分类') ? 0 : 1;
    return leftStable - rightStable || leftCreatedAt.localeCompare(rightCreatedAt) || leftKey.localeCompare(rightKey);
  }

  private allocateProjectionDirectory(
    root: string,
    parentDirectory: string,
    preferredLabel: string,
    previous: IndexedDirectory | undefined,
    claimedByParent: Map<string, Set<string>>,
  ) {
    const parentKey = this.absolutePathKey(parentDirectory);
    let claimed = claimedByParent.get(parentKey);
    if (!claimed) {
      claimed = new Set(readdirSync(parentDirectory).map((name) => collisionKey(name)));
      claimedByParent.set(parentKey, claimed);
    }

    let selectedName = '';
    if (previous?.preferredLabel === preferredLabel) {
      const previousPath = this.absoluteManagedPath(root, previous.relativePath);
      const previousName = path.basename(previousPath);
      const previousParent = path.dirname(previousPath);
      if (isNumberedDirectoryName(previousName, preferredLabel)) {
        if (this.absolutePathKey(previousParent) === parentKey) claimed.delete(collisionKey(previousName));
        if (!claimed.has(collisionKey(previousName))) selectedName = previousName;
      }
    }
    if (!selectedName) {
      for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
        const candidate = numberedDirectoryName(preferredLabel, attempt);
        if (!claimed.has(collisionKey(candidate))) {
          selectedName = candidate;
          break;
        }
      }
    }
    if (!selectedName) throw new Error(`Unable to allocate a managed directory for ${preferredLabel}`);
    claimed.add(collisionKey(selectedName));

    const destination = path.resolve(parentDirectory, selectedName);
    this.assertInside(root, destination);
    if (!existsSync(destination)) mkdirSync(destination);
    const entry = lstatSync(destination);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Managed directory is unavailable: ${selectedName}`);
    }
    const resolved = realpathSync(destination);
    this.assertInside(root, resolved);
    return resolved;
  }

  private buildDesiredLinks(
    root: string,
    assets: Map<string, ResolvedAssetFile>,
    albumDirectories: Map<string, string>,
    termDirectories: Map<string, string>,
    terms: TermDirectoryNode[],
  ) {
    const desired = new Map<string, DesiredLink>();

    const rows = this.db
      .prepare(
        `SELECT member.album_id, material.image_asset_id AS asset_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN materials material ON material.id = member.target_id
        AND material.kind = 'IMAGE' AND material.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
      UNION
      SELECT member.album_id, run.result_asset_id AS asset_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
      JOIN prompt_versions version ON version.series_id = series.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      JOIN image_assets asset ON asset.id = run.result_asset_id AND asset.deleted_at IS NULL
      WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
        AND run.status = 'SUCCEEDED'
      UNION
      SELECT member.album_id, imported.image_asset_id AS asset_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
      JOIN creation_output_imports imported ON imported.series_id = series.id
        AND imported.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = imported.image_asset_id AND asset.deleted_at IS NULL
      WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
      UNION
      SELECT member.album_id, binding.image_asset_id AS asset_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
      JOIN prompt_versions version ON version.series_id = series.id
      JOIN reference_bindings binding ON binding.prompt_version_id = version.id
      JOIN image_assets asset ON asset.id = binding.image_asset_id AND asset.deleted_at IS NULL
      WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
      ORDER BY album_id, asset_id`,
      )
      .all() as JsonMap[];
    for (const row of rows) {
      const albumId = text(row.album_id);
      const assetId = text(row.asset_id);
      const directoryPath = albumDirectories.get(albumId);
      const asset = assets.get(assetId);
      if (!directoryPath || !asset) continue;
      const key = linkKey(assetId, albumId);
      desired.set(key, {
        key,
        asset,
        directoryPath,
        preferredName: this.preferredAssetName(asset),
        contextType: 'ALBUM',
        contextId: albumId,
        directoryKey: directoryKey('ALBUM', albumId),
        allocationOrder: 0,
      });
    }

    const termsById = new Map(terms.map((term) => [term.id, term]));
    const termMediaRows = this.db
      .prepare(
        `SELECT media.term_id, media.image_asset_id AS asset_id,
        media.role, media.sort_order, media.created_at
      FROM term_media_links media
      JOIN terms term ON term.id = media.term_id
      JOIN image_assets asset ON asset.id = media.image_asset_id AND asset.deleted_at IS NULL
      WHERE media.deleted_at IS NULL
      ORDER BY media.term_id,
        CASE media.role WHEN 'COVER' THEN 0 ELSE 1 END,
        media.sort_order, media.created_at, media.id`,
      )
      .all() as JsonMap[];
    for (const row of termMediaRows) {
      const termId = text(row.term_id);
      const assetId = text(row.asset_id);
      const term = termsById.get(termId);
      const directoryPath = termDirectories.get(termId);
      const asset = assets.get(assetId);
      if (!term || !directoryPath || !asset) continue;
      const key = termLinkKey(assetId, termId);
      const preferredName = safeAssetFileName(`${term.name}${asset.extension}`, '词条图片', asset.extension);
      desired.set(key, {
        key,
        asset,
        directoryPath,
        preferredName,
        contextType: 'TERM',
        contextId: termId,
        directoryKey: directoryKey('TERM', termId),
        allocationOrder: (text(row.role) === 'COVER' ? 0 : 1_000_000) + Number(row.sort_order),
      });
    }
    for (const entry of desired.values()) this.assertInside(root, entry.directoryPath);
    return desired;
  }

  private reconcileLinks(root: string, desired: Map<string, DesiredLink>, previousLinks: IndexedLink[]) {
    const previousByKey = new Map<string, IndexedLink>();
    for (const entry of previousLinks) {
      const current = previousByKey.get(entry.key);
      if (!current || (entry.preferredName && !current.preferredName)) previousByKey.set(entry.key, entry);
    }

    const safePreviousPaths = new Map<string, { entry: IndexedLink; sourcePath: string }>();
    for (const entry of previousLinks) {
      if (entry.state === 'RETIRED') continue;
      const sourcePath = this.sourcePathForRecord(root, entry);
      if (!sourcePath) continue;
      const managedPath = this.absoluteManagedPath(root, entry.relativePath);
      if (sameFile(sourcePath, managedPath)) {
        safePreviousPaths.set(this.absolutePathKey(managedPath), { entry, sourcePath });
      }
    }

    const preservedPaths = new Set<string>();
    for (const [key, entry] of desired) {
      const previous = previousByKey.get(key);
      if (!previous || previous.preferredName !== entry.preferredName) continue;
      const previousPath = this.absoluteManagedPath(root, previous.relativePath);
      const previousName = path.basename(previousPath);
      if (
        this.absolutePathKey(path.dirname(previousPath)) !== this.absolutePathKey(entry.directoryPath) ||
        !isNumberedFileName(previousName, entry.preferredName) ||
        !sameFile(entry.asset.absolutePath, previousPath)
      )
        continue;
      preservedPaths.add(this.absolutePathKey(previousPath));
    }

    for (const [pathKey, previous] of safePreviousPaths) {
      if (preservedPaths.has(pathKey)) continue;
      this.updateLinkState(previous.entry.key, 'PENDING_DELETE');
      try {
        unlinkSync(this.absoluteManagedPath(root, previous.entry.relativePath));
        this.updateLinkState(previous.entry.key, 'RETIRED');
      } catch (error) {
        if (nodeErrorCode(error) === 'ENOENT') {
          this.updateLinkState(previous.entry.key, 'RETIRED');
        } else {
          this.updateLinkState(previous.entry.key, 'ERROR', error);
          throw error;
        }
      }
    }

    const groups = new Map<string, DesiredLink[]>();
    for (const entry of desired.values()) {
      const key = this.absolutePathKey(entry.directoryPath);
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    const nextLinks: IndexedLink[] = [];
    for (const group of groups.values()) {
      const directoryPath = group[0].directoryPath;
      const claimed = new Set(readdirSync(directoryPath).map((name) => collisionKey(name)));
      group.sort((left, right) => {
        const leftPrevious = previousByKey.get(left.key);
        const rightPrevious = previousByKey.get(right.key);
        const leftStable = leftPrevious?.preferredName === left.preferredName ? 0 : 1;
        const rightStable = rightPrevious?.preferredName === right.preferredName ? 0 : 1;
        return (
          leftStable - rightStable ||
          left.allocationOrder - right.allocationOrder ||
          left.asset.assetId.localeCompare(right.asset.assetId)
        );
      });

      for (const entry of group) {
        const previous = previousByKey.get(entry.key);
        let selectedName = '';
        if (previous?.preferredName === entry.preferredName) {
          const previousName = path.basename(this.absoluteManagedPath(root, previous.relativePath));
          const previousPath = path.resolve(directoryPath, previousName);
          if (isNumberedFileName(previousName, entry.preferredName)) {
            if (sameFile(entry.asset.absolutePath, previousPath)) claimed.delete(collisionKey(previousName));
            if (!claimed.has(collisionKey(previousName))) selectedName = previousName;
          }
        }
        if (!selectedName) {
          for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
            const candidate = numberedFileName(entry.preferredName, attempt);
            if (!claimed.has(collisionKey(candidate))) {
              selectedName = candidate;
              break;
            }
          }
        }
        if (!selectedName) throw new Error(`Unable to allocate a filename for asset ${entry.asset.assetId}`);

        let destination = path.resolve(directoryPath, selectedName);
        this.assertInside(root, destination);
        ensureReadOnly(entry.asset.absolutePath);
        if (!existsSync(destination)) {
          this.persistPendingLink(root, entry, destination);
          try {
            linkSync(entry.asset.absolutePath, destination);
            this.updateLinkState(entry.key, 'ACTIVE');
          } catch (error) {
            if (nodeErrorCode(error) !== 'EEXIST' || !sameFile(entry.asset.absolutePath, destination)) {
              const code = nodeErrorCode(error);
              if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP') {
                this.updateLinkState(entry.key, 'ERROR', error);
                throw new Error('This library location does not support the hard links required by managed folders', {
                  cause: error,
                });
              }
              this.updateLinkState(entry.key, 'ERROR', error);
              throw error;
            }
            this.updateLinkState(entry.key, 'ACTIVE');
          }
        } else if (!sameFile(entry.asset.absolutePath, destination)) {
          // A concurrent external write claimed the planned path. Re-run the
          // allocator with that name reserved instead of replacing it.
          claimed.add(collisionKey(selectedName));
          selectedName = '';
          for (let attempt = 1; attempt <= maximumConflictAttempts; attempt += 1) {
            const candidate = numberedFileName(entry.preferredName, attempt);
            const candidatePath = path.resolve(directoryPath, candidate);
            if (claimed.has(collisionKey(candidate)) || existsSync(candidatePath)) continue;
            this.persistPendingLink(root, entry, candidatePath);
            try {
              linkSync(entry.asset.absolutePath, candidatePath);
              this.updateLinkState(entry.key, 'ACTIVE');
            } catch (error) {
              this.updateLinkState(entry.key, 'ERROR', error);
              throw error;
            }
            selectedName = candidate;
            destination = candidatePath;
            break;
          }
          if (!selectedName) throw new Error(`Unable to allocate a filename for asset ${entry.asset.assetId}`);
        }
        claimed.add(collisionKey(selectedName));
        nextLinks.push({
          key: entry.key,
          contextType: entry.contextType,
          contextId: entry.contextId,
          directoryKey: entry.directoryKey,
          state: 'ACTIVE',
          assetId: entry.asset.assetId,
          relativePath: this.relativeManagedPath(root, destination),
          sourceRelativePath: this.relativeSafePath(root, entry.asset.absolutePath),
          sourceObjectHash: entry.asset.objectHash,
          preferredName: entry.preferredName,
        });
      }
    }
    return nextLinks;
  }

  private removeEmptyManagedDirectories(
    root: string,
    previousDirectories: IndexedDirectory[],
    currentDirectories: IndexedDirectory[],
  ) {
    const desired = new Set(
      currentDirectories.map((entry) => this.absolutePathKey(this.absoluteManagedPath(root, entry.relativePath))),
    );
    const candidates = [
      ...new Set(
        previousDirectories
          .filter((entry) => entry.state !== 'RETIRED')
          .map((entry) => this.absoluteManagedPath(root, entry.relativePath)),
      ),
    ].sort((left, right) => right.split(path.sep).length - left.split(path.sep).length);
    for (const candidate of candidates) {
      if (desired.has(this.absolutePathKey(candidate)) || !existsSync(candidate)) continue;
      try {
        const entry = lstatSync(candidate);
        if (!entry.isSymbolicLink() && entry.isDirectory()) rmdirSync(candidate);
      } catch (error) {
        const code = nodeErrorCode(error);
        if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
      }
    }
  }

  private sourcePathForRecord(root: string, entry: IndexedLink) {
    const activeAsset = this.assetFiles.resolve(entry.assetId);
    if (activeAsset) return activeAsset.absolutePath;
    try {
      const sourcePath = path.resolve(root, entry.sourceRelativePath);
      this.assertInside(root, sourcePath);
      return existsSync(sourcePath) && statSync(sourcePath).isFile() ? sourcePath : null;
    } catch {
      return null;
    }
  }

  private preferredAssetName(asset: ResolvedAssetFile) {
    const suggestedStem = path.basename(asset.suggestedName, path.extname(asset.suggestedName));
    const exposesInternalId =
      collisionKey(suggestedStem) === collisionKey(asset.assetId) ||
      collisionKey(suggestedStem) === collisionKey(`image-${asset.assetId}`);
    return safeAssetFileName(
      exposesInternalId ? `图片${asset.extension}` : asset.suggestedName,
      'image',
      asset.extension,
    );
  }

  private ensureExactDirectory(root: string, name: string) {
    const candidate = path.resolve(root, name);
    this.assertInside(root, candidate);
    if (!existsSync(candidate)) {
      try {
        mkdirSync(candidate);
      } catch (error) {
        if (nodeErrorCode(error) !== 'EEXIST') throw error;
      }
    }
    const entry = lstatSync(candidate);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Library view path is unavailable: ${name}`);
    }
    const resolved = realpathSync(candidate);
    this.assertInside(root, resolved);
    return resolved;
  }

  private loadTermDirectoryNodes() {
    const rows = this.db
      .prepare(
        `SELECT term.id,
        COALESCE(NULLIF(TRIM(revision.title), ''), '未命名词条') AS name,
        revision.created_at,
        COALESCE((
          SELECT value.id
          FROM term_facet_assignments assignment
          JOIN facet_values value ON value.id = assignment.facet_value_id
          JOIN facet_definitions definition ON definition.id = value.definition_id
          WHERE assignment.term_revision_id = revision.id
            AND definition.system_role = 'PRIMARY_CLASSIFICATION'
          ORDER BY CASE value.id WHEN placement.domain_facet_value_id THEN 0 ELSE 1 END,
            value.sort_order, value.id
          LIMIT 1
        ), '__uncategorized_domain__') AS domain_id,
        COALESCE((
          SELECT NULLIF(TRIM(value.name_zh), '')
          FROM term_facet_assignments assignment
          JOIN facet_values value ON value.id = assignment.facet_value_id
          JOIN facet_definitions definition ON definition.id = value.definition_id
          WHERE assignment.term_revision_id = revision.id
            AND definition.system_role = 'PRIMARY_CLASSIFICATION'
          ORDER BY CASE value.id WHEN placement.domain_facet_value_id THEN 0 ELSE 1 END,
            value.sort_order, value.id
          LIMIT 1
        ), '未分类') AS domain_name,
        COALESCE((
          SELECT value.id
          FROM term_facet_assignments assignment
          JOIN facet_values value ON value.id = assignment.facet_value_id
          JOIN facet_definitions definition ON definition.id = value.definition_id
          WHERE assignment.term_revision_id = revision.id
            AND definition.system_role = 'SECONDARY_CLASSIFICATION'
          ORDER BY CASE value.id WHEN placement.item_type_facet_value_id THEN 0 ELSE 1 END,
            value.sort_order, value.id
          LIMIT 1
        ), '') AS type_id,
        COALESCE((
          SELECT NULLIF(TRIM(value.name_zh), '')
          FROM term_facet_assignments assignment
          JOIN facet_values value ON value.id = assignment.facet_value_id
          JOIN facet_definitions definition ON definition.id = value.definition_id
          WHERE assignment.term_revision_id = revision.id
            AND definition.system_role = 'SECONDARY_CLASSIFICATION'
          ORDER BY CASE value.id WHEN placement.item_type_facet_value_id THEN 0 ELSE 1 END,
            value.sort_order, value.id
          LIMIT 1
        ), '未分类') AS type_name
      FROM terms term
      JOIN term_revisions revision ON revision.id = term.current_revision_id
      LEFT JOIN term_directory_placements placement ON placement.term_id = term.id
      WHERE term.archived_at IS NULL
        AND EXISTS (
        SELECT 1 FROM term_media_links media
        JOIN image_assets asset ON asset.id = media.image_asset_id AND asset.deleted_at IS NULL
        WHERE media.term_id = term.id AND media.deleted_at IS NULL
      )
      ORDER BY revision.created_at, term.id`,
      )
      .all() as JsonMap[];
    return rows.map((row): TermDirectoryNode => ({
      id: text(row.id),
      name: text(row.name),
      domainId: text(row.domain_id),
      domainName: text(row.domain_name),
      typeId: text(row.type_id),
      typeName: text(row.type_name),
      createdAt: text(row.created_at),
    }));
  }

  private loadAlbumTree() {
    const albumRows = this.db
      .prepare(
        `SELECT id, title, created_at FROM albums
      WHERE deleted_at IS NULL ORDER BY created_at, id`,
      )
      .all() as JsonMap[];
    const albums = new Map<string, AlbumNode>(
      albumRows.map((row) => {
        const id = text(row.id);
        return [
          id,
          {
            id,
            title: text(row.title),
            parentId: null,
            createdAt: text(row.created_at),
          },
        ];
      }),
    );

    const parentRows = this.db
      .prepare(
        `SELECT member.album_id, member.target_id
      FROM album_members member
      JOIN albums parent ON parent.id = member.album_id AND parent.deleted_at IS NULL
      JOIN albums child ON child.id = member.target_id AND child.deleted_at IS NULL
      WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
      ORDER BY member.updated_at DESC, member.created_at DESC, member.id DESC`,
      )
      .all() as JsonMap[];
    for (const row of parentRows) {
      const childId = text(row.target_id);
      const child = albums.get(childId);
      if (child && !child.parentId) child.parentId = text(row.album_id);
    }

    this.breakParentCycles(albums);
    return albums;
  }

  private breakParentCycles(albums: Map<string, AlbumNode>) {
    for (const startId of [...albums.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
      const pathIds: string[] = [];
      const position = new Map<string, number>();
      let currentId: string | null = startId;
      while (currentId && albums.has(currentId)) {
        const cycleStart = position.get(currentId);
        if (cycleStart !== undefined) {
          const cycleIds = pathIds.slice(cycleStart).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
          const root = albums.get(cycleIds[0]);
          if (root) root.parentId = null;
          break;
        }
        position.set(currentId, pathIds.length);
        pathIds.push(currentId);
        currentId = albums.get(currentId)?.parentId ?? null;
      }
    }
  }

  private albumDepth(albumId: string, albums: Map<string, AlbumNode>) {
    let depth = 0;
    let currentId = albums.get(albumId)?.parentId ?? null;
    while (currentId) {
      depth += 1;
      currentId = albums.get(currentId)?.parentId ?? null;
    }
    return depth;
  }

  private albumForAlbumContext(assetId: string, requestedAlbumId: string, albums: Map<string, AlbumNode>) {
    if (!albums.has(requestedAlbumId)) return null;
    const directAlbumIds = this.directSourceAlbumIds(assetId);
    if (directAlbumIds.includes(requestedAlbumId)) return requestedAlbumId;

    const descendants = directAlbumIds
      .map((albumId) => ({ albumId, distance: this.distanceFromAncestor(albumId, requestedAlbumId, albums) }))
      .filter((candidate): candidate is { albumId: string; distance: number } => candidate.distance !== null)
      .sort((left, right) => left.distance - right.distance || left.albumId.localeCompare(right.albumId));
    return descendants[0]?.albumId ?? null;
  }

  private albumForCreationContext(assetId: string, seriesId: string, albums: Map<string, AlbumNode>) {
    const matches = this.db
      .prepare(
        `SELECT 1
      FROM prompt_series series
      WHERE series.id = ? AND series.deleted_at IS NULL AND (
        EXISTS (
          SELECT 1 FROM prompt_versions version
          JOIN generation_runs run ON run.prompt_version_id = version.id
          WHERE version.series_id = series.id AND run.status = 'SUCCEEDED'
            AND run.result_asset_id = ?
        ) OR EXISTS (
          SELECT 1 FROM creation_output_imports imported
          WHERE imported.series_id = series.id AND imported.image_asset_id = ?
            AND imported.deleted_at IS NULL
        ) OR EXISTS (
          SELECT 1 FROM prompt_versions version
          JOIN reference_bindings binding ON binding.prompt_version_id = version.id
          WHERE version.series_id = series.id AND binding.image_asset_id = ?
        )
      ) LIMIT 1`,
      )
      .get(seriesId, assetId, assetId, assetId);
    if (!matches) return null;

    const owner = this.db
      .prepare(
        `SELECT member.album_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      WHERE member.target_type = 'SERIES' AND member.target_id = ?
        AND member.deleted_at IS NULL
      ORDER BY member.album_id LIMIT 1`,
      )
      .get(seriesId) as JsonMap | undefined;
    const albumId = owner ? text(owner.album_id) : '';
    return albumId && albums.has(albumId) ? albumId : null;
  }

  private directSourceAlbumIds(assetId: string) {
    const rows = this.db
      .prepare(
        `SELECT member.album_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN materials material ON material.id = member.target_id
        AND material.kind = 'IMAGE' AND material.deleted_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
        AND material.image_asset_id = ?
      UNION
      SELECT member.album_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
      JOIN prompt_versions version ON version.series_id = series.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
        AND run.status = 'SUCCEEDED' AND run.result_asset_id = ?
      UNION
      SELECT member.album_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
      JOIN creation_output_imports imported ON imported.series_id = series.id
        AND imported.deleted_at IS NULL
      WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
        AND imported.image_asset_id = ?
      UNION
      SELECT member.album_id
      FROM album_members member
      JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
      JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
      JOIN prompt_versions version ON version.series_id = series.id
      JOIN reference_bindings binding ON binding.prompt_version_id = version.id
      WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
        AND binding.image_asset_id = ?
      ORDER BY album_id`,
      )
      .all(assetId, assetId, assetId, assetId) as JsonMap[];
    return rows.map((row) => text(row.album_id));
  }

  private distanceFromAncestor(albumId: string, ancestorId: string, albums: Map<string, AlbumNode>): number | null {
    let distance = 0;
    let currentId: string | null = albumId;
    while (currentId) {
      if (currentId === ancestorId) return distance;
      distance += 1;
      currentId = albums.get(currentId)?.parentId ?? null;
    }
    return null;
  }

  private relativeManagedPath(root: string, candidate: string) {
    this.assertInside(root, candidate);
    const relative = path.relative(root, candidate);
    if (!this.isManagedViewPath(root, relative)) throw new Error('Path is outside the managed library folders');
    return relative.split(path.sep).join('/');
  }

  private relativeSafePath(root: string, candidate: string) {
    this.assertInside(root, candidate);
    return path.relative(root, candidate).split(path.sep).join('/');
  }

  private absoluteManagedPath(root: string, relativePath: string) {
    if (!this.isManagedViewPath(root, relativePath)) throw new Error('Invalid managed library path');
    return path.resolve(root, ...relativePath.split(/[\\/]/u));
  }

  private isManagedViewPath(root: string, relativePath: string) {
    if (!this.isSafeRelativePath(root, relativePath)) return false;
    const first = relativePath.split(/[\\/]/u)[0];
    return first === albumsDirectoryName || first === termsDirectoryName;
  }

  private isSafeRelativePath(root: string, relativePath: string) {
    if (!relativePath || path.isAbsolute(relativePath)) return false;
    const candidate = path.resolve(root, ...relativePath.split(/[\\/]/u));
    return candidate !== root && isPathInsideOrEqual(root, candidate);
  }

  private assertProjectionSchemaReady() {
    const rows = this.db
      .prepare(
        `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('file_projection_directories', 'file_projection_links',
          'term_directory_placements')`,
      )
      .all() as JsonMap[];
    const tables = new Set(rows.map((row) => text(row.name)));
    if (
      tables.has('file_projection_directories') &&
      tables.has('file_projection_links') &&
      tables.has('term_directory_placements')
    )
      return;

    // A dev hot reload can replace this repository without reopening the database.
    // Disable the listener so a stale process cannot repeat the same synchronization
    // error after every write; a normal restart validates the baseline before use.
    this.started = false;
    this.synchronizationRequested = false;
    if (this.synchronizationTimer) clearTimeout(this.synchronizationTimer);
    this.synchronizationTimer = null;
    this.storage.setChangeListener(null);
    throw new Error('资料目录结构不是当前 v0.3 baseline，请重启应用');
  }

  private absolutePathKey(value: string) {
    return collisionKey(path.resolve(value));
  }

  private assertInside(root: string, candidate: string) {
    if (!isPathInsideOrEqual(root, candidate)) {
      throw new Error('Library view path escaped the library root');
    }
  }
}
