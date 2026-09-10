import { randomUUID } from 'node:crypto';
import { trimTrailingCharacters } from '@/shared/string-boundaries';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, link, lstat, mkdir, realpath, readdir, rename, rm, statfs, utimes } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { LocalSpaceMigrationFailure } from '@/main/libraries/local-space-migration-error';

export const LOCAL_SPACE_MAX_FILES = 250_000;
export const LOCAL_SPACE_MAX_DIRECTORIES = 100_000;
export const LOCAL_SPACE_MAX_UNIQUE_BYTES = 2 * 1024 ** 4;
export const LOCAL_SPACE_MAX_PATH_BYTES = 64 * 1024 * 1024;
const COPY_CONCURRENCY = 2;
const STAGING_PREFIX = '.aiy-migration-';

export interface LocalSpaceDirectoryEntry {
  relativePath: string;
  mode: number;
  atimeMs: number;
  mtimeMs: number;
}

export interface LocalSpaceUniqueFileEntry extends LocalSpaceDirectoryEntry {
  sourcePath: string;
  sourceIdentity: string;
  byteSize: number;
}

export interface LocalSpaceHardLinkEntry extends LocalSpaceDirectoryEntry {
  targetRelativePath: string;
  byteSize: number;
}

export interface LocalSpaceFilePlan {
  directories: LocalSpaceDirectoryEntry[];
  uniqueFiles: LocalSpaceUniqueFileEntry[];
  hardLinks: LocalSpaceHardLinkEntry[];
  totalFiles: number;
  totalBytes: number;
  expandedBytes: number;
}

export interface LocalSpaceCopyProgress {
  copiedBytes: number;
  totalBytes: number;
  copiedFiles: number;
  totalFiles: number;
}

function pathKey(value: string) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function containsTrash(value: string) {
  return path
    .resolve(value)
    .split(path.sep)
    .some((segment) => segment.toLocaleLowerCase('en-US').includes('trash'));
}

function shouldSkip(relativePath: string) {
  const segments = relativePath.split(path.sep);
  if (segments.length === 1 && segments[0].toLocaleLowerCase('en-US') === 'temp') return true;
  const fileName = segments.at(-1)?.toLocaleLowerCase('en-US');
  return fileName === 'library.sqlite3-wal' || fileName === 'library.sqlite3-shm' || fileName === 'lockfile';
}

function numeric(value: bigint, message: string) {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new LocalSpaceMigrationFailure('SOURCE_INVALID', message);
  }
  return converted;
}

export async function planLocalSpaceFiles(
  sourceRoot: string,
  signal: AbortSignal,
  options: { fileSourceOverrides?: ReadonlyMap<string, string> } = {},
): Promise<LocalSpaceFilePlan> {
  const rootStats = await lstat(sourceRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || containsTrash(sourceRoot)) {
    throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The legacy local-space folder is invalid');
  }

  const directories: LocalSpaceDirectoryEntry[] = [];
  const uniqueFiles: LocalSpaceUniqueFileEntry[] = [];
  const hardLinks: LocalSpaceHardLinkEntry[] = [];
  const firstPathByIdentity = new Map<string, string>();
  const pending = [{ sourcePath: sourceRoot, relativePath: '' }];
  let totalBytes = 0;
  let expandedBytes = 0;
  let totalPathBytes = 0;

  while (pending.length) {
    signal.throwIfAborted();
    const current = pending.pop()!;
    const currentStats = await lstat(current.sourcePath, { bigint: true });
    if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) {
      throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The legacy local space changed while it was scanned');
    }
    directories.push({
      relativePath: current.relativePath,
      mode: numeric(currentStats.mode, 'Legacy local-space directory mode is invalid'),
      atimeMs: numeric(currentStats.atimeMs, 'Legacy local-space directory time is invalid'),
      mtimeMs: numeric(currentStats.mtimeMs, 'Legacy local-space directory time is invalid'),
    });
    if (directories.length > LOCAL_SPACE_MAX_DIRECTORIES) {
      throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The legacy local space contains too many folders');
    }
    if (totalPathBytes > LOCAL_SPACE_MAX_PATH_BYTES) {
      throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The local-space path metadata exceeds its limit');
    }

    const entries = (await readdir(current.sourcePath, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      signal.throwIfAborted();
      const relativePath = current.relativePath ? path.join(current.relativePath, entry.name) : entry.name;
      totalPathBytes += Buffer.byteLength(relativePath, 'utf8');
      if (totalPathBytes > LOCAL_SPACE_MAX_PATH_BYTES) {
        throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The local-space path metadata exceeds its limit');
      }
      if (relativePath.split(path.sep).some((segment) => segment.toLocaleLowerCase('en-US').includes('trash'))) {
        throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The local space contains an unsupported path');
      }
      if (shouldSkip(relativePath)) continue;
      const discoveredSourcePath = path.join(current.sourcePath, entry.name);
      if (entry.isSymbolicLink()) {
        throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'Symbolic links are not supported in local spaces');
      }
      if (entry.isDirectory()) {
        pending.push({ sourcePath: discoveredSourcePath, relativePath });
        continue;
      }
      if (!entry.isFile()) {
        throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The legacy local space contains an unsupported entry');
      }

      const sourcePath = options.fileSourceOverrides?.get(relativePath) ?? discoveredSourcePath;
      const stats = await lstat(sourcePath, { bigint: true });
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The legacy local space changed while it was scanned');
      }
      const identity = `${stats.dev}:${stats.ino}`;
      const mode = numeric(stats.mode, 'Legacy local-space file mode is invalid');
      const atimeMs = numeric(stats.atimeMs, 'Legacy local-space file time is invalid');
      const mtimeMs = numeric(stats.mtimeMs, 'Legacy local-space file time is invalid');
      const byteSize = numeric(stats.size, 'Legacy local-space file size is invalid');
      expandedBytes += byteSize;
      const firstRelativePath = stats.nlink > 1n && stats.ino !== 0n ? firstPathByIdentity.get(identity) : undefined;
      if (firstRelativePath) {
        hardLinks.push({ relativePath, targetRelativePath: firstRelativePath, byteSize, mode, atimeMs, mtimeMs });
      } else {
        if (stats.nlink > 1n && stats.ino !== 0n) firstPathByIdentity.set(identity, relativePath);
        uniqueFiles.push({
          relativePath,
          sourcePath,
          sourceIdentity: identity,
          byteSize,
          mode,
          atimeMs,
          mtimeMs,
        });
        totalBytes += byteSize;
      }
      if (
        uniqueFiles.length + hardLinks.length > LOCAL_SPACE_MAX_FILES ||
        totalBytes > LOCAL_SPACE_MAX_UNIQUE_BYTES ||
        expandedBytes > LOCAL_SPACE_MAX_UNIQUE_BYTES
      ) {
        throw new LocalSpaceMigrationFailure('SOURCE_INVALID', 'The legacy local space exceeds migration limits');
      }
    }
  }

  return {
    directories,
    uniqueFiles,
    hardLinks,
    totalFiles: uniqueFiles.length + hardLinks.length,
    totalBytes,
    expandedBytes,
  };
}

function safeDirectoryName(name: string) {
  const normalized = trimTrailingCharacters(name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' '), '. ')
    .trim()
    .slice(0, 100);
  return normalized || 'AIY Space';
}

async function pathExists(candidate: string) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function availableDestination(parent: string, name: string) {
  const baseName = safeDirectoryName(name);
  for (let suffix = 1; suffix <= 1_000; suffix += 1) {
    const candidate = path.join(parent, suffix === 1 ? baseName : `${baseName} ${suffix}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new LocalSpaceMigrationFailure('DESTINATION_INVALID', 'A unique destination folder could not be created');
}

async function assertDestination(
  sourceRoot: string,
  destinationParent: string,
  forbiddenRoots: readonly string[],
  requiredBytes: number,
) {
  if (containsTrash(destinationParent)) {
    throw new LocalSpaceMigrationFailure('DESTINATION_INVALID', 'The selected destination is not supported');
  }
  let resolvedParent: string;
  try {
    const stats = await lstat(destinationParent);
    if (!stats.isDirectory()) throw new Error('Destination is not a directory');
    resolvedParent = await realpath(destinationParent);
  } catch (error) {
    throw new LocalSpaceMigrationFailure('DESTINATION_INVALID', 'The selected destination is unavailable', {
      cause: error,
    });
  }
  if (isWithin(sourceRoot, resolvedParent) || forbiddenRoots.some((root) => isWithin(root, resolvedParent))) {
    throw new LocalSpaceMigrationFailure('DESTINATION_INVALID', 'Choose a destination outside application data');
  }
  const disk = await statfs(resolvedParent, { bigint: true });
  const availableBytes = disk.bavail * disk.bsize;
  const safetyMargin = BigInt(Math.max(256 * 1024 * 1024, Math.ceil(requiredBytes * 0.05)));
  if (availableBytes < BigInt(requiredBytes) + safetyMargin) {
    throw new LocalSpaceMigrationFailure('DESTINATION_NO_SPACE', 'The destination does not have enough free space');
  }
  return resolvedParent;
}

async function copyFile(entry: LocalSpaceUniqueFileEntry, destinationRoot: string, signal: AbortSignal) {
  const destinationPath = path.join(destinationRoot, entry.relativePath);
  const assertSourceStable = async () => {
    const stats = await lstat(entry.sourcePath, { bigint: true });
    const identity = `${stats.dev}:${stats.ino}`;
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      identity !== entry.sourceIdentity ||
      numeric(stats.size, 'Legacy local-space file size is invalid') !== entry.byteSize ||
      numeric(stats.mtimeMs, 'Legacy local-space file time is invalid') !== entry.mtimeMs
    ) {
      throw new LocalSpaceMigrationFailure('SOURCE_IN_USE', 'The older local space changed during migration');
    }
  };
  await assertSourceStable();
  await pipeline(
    createReadStream(entry.sourcePath, { signal }),
    createWriteStream(destinationPath, { flags: 'wx', mode: entry.mode }),
    { signal },
  );
  await assertSourceStable();
  const destinationStats = await lstat(destinationPath);
  if (!destinationStats.isFile() || destinationStats.isSymbolicLink() || destinationStats.size !== entry.byteSize) {
    throw new LocalSpaceMigrationFailure('COPY_FAILED', 'A copied local-space file is incomplete');
  }
  await Promise.all([
    chmod(destinationPath, entry.mode),
    utimes(destinationPath, new Date(entry.atimeMs), new Date(entry.mtimeMs)),
  ]);
}

async function copyUniqueFiles(
  plan: LocalSpaceFilePlan,
  destinationRoot: string,
  signal: AbortSignal,
  update: (file: LocalSpaceUniqueFileEntry) => void,
) {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < plan.uniqueFiles.length) {
      signal.throwIfAborted();
      const entry = plan.uniqueFiles[nextIndex++];
      await copyFile(entry, destinationRoot, signal);
      update(entry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, plan.uniqueFiles.length) }, () => worker()));
}

function progressReporter(plan: LocalSpaceFilePlan, report: (progress: LocalSpaceCopyProgress) => void) {
  let copiedBytes = 0;
  let copiedFiles = 0;
  let lastReportedAt = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReportedAt < 100) return;
    lastReportedAt = now;
    report({ copiedBytes, totalBytes: plan.totalBytes, copiedFiles, totalFiles: plan.totalFiles });
  };
  return {
    file(byteSize: number) {
      copiedBytes += byteSize;
      copiedFiles += 1;
      emit();
    },
    link() {
      copiedFiles += 1;
      emit();
    },
    finish() {
      copiedBytes = plan.totalBytes;
      copiedFiles = plan.totalFiles;
      emit(true);
    },
  };
}

async function cleanupStaging(stagingRoot: string, destinationParent: string) {
  const resolvedStaging = path.resolve(stagingRoot);
  if (
    pathKey(path.dirname(resolvedStaging)) !== pathKey(destinationParent) ||
    !path.basename(resolvedStaging).startsWith(STAGING_PREFIX)
  ) {
    throw new Error('Refusing to clean an unexpected migration path');
  }
  try {
    const stats = await lstat(resolvedStaging);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Refusing to clean a replaced migration path');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await rm(resolvedStaging, { recursive: true, force: true });
}

export async function copyLocalSpace(options: {
  sourceRoot: string;
  spaceName: string;
  destinationParent: string;
  forbiddenDestinationRoots: readonly string[];
  signal: AbortSignal;
  report(progress: LocalSpaceCopyProgress): void;
  verify(stagingRoot: string): Promise<void>;
}) {
  const { sourceRoot, spaceName, destinationParent, forbiddenDestinationRoots, signal, report, verify } = options;
  signal.throwIfAborted();
  const plan = await planLocalSpaceFiles(sourceRoot, signal);
  const resolvedParent = await assertDestination(
    sourceRoot,
    destinationParent,
    forbiddenDestinationRoots,
    plan.totalBytes,
  );
  const finalRoot = await availableDestination(resolvedParent, spaceName);
  const stagingRoot = path.join(resolvedParent, `${STAGING_PREFIX}${randomUUID()}`);
  const progress = progressReporter(plan, report);

  await mkdir(stagingRoot, { recursive: false });
  try {
    for (const directory of plan.directories.filter((item) => item.relativePath)) {
      signal.throwIfAborted();
      await mkdir(path.join(stagingRoot, directory.relativePath), { recursive: false, mode: directory.mode });
    }
    await copyUniqueFiles(plan, stagingRoot, signal, (entry) => progress.file(entry.byteSize));
    for (const entry of plan.hardLinks) {
      signal.throwIfAborted();
      await link(path.join(stagingRoot, entry.targetRelativePath), path.join(stagingRoot, entry.relativePath));
      progress.link();
    }
    for (const directory of [...plan.directories].reverse()) {
      const target = directory.relativePath ? path.join(stagingRoot, directory.relativePath) : stagingRoot;
      await utimes(target, new Date(directory.atimeMs), new Date(directory.mtimeMs));
    }
    progress.finish();
    await verify(stagingRoot);
    signal.throwIfAborted();
    await rename(stagingRoot, finalRoot);
    return { rootPath: finalRoot, totalBytes: plan.totalBytes, totalFiles: plan.totalFiles };
  } catch (error) {
    await cleanupStaging(stagingRoot, resolvedParent).catch((cleanupError) => {
      console.error('[local-space-migration] failed to clean staging directory', cleanupError);
    });
    throw error;
  }
}
