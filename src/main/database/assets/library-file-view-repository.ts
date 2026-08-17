import { realpathSync } from 'node:fs';
import path from 'node:path';
import type {
  AssetFileRevealContext,
  AssetFileRevealTargetContext,
  AssetFileRevealTargetDto,
} from '@/shared/contracts';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { LibraryFileViewCacheRepository } from '@/main/database/assets/library-file-view-cache-repository';
import {
  type FileViewIndex,
  assetProjectionChangeTypes,
  creationProjectionChangeTypes,
  directProjectionChangeTypes,
  linkKey,
  materialProjectionChangeTypes,
  sameFile,
  synchronizationBatchDelayMs,
  termLinkKey,
} from '@/main/database/assets/library-file-view-values';
import type { RecordedLibraryChange } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';

/**
 * Maintains the human-facing directory projection of the immutable object
 * store. SQLite remains authoritative; this view can always be reconciled.
 * Only indexed hard links are removed, and only while they still point to the
 * expected source object. User-created or replaced files are never overwritten.
 */
export class LibraryFileViewRepository extends LibraryFileViewCacheRepository {
  private started = false;
  private synchronizationTimer: ReturnType<typeof setTimeout> | null = null;
  private synchronizationRequested = false;
  private synchronizationRunning = false;
  private synchronizationPromise: Promise<void> | null = null;
  private backgroundSynchronizer: (() => Promise<void>) | null = null;

  protected override handleUnavailableProjectionSchema() {
    this.started = false;
    this.synchronizationRequested = false;
    if (this.synchronizationTimer) clearTimeout(this.synchronizationTimer);
    this.synchronizationTimer = null;
    super.handleUnavailableProjectionSchema();
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
}
