import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  archiveRelativePath,
  boundedMetadata,
  LOCAL_SPACE_ARCHIVE_MAGIC,
  LOCAL_SPACE_ARCHIVE_RECORD,
  localSpaceArchiveDirectorySchema,
  localSpaceArchiveEndSchema,
  localSpaceArchiveFileSchema,
  localSpaceArchiveHardLinkSchema,
  localSpaceArchiveHeaderSchema,
  type LocalSpaceArchiveHeader,
} from '@/main/libraries/local-space-archive-format';
import {
  planLocalSpaceFiles,
  type LocalSpaceFilePlan,
  type LocalSpaceUniqueFileEntry,
} from '@/main/libraries/local-space-copy';
import { LocalSpaceMigrationFailure } from '@/main/libraries/local-space-migration-error';
import { LocalSpaceTransferFailure } from '@/main/libraries/local-space-transfer-error';

const IO_CHUNK_BYTES = 1024 * 1024;

export interface LocalSpaceArchiveProgress {
  processedBytes: number;
  totalBytes: number;
  processedFiles: number;
  totalFiles: number;
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

async function writeFully(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten <= 0) throw new Error('Archive write did not make progress');
    offset += result.bytesWritten;
  }
}

function metadataPacket(recordType: number, metadata: unknown) {
  const metadataBytes = boundedMetadata(metadata);
  const packet = Buffer.allocUnsafe(5 + metadataBytes.byteLength);
  packet[0] = recordType;
  packet.writeUInt32LE(metadataBytes.byteLength, 1);
  metadataBytes.copy(packet, 5);
  return packet;
}

async function assertSourceStable(entry: LocalSpaceUniqueFileEntry) {
  const stats = await lstat(entry.sourcePath, { bigint: true });
  const identity = `${stats.dev}:${stats.ino}`;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    identity !== entry.sourceIdentity ||
    Number(stats.size) !== entry.byteSize ||
    Number(stats.mtimeMs) !== entry.mtimeMs
  ) {
    throw new LocalSpaceTransferFailure('SOURCE_IN_USE', 'The local space changed during export');
  }
}

function createProgress(plan: LocalSpaceFilePlan, report: (progress: LocalSpaceArchiveProgress) => void) {
  let processedBytes = 0;
  let processedFiles = 0;
  let lastReportedAt = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReportedAt < 100) return;
    lastReportedAt = now;
    report({
      processedBytes,
      totalBytes: plan.totalBytes,
      processedFiles,
      totalFiles: plan.totalFiles,
    });
  };
  return {
    bytes(value: number) {
      processedBytes += value;
      emit();
    },
    file() {
      processedFiles += 1;
      emit();
    },
    finish() {
      processedBytes = plan.totalBytes;
      processedFiles = plan.totalFiles;
      emit(true);
    },
  };
}

async function assertArchiveDestination(sourceRoot: string, destinationPath: string, requiredBytes: number) {
  if (containsTrash(destinationPath) || isWithin(sourceRoot, destinationPath)) {
    throw new LocalSpaceTransferFailure('DESTINATION_INVALID', 'Archive destination is invalid');
  }
  const parent = path.dirname(path.resolve(destinationPath));
  let resolvedParent: string;
  try {
    const stats = await lstat(parent);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Archive parent is not a directory');
    resolvedParent = await realpath(parent);
  } catch (error) {
    throw new LocalSpaceTransferFailure('DESTINATION_INVALID', 'Archive destination is unavailable', { cause: error });
  }
  const disk = await statfs(resolvedParent, { bigint: true });
  const availableBytes = disk.bavail * disk.bsize;
  const margin = BigInt(Math.max(256 * 1024 * 1024, Math.ceil(requiredBytes * 0.05)));
  if (availableBytes < BigInt(requiredBytes) + margin) {
    throw new LocalSpaceTransferFailure('DESTINATION_NO_SPACE', 'Archive destination does not have enough space');
  }
  try {
    const existing = await lstat(destinationPath);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new LocalSpaceTransferFailure('DESTINATION_INVALID', 'Archive destination is not a regular file');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return resolvedParent;
}

async function publishArchive(temporaryPath: string, destinationPath: string) {
  try {
    await rename(temporaryPath, destinationPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EACCES', 'EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) throw error;
  }

  const displacedPath = `${destinationPath}.${process.pid}.${randomUUID()}.replaced`;
  await rename(destinationPath, displacedPath);
  try {
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rename(displacedPath, destinationPath).catch(() => undefined);
    throw error;
  }
  await unlink(displacedPath).catch(() => undefined);
}

export async function writeLocalSpaceArchive(options: {
  sourceRoot: string;
  databaseSnapshotPath: string;
  destinationPath: string;
  header: Omit<LocalSpaceArchiveHeader, 'totalDirectories' | 'totalFiles' | 'totalBytes' | 'expandedBytes'>;
  signal: AbortSignal;
  report(progress: LocalSpaceArchiveProgress): void;
}) {
  const { sourceRoot, databaseSnapshotPath, destinationPath, signal, report } = options;
  signal.throwIfAborted();
  let plan: LocalSpaceFilePlan;
  try {
    plan = await planLocalSpaceFiles(sourceRoot, signal, {
      fileSourceOverrides: new Map([[path.normalize('library.sqlite3'), databaseSnapshotPath]]),
    });
  } catch (error) {
    if (error instanceof LocalSpaceMigrationFailure) {
      const code = error.code === 'SOURCE_IN_USE' ? 'SOURCE_IN_USE' : 'SOURCE_INVALID';
      throw new LocalSpaceTransferFailure(code, error.message, { cause: error });
    }
    throw error;
  }
  const directories = plan.directories.filter((entry) => entry.relativePath);
  const header = localSpaceArchiveHeaderSchema.parse({
    ...options.header,
    totalDirectories: directories.length,
    totalFiles: plan.totalFiles,
    totalBytes: plan.totalBytes,
    expandedBytes: plan.expandedBytes,
  });
  const estimatedMetadataBytes = (plan.totalFiles + directories.length) * 8_192 + 1024 * 1024;
  const resolvedParent = await assertArchiveDestination(
    sourceRoot,
    destinationPath,
    plan.totalBytes + estimatedMetadataBytes,
  );
  const temporaryPath = path.join(
    resolvedParent,
    `.${path.basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, 'wx', 0o600);
  const contentHash = createHash('sha256');
  const progress = createProgress(plan, report);
  const ioBuffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  let published = false;

  try {
    const headerBytes = boundedMetadata(header);
    const headerLength = Buffer.allocUnsafe(4);
    headerLength.writeUInt32LE(headerBytes.byteLength);
    await writeFully(handle, LOCAL_SPACE_ARCHIVE_MAGIC);
    await writeFully(handle, headerLength);
    await writeFully(handle, headerBytes);
    contentHash.update(LOCAL_SPACE_ARCHIVE_MAGIC).update(headerLength).update(headerBytes);

    for (const directory of directories) {
      signal.throwIfAborted();
      const packet = metadataPacket(
        LOCAL_SPACE_ARCHIVE_RECORD.DIRECTORY,
        localSpaceArchiveDirectorySchema.parse({
          path: archiveRelativePath(directory.relativePath),
          mode: directory.mode & 0o777,
          mtimeMs: directory.mtimeMs,
        }),
      );
      await writeFully(handle, packet);
      contentHash.update(packet);
    }

    for (const entry of plan.uniqueFiles) {
      signal.throwIfAborted();
      await assertSourceStable(entry);
      const packet = metadataPacket(
        LOCAL_SPACE_ARCHIVE_RECORD.FILE,
        localSpaceArchiveFileSchema.parse({
          path: archiveRelativePath(entry.relativePath),
          byteSize: entry.byteSize,
          mode: entry.mode & 0o777,
          mtimeMs: entry.mtimeMs,
        }),
      );
      await writeFully(handle, packet);
      contentHash.update(packet);
      const fileHash = createHash('sha256');
      const source = await open(entry.sourcePath, 'r');
      try {
        let remaining = entry.byteSize;
        while (remaining > 0) {
          signal.throwIfAborted();
          const requested = Math.min(ioBuffer.byteLength, remaining);
          const result = await source.read(ioBuffer, 0, requested);
          if (result.bytesRead <= 0) {
            throw new LocalSpaceTransferFailure('SOURCE_IN_USE', 'A local-space file changed during export');
          }
          const chunk = ioBuffer.subarray(0, result.bytesRead);
          await writeFully(handle, chunk);
          fileHash.update(chunk);
          progress.bytes(result.bytesRead);
          remaining -= result.bytesRead;
        }
      } finally {
        await source.close();
      }
      await assertSourceStable(entry);
      const digest = fileHash.digest();
      await writeFully(handle, digest);
      contentHash.update(digest);
      progress.file();
    }

    for (const entry of plan.hardLinks) {
      signal.throwIfAborted();
      const packet = metadataPacket(
        LOCAL_SPACE_ARCHIVE_RECORD.HARD_LINK,
        localSpaceArchiveHardLinkSchema.parse({
          path: archiveRelativePath(entry.relativePath),
          target: archiveRelativePath(entry.targetRelativePath),
          byteSize: entry.byteSize,
          mode: entry.mode & 0o777,
          mtimeMs: entry.mtimeMs,
        }),
      );
      await writeFully(handle, packet);
      contentHash.update(packet);
      progress.file();
    }

    progress.finish();
    const endPacket = metadataPacket(
      LOCAL_SPACE_ARCHIVE_RECORD.END,
      localSpaceArchiveEndSchema.parse({
        totalDirectories: directories.length,
        totalFiles: plan.totalFiles,
        totalBytes: plan.totalBytes,
        expandedBytes: plan.expandedBytes,
        contentSha256: contentHash.digest('hex'),
      }),
    );
    await writeFully(handle, endPacket);
    await handle.sync();
    await handle.close();
    signal.throwIfAborted();
    await publishArchive(temporaryPath, destinationPath);
    published = true;
    const stats = await lstat(destinationPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new LocalSpaceTransferFailure('WRITE_FAILED', 'Exported archive is unavailable');
    }
    return { byteSize: stats.size, totalFiles: plan.totalFiles, totalBytes: plan.totalBytes };
  } finally {
    await handle.close().catch(() => undefined);
    if (!published) await unlink(temporaryPath).catch(() => undefined);
  }
}
