import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  createReadStream,
  lstatSync,
  realpathSync,
  statSync,
  watch,
  type Dirent,
  type FSWatcher,
} from 'node:fs';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  CodexGeneratedImageDto,
  CodexGeneratedImageImportInput,
  CodexGeneratedImageImportResult,
  CodexImageDiscoveryListInput,
  CodexImageDiscoverySnapshotDto,
  CreatorImageImportItemInput,
} from '@/shared/contracts';
import { CreatorImageStagingService } from '@/main/creations/creator-image-staging';
import type { LibraryDatabase } from '@/main/database';
import type {
  CodexDiscoveredImageMimeType,
  CodexImageDiscoveryRecord,
  CodexImageDiscoveryScanSnapshot,
  CodexImageDiscoveryThreadDirectorySnapshot,
  CodexImageScanEntry,
} from '@/main/database/extensions/codex-image-discovery-repository';
import { sha256HexAsync } from '@/main/database/core/storage';
import { CodexThreadTitleIndex } from '@/main/extensions/codex-image-discovery/thread-title-index';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_IMPORT_IMAGES = 8;
const SCAN_BATCH_SIZE = 24;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,199}$/;
const DISCOVERY_ID_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const mimeTypeByExtension: Record<string, CodexDiscoveredImageMimeType | undefined> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

interface ScanResult {
  available: boolean;
  changed: boolean;
  complete: boolean;
  scannedAt: string;
  threadDirectories: string[];
  directorySnapshot: CodexImageDiscoveryThreadDirectorySnapshot[];
}

interface ThreadDirectoryInspection {
  available: boolean;
  complete: boolean;
  threadDirectories: CodexImageDiscoveryThreadDirectorySnapshot[];
}

function sha256File(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function sameDirectorySnapshot(
  left: readonly CodexImageDiscoveryThreadDirectorySnapshot[],
  right: readonly CodexImageDiscoveryThreadDirectorySnapshot[],
) {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return candidate?.threadId === entry.threadId && candidate.modifiedAt === entry.modifiedAt;
    })
  );
}

function sameResolvedPath(left: string, right: string) {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === 'win32' ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
}

export class CodexImageDiscovery extends EventEmitter {
  readonly codexHome: string;
  readonly rootPath: string;
  private readonly threadTitles: CodexThreadTitleIndex;
  private active = false;
  private scanPromise: Promise<ScanResult> | null = null;
  private scanForcesHash = false;
  private notifyAfterScan = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private rootWatcher: FSWatcher | null = null;
  private rootWatcherPath = '';
  private readonly threadWatchers = new Map<string, FSWatcher>();
  private lastScannedAt = '';
  private cachedScanSnapshot: CodexImageDiscoveryScanSnapshot | null = null;
  private mediaRecordById = new Map<string, CodexImageDiscoveryRecord>();
  private readonly imageStages: CreatorImageStagingService;
  private disposed = false;

  constructor(
    private readonly database: LibraryDatabase,
    codexHome?: string,
  ) {
    super();
    const configuredHome = codexHome ?? process.env.CODEX_HOME?.trim();
    this.codexHome = path.resolve(configuredHome || path.join(os.homedir(), '.codex'));
    this.rootPath = path.join(this.codexHome, 'generated_images');
    this.threadTitles = new CodexThreadTitleIndex(this.codexHome);
    this.imageStages = new CreatorImageStagingService(() => this.database);
  }

  status() {
    try {
      const codexHomeAvailable = statSync(this.codexHome).isDirectory();
      const rootAvailable = codexHomeAvailable && existsSync(this.rootPath) && statSync(this.rootPath).isDirectory();
      return {
        available: codexHomeAvailable,
        message: rootAvailable
          ? `Watching Codex generated images at ${this.rootPath}`
          : `Waiting for Codex generated images at ${this.rootPath}`,
      };
    } catch {
      return {
        available: false,
        message: `Codex generated image directory was not found at ${this.rootPath}`,
      };
    }
  }

  async setActive(active: boolean) {
    if (this.disposed) return;
    if (!active) this.mediaRecordById.clear();
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.stopWatching();
      return;
    }
    const cachedSnapshot = this.restoreCachedScanSnapshot();
    if (cachedSnapshot) {
      this.syncWatchers(cachedSnapshot.threadDirectories.map((entry) => entry.threadId));
    } else {
      this.ensureWatchers();
    }
    const currentSnapshot = await this.inspectThreadDirectories();
    if (this.disposed) return;
    if (
      cachedSnapshot &&
      currentSnapshot.available &&
      currentSnapshot.complete &&
      sameDirectorySnapshot(cachedSnapshot.threadDirectories, currentSnapshot.threadDirectories)
    )
      return;
    await this.refresh(false);
    if (this.disposed) return;
    this.ensureWatchers();
  }

  async list(input: CodexImageDiscoveryListInput): Promise<CodexImageDiscoverySnapshotDto> {
    if (!this.lastScannedAt) this.restoreCachedScanSnapshot();
    const scan = input.refresh || !this.lastScannedAt ? await this.refresh(false, input.refresh === true) : null;
    const available =
      scan?.available ??
      (() => {
        try {
          return statSync(this.rootPath).isDirectory();
        } catch {
          return false;
        }
      })();
    if (!available) {
      this.mediaRecordById.clear();
      return {
        available: false,
        rootPath: this.rootPath,
        scannedAt: scan?.scannedAt ?? this.lastScannedAt,
        filter: input.filter,
        includeUntitled: input.includeUntitled === true,
        page: 1,
        pageSize: input.pageSize,
        pageCount: 0,
        fileCount: 0,
        duplicateCount: 0,
        totalCount: 0,
        filteredCount: 0,
        inLibraryCount: 0,
        unimportedCount: 0,
        untitledThreadCount: 0,
        images: [],
      };
    }
    const listing = this.database.listCodexImageDiscoveries(
      input.page,
      input.pageSize,
      input.filter,
      input.includeUntitled === true,
    );
    this.mediaRecordById = new Map(listing.records.map((record) => [record.id, record]));
    return {
      available: true,
      rootPath: this.rootPath,
      scannedAt: this.lastScannedAt || scan?.scannedAt || new Date().toISOString(),
      filter: listing.filter,
      includeUntitled: listing.includeUntitled,
      page: listing.page,
      pageSize: listing.pageSize,
      pageCount: listing.pageCount,
      fileCount: listing.fileCount,
      duplicateCount: listing.duplicateCount,
      totalCount: listing.totalCount,
      filteredCount: listing.filteredCount,
      inLibraryCount: listing.inLibraryCount,
      unimportedCount: listing.unimportedCount,
      untitledThreadCount: listing.untitledThreadCount,
      images: listing.records.map((record) => this.toDto(record)),
    };
  }

  async importImages(input: CodexGeneratedImageImportInput): Promise<CodexGeneratedImageImportResult> {
    const discoveryIds = [...new Set(input.discoveryIds)];
    if (!discoveryIds.length || discoveryIds.length > MAX_IMPORT_IMAGES) {
      throw new Error(`Select between 1 and ${MAX_IMPORT_IMAGES} Codex images`);
    }
    if (discoveryIds.some((id) => !DISCOVERY_ID_PATTERN.test(id))) {
      throw new Error('Invalid Codex image selection');
    }
    const records = this.database.getCodexImageDiscoveries(discoveryIds);
    if (records.length !== discoveryIds.length) throw new Error('One or more Codex images are no longer available');
    if (records.some((record) => record.inLibrary))
      throw new Error('One or more Codex images already exist in the library');
    const threadId = records[0]!.threadId;
    if (records.some((record) => record.threadId !== threadId)) {
      throw new Error('Import images from one Codex task at a time');
    }

    const items: CreatorImageImportItemInput[] = [];
    const bindings: Array<{ discoveryId: string; contentHash: string }> = [];
    const seenHashes = new Set<string>();
    let totalBytes = 0;
    for (const record of records) {
      const filePath = this.resolveRecordPath(record);
      const fileStat = lstatSync(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink())
        throw new Error(`Codex image is unavailable: ${record.fileName}`);
      if (fileStat.size <= 0 || fileStat.size > MAX_IMAGE_BYTES) {
        throw new Error(`Codex image must be 25 MB or smaller: ${record.fileName}`);
      }
      if (fileStat.size !== record.byteSize || fileStat.mtime.toISOString() !== record.fileModifiedAt) {
        throw new Error(`Codex image changed; refresh and select it again: ${record.fileName}`);
      }
      totalBytes += fileStat.size;
      if (totalBytes > MAX_IMPORT_BYTES) throw new Error('Codex image import must be 100 MB or smaller');
      const bytes = await readFile(filePath);
      const verifiedStat = lstatSync(filePath);
      if (
        !verifiedStat.isFile() ||
        verifiedStat.isSymbolicLink() ||
        verifiedStat.size !== record.byteSize ||
        verifiedStat.mtime.toISOString() !== record.fileModifiedAt
      ) {
        throw new Error(`Codex image changed while it was being read: ${record.fileName}`);
      }
      const contentHash = await sha256HexAsync(bytes);
      if (contentHash !== record.contentHash) {
        throw new Error(`Codex image content changed; refresh and select it again: ${record.fileName}`);
      }
      if (seenHashes.has(contentHash)) throw new Error('The selected Codex images contain duplicate content');
      seenHashes.add(contentHash);
      items.push({
        id: record.id,
        name: record.fileName,
        mimeType: record.mimeType,
        bytes,
      });
      bindings.push({ discoveryId: record.id, contentHash });
    }

    const threadName = records[0]!.threadName.trim() || `Codex ${threadId.slice(0, 8)}`;
    const title = `${threadName.slice(0, 270)} · Codex`;
    const stagedRows = await this.imageStages.stageItems(items);
    const stageIds = stagedRows.flatMap((row) => row.item.stageId ?? []);
    if (stageIds.length !== items.length) {
      await this.imageStages.discard(stageIds);
      throw new Error('One or more Codex images could not be staged');
    }
    const result = await this.imageStages.consume(stageIds, (database, images) =>
      database.importStoredCodexDiscoveredImages(
        {
          intent: 'NEW_EXTERNAL_CREATION',
          sourceKind: 'EXTERNAL_IMPORT',
          albumId: null,
          title: title,
          titleLocale: input.locale,
          prompt: { knowledge: 'UNKNOWN' },
          source: 'UPLOAD',
          sourceUrl: '',
          outputs: [],
        },
        images,
        bindings,
        { threadId, threadName },
      ),
    );
    this.database.scheduleLibraryFileViewSynchronization();
    this.notifyChanged();
    return {
      threadId,
      threadName,
      seriesId: result.seriesId,
      versionId: result.versionId,
      assetIds: result.assetIds,
      importedCount: result.importedOutputs.length,
      duplicateCount: result.duplicateCount,
    };
  }

  resolveMediaPath(discoveryId: string) {
    if (!DISCOVERY_ID_PATTERN.test(discoveryId)) return null;
    const record = this.mediaRecordById.get(discoveryId) ?? this.database.getCodexImageDiscoveries([discoveryId])[0];
    if (!record) return null;
    try {
      const filePath = this.resolveRecordPath(record);
      const fileStat = lstatSync(filePath);
      return fileStat.isFile() && !fileStat.isSymbolicLink() ? filePath : null;
    } catch {
      return null;
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.mediaRecordById.clear();
    this.stopWatching();
    const runningScan = this.scanPromise;
    if (runningScan) await runningScan.catch(() => undefined);
    this.removeAllListeners();
  }

  private restoreCachedScanSnapshot() {
    const snapshot = this.database.getCodexImageDiscoveryScanSnapshot();
    this.cachedScanSnapshot = snapshot && sameResolvedPath(snapshot.rootPath, this.rootPath) ? snapshot : null;
    this.lastScannedAt = this.cachedScanSnapshot?.lastScannedAt ?? '';
    return this.cachedScanSnapshot;
  }

  private async refresh(notify: boolean, forceHash = false): Promise<ScanResult> {
    if (this.disposed) throw new Error('Codex image discovery is closed');
    this.notifyAfterScan ||= notify;
    if (this.scanPromise) {
      const currentForcesHash = this.scanForcesHash;
      const current = await this.scanPromise;
      return forceHash && !currentForcesHash && !this.disposed ? this.refresh(notify, true) : current;
    }
    this.scanForcesHash = forceHash;
    this.scanPromise = this.performScan(forceHash)
      .then((result) => {
        if (result.complete) {
          this.cachedScanSnapshot = {
            rootPath: this.rootPath,
            lastScannedAt: result.scannedAt,
            threadDirectories: result.directorySnapshot,
          };
          this.lastScannedAt = result.scannedAt;
        } else {
          this.lastScannedAt = this.cachedScanSnapshot?.lastScannedAt ?? '';
        }
        if (this.active) this.syncWatchers(result.threadDirectories);
        if (this.notifyAfterScan && result.changed) this.notifyChanged();
        return result;
      })
      .finally(() => {
        this.notifyAfterScan = false;
        this.scanForcesHash = false;
        this.scanPromise = null;
      });
    return this.scanPromise;
  }

  private async performScan(forceHash = false): Promise<ScanResult> {
    this.mediaRecordById.clear();
    const scannedAt = new Date().toISOString();
    let rootEntries: Dirent[];
    try {
      rootEntries = await readdir(this.rootPath, { withFileTypes: true });
    } catch {
      return {
        available: false,
        changed: false,
        complete: false,
        scannedAt,
        threadDirectories: [],
        directorySnapshot: [],
      };
    }
    const hashCache = this.database.getCodexImageDiscoveryHashCache();
    const threadDirectories = rootEntries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && THREAD_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const startingDirectorySnapshot = await this.captureThreadDirectorySnapshot(threadDirectories);
    const threadTitles = await this.threadTitles.resolve(threadDirectories);
    const entries: CodexImageScanEntry[] = [];
    let complete = startingDirectorySnapshot.complete;
    for (const threadId of threadDirectories) {
      const directoryPath = path.join(this.rootPath, threadId);
      let files: Dirent[];
      try {
        files = await readdir(directoryPath, { withFileTypes: true });
      } catch {
        complete = false;
        continue;
      }
      const threadName = threadTitles.get(threadId) || `Codex ${threadId.slice(0, 8)}`;
      const imageFiles = files
        .filter(
          (entry) =>
            entry.isFile() && !entry.isSymbolicLink() && mimeTypeByExtension[path.extname(entry.name).toLowerCase()],
        )
        .sort((left, right) => left.name.localeCompare(right.name));
      for (let offset = 0; offset < imageFiles.length; offset += SCAN_BATCH_SIZE) {
        const imageEntries = await Promise.all(
          imageFiles.slice(offset, offset + SCAN_BATCH_SIZE).map(async (entry): Promise<CodexImageScanEntry | null> => {
            const mimeType = mimeTypeByExtension[path.extname(entry.name).toLowerCase()];
            if (!mimeType) return null;
            const relativePath = `${threadId}/${entry.name}`;
            try {
              const filePath = path.join(directoryPath, entry.name);
              const fileStat = await stat(filePath);
              if (!fileStat.isFile()) {
                complete = false;
                return null;
              }
              const fileModifiedAt = fileStat.mtime.toISOString();
              const cached = hashCache.get(relativePath);
              const cachedHashMatches =
                !forceHash &&
                cached &&
                cached.mimeType === mimeType &&
                cached.byteSize === fileStat.size &&
                cached.fileModifiedAt === fileModifiedAt &&
                SHA256_PATTERN.test(cached.contentHash);
              const contentHash = cachedHashMatches ? cached.contentHash : await sha256File(filePath);
              if (!cachedHashMatches) {
                const verifiedStat = await stat(filePath);
                if (
                  !verifiedStat.isFile() ||
                  verifiedStat.size !== fileStat.size ||
                  verifiedStat.mtime.toISOString() !== fileModifiedAt
                ) {
                  complete = false;
                  return null;
                }
              }
              return {
                id: createHash('sha256').update(relativePath).digest('hex'),
                contentHash,
                threadId,
                threadName,
                relativePath,
                fileName: entry.name,
                mimeType,
                byteSize: fileStat.size,
                fileCreatedAt: fileStat.birthtime.toISOString(),
                fileModifiedAt,
              };
            } catch {
              complete = false;
              return null;
            }
          }),
        );
        entries.push(...imageEntries.filter((entry): entry is CodexImageScanEntry => entry !== null));
      }
    }
    const finalDirectorySnapshot = await this.inspectThreadDirectories();
    if (
      !finalDirectorySnapshot.available ||
      !finalDirectorySnapshot.complete ||
      !sameDirectorySnapshot(startingDirectorySnapshot.threadDirectories, finalDirectorySnapshot.threadDirectories)
    )
      complete = false;
    const directorySnapshot = finalDirectorySnapshot.available
      ? finalDirectorySnapshot.threadDirectories
      : startingDirectorySnapshot.threadDirectories;
    const watchedThreadDirectories = directorySnapshot.map((entry) => entry.threadId);
    const scanId = randomUUID();
    const result = this.database.reconcileCodexImageDiscoveries(scanId, entries, complete, {
      rootPath: this.rootPath,
      lastScannedAt: scannedAt,
      threadDirectories: directorySnapshot,
    });
    return {
      available: true,
      changed: result.changed > 0,
      complete,
      scannedAt,
      threadDirectories: watchedThreadDirectories,
      directorySnapshot,
    };
  }

  private async inspectThreadDirectories(): Promise<ThreadDirectoryInspection> {
    let rootEntries: Dirent[];
    try {
      rootEntries = await readdir(this.rootPath, { withFileTypes: true });
    } catch {
      return { available: false, complete: false, threadDirectories: [] };
    }
    const threadDirectories = rootEntries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && THREAD_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return this.captureThreadDirectorySnapshot(threadDirectories);
  }

  private async captureThreadDirectorySnapshot(
    threadDirectories: readonly string[],
  ): Promise<ThreadDirectoryInspection> {
    const snapshots: CodexImageDiscoveryThreadDirectorySnapshot[] = [];
    let complete = true;
    for (let offset = 0; offset < threadDirectories.length; offset += SCAN_BATCH_SIZE) {
      const batch = await Promise.all(
        threadDirectories
          .slice(offset, offset + SCAN_BATCH_SIZE)
          .map(async (threadId): Promise<CodexImageDiscoveryThreadDirectorySnapshot | null> => {
            try {
              const directoryStat = await lstat(path.join(this.rootPath, threadId));
              if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return null;
              return { threadId, modifiedAt: directoryStat.mtime.toISOString() };
            } catch {
              return null;
            }
          }),
      );
      for (const snapshot of batch) {
        if (snapshot) snapshots.push(snapshot);
        else complete = false;
      }
    }
    snapshots.sort((left, right) => left.threadId.localeCompare(right.threadId));
    return { available: true, complete, threadDirectories: snapshots };
  }

  private toDto(record: CodexImageDiscoveryRecord): CodexGeneratedImageDto {
    return {
      id: record.id,
      sha256: record.contentHash,
      threadId: record.threadId,
      threadName: record.threadName,
      threadTitleAvailable: record.threadName !== `Codex ${record.threadId.slice(0, 8)}`,
      fileName: record.fileName,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      createdAt: record.fileCreatedAt,
      modifiedAt: record.fileModifiedAt,
      mediaUrl: `aiy-media://codex-generated/${encodeURIComponent(record.id)}`,
      importable: SHA256_PATTERN.test(record.contentHash) && record.byteSize > 0 && record.byteSize <= MAX_IMAGE_BYTES,
      imported: record.inLibrary,
      importedSeriesId: record.importedSeriesId,
      importedAssetId: record.libraryAssetId ?? record.importedAssetId,
    };
  }

  private resolveRecordPath(record: CodexImageDiscoveryRecord) {
    const candidate = path.resolve(this.rootPath, ...record.relativePath.split('/'));
    const rootPrefix = `${path.resolve(this.rootPath)}${path.sep}`;
    if (!candidate.startsWith(rootPrefix)) throw new Error('Codex image path escaped the generated image directory');
    const resolvedRoot = realpathSync(this.rootPath);
    const resolvedCandidate = realpathSync(candidate);
    if (!resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error('Codex image path escaped the generated image directory');
    }
    return resolvedCandidate;
  }

  private notifyChanged() {
    this.mediaRecordById.clear();
    this.emit('changed');
  }

  private scheduleRefresh() {
    if (!this.active || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh(true).catch((error) => {
        console.error('[codex-image-discovery] refresh failed', error);
      });
    }, 400);
  }

  private ensureWatchers() {
    const target = existsSync(this.rootPath) ? this.rootPath : this.codexHome;
    if (this.rootWatcher && this.rootWatcherPath === target) return;
    this.rootWatcher?.close();
    this.rootWatcher = null;
    this.rootWatcherPath = '';
    try {
      const watcher = watch(target, { persistent: false }, () => this.scheduleRefresh());
      watcher.on('error', () => {
        watcher.close();
        if (this.rootWatcher === watcher) {
          this.rootWatcher = null;
          this.rootWatcherPath = '';
        }
        this.scheduleRefresh();
      });
      this.rootWatcher = watcher;
      this.rootWatcherPath = target;
    } catch {
      // Manual refresh remains available when the host cannot watch the Codex directory.
    }
  }

  private syncWatchers(threadDirectories: readonly string[]) {
    this.ensureWatchers();
    const desired = new Set(threadDirectories);
    for (const [threadId, watcher] of this.threadWatchers) {
      if (desired.has(threadId)) continue;
      watcher.close();
      this.threadWatchers.delete(threadId);
    }
    for (const threadId of desired) {
      if (this.threadWatchers.has(threadId)) continue;
      try {
        const watcher = watch(path.join(this.rootPath, threadId), { persistent: false }, () => this.scheduleRefresh());
        watcher.on('error', () => {
          watcher.close();
          this.threadWatchers.delete(threadId);
          this.scheduleRefresh();
        });
        this.threadWatchers.set(threadId, watcher);
      } catch {
        // The directory can disappear between scanning and watcher registration.
      }
    }
  }

  private stopWatching() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.rootWatcher?.close();
    this.rootWatcher = null;
    this.rootWatcherPath = '';
    for (const watcher of this.threadWatchers.values()) watcher.close();
    this.threadWatchers.clear();
  }
}
