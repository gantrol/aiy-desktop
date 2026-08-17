import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  statfs,
  unlink,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import { z, type ZodType } from 'zod';
import { DATABASE_SCHEMA_REVISION } from '@/main/database/core/schema';
import {
  archivePathKey,
  LOCAL_SPACE_ARCHIVE_MAGIC,
  LOCAL_SPACE_ARCHIVE_MAX_METADATA_BYTES,
  LOCAL_SPACE_ARCHIVE_RECORD,
  localSpaceArchiveDirectorySchema,
  localSpaceArchiveEndSchema,
  localSpaceArchiveFileSchema,
  localSpaceArchiveHardLinkSchema,
  localSpaceArchiveHeaderSchema,
  resolveArchiveEntryPath,
  type LocalSpaceArchiveHeader,
} from '@/main/libraries/local-space-archive-format';
import type { LocalSpaceArchiveProgress } from '@/main/libraries/local-space-archive-writer';
import { LOCAL_SPACE_MAX_PATH_BYTES } from '@/main/libraries/local-space-copy';
import { verifyLocalSpaceDatabase } from '@/main/libraries/local-space-migration-database';
import { LocalSpaceTransferFailure } from '@/main/libraries/local-space-transfer-error';

const IO_CHUNK_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 3 * 1024 ** 4;
const STAGING_PREFIX = '.aiy-import-';
const manifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    createdAt: z.string().min(1).max(100),
  })
  .passthrough();

function archiveFailure(message: string, cause?: unknown): never {
  throw new LocalSpaceTransferFailure('ARCHIVE_INVALID', message, { cause });
}

function parseArchiveValue<Output>(schema: ZodType<Output>, value: unknown, message: string) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) archiveFailure(message, parsed.error);
  return parsed.data;
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

function safeDirectoryName(name: string) {
  const normalized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
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
  throw new LocalSpaceTransferFailure('DESTINATION_INVALID', 'A unique imported-space folder is unavailable');
}

async function writeFully(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array, length = bytes.byteLength) {
  let offset = 0;
  while (offset < length) {
    const result = await handle.write(bytes, offset, length - offset);
    if (result.bytesWritten <= 0) throw new Error('Imported file write did not make progress');
    offset += result.bytesWritten;
  }
}

class ArchiveReader {
  private position = 0;
  readonly contentHash = createHash('sha256');

  constructor(
    private readonly handle: Awaited<ReturnType<typeof open>>,
    readonly byteSize: number,
  ) {}

  get consumedBytes() {
    return this.position;
  }

  async readExactly(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.position + length > this.byteSize) {
      return archiveFailure('Archive ended unexpectedly');
    }
    const bytes = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const result = await this.handle.read(bytes, offset, length - offset, this.position + offset);
      if (result.bytesRead <= 0) archiveFailure('Archive ended unexpectedly');
      offset += result.bytesRead;
    }
    this.position += length;
    return bytes;
  }

  async readInto(buffer: Buffer, length: number) {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > buffer.byteLength ||
      this.position + length > this.byteSize
    ) {
      return archiveFailure('Archive ended unexpectedly');
    }
    let offset = 0;
    while (offset < length) {
      const result = await this.handle.read(buffer, offset, length - offset, this.position + offset);
      if (result.bytesRead <= 0) archiveFailure('Archive ended unexpectedly');
      offset += result.bytesRead;
    }
    this.position += length;
    return buffer.subarray(0, length);
  }

  async readHeader() {
    const magic = await this.readExactly(LOCAL_SPACE_ARCHIVE_MAGIC.byteLength);
    if (!magic.equals(LOCAL_SPACE_ARCHIVE_MAGIC)) {
      const code = magic.subarray(0, 8).toString('ascii') === 'AIYSPACE' ? 'ARCHIVE_UNSUPPORTED' : 'ARCHIVE_INVALID';
      throw new LocalSpaceTransferFailure(code, 'Space archive format is unsupported');
    }
    const lengthBytes = await this.readExactly(4);
    const length = lengthBytes.readUInt32LE();
    if (!length || length > LOCAL_SPACE_ARCHIVE_MAX_METADATA_BYTES) archiveFailure('Archive header is invalid');
    const metadata = await this.readExactly(length);
    this.contentHash.update(magic).update(lengthBytes).update(metadata);
    return parseArchiveValue(localSpaceArchiveHeaderSchema, parseJson(metadata), 'Archive header is invalid');
  }

  async readRecord() {
    const prefix = await this.readExactly(5);
    const recordType = prefix[0];
    const length = prefix.readUInt32LE(1);
    if (!length || length > LOCAL_SPACE_ARCHIVE_MAX_METADATA_BYTES) archiveFailure('Archive record is invalid');
    const metadata = await this.readExactly(length);
    const packet = Buffer.concat([prefix, metadata]);
    return { recordType, packet, value: parseJson(metadata) };
  }
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    return archiveFailure('Archive metadata is not valid JSON', error);
  }
}

async function assertImportDestination(parentPath: string, forbiddenRoots: readonly string[]) {
  if (containsTrash(parentPath)) {
    throw new LocalSpaceTransferFailure('DESTINATION_INVALID', 'Imported-space destination is invalid');
  }
  let resolvedParent: string;
  try {
    const stats = await lstat(parentPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Destination is not a directory');
    resolvedParent = await realpath(parentPath);
  } catch (error) {
    throw new LocalSpaceTransferFailure('DESTINATION_INVALID', 'Imported-space destination is unavailable', {
      cause: error,
    });
  }
  if (forbiddenRoots.some((root) => isWithin(root, resolvedParent))) {
    throw new LocalSpaceTransferFailure('DESTINATION_INVALID', 'Choose a destination outside application data');
  }
  return resolvedParent;
}

async function supportsHardLinks(stagingRoot: string) {
  const token = randomUUID();
  const source = path.join(stagingRoot, `.aiy-link-probe-${token}`);
  const destination = `${source}.link`;
  try {
    const handle = await open(source, 'wx', 0o600);
    await handle.close();
    await link(source, destination);
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all([unlink(source).catch(() => undefined), unlink(destination).catch(() => undefined)]);
  }
}

async function assertFreeSpace(parent: string, requiredBytes: number) {
  const disk = await statfs(parent, { bigint: true });
  const availableBytes = disk.bavail * disk.bsize;
  const margin = BigInt(Math.max(256 * 1024 * 1024, Math.ceil(requiredBytes * 0.05)));
  if (availableBytes < BigInt(requiredBytes) + margin) {
    throw new LocalSpaceTransferFailure('DESTINATION_NO_SPACE', 'Imported-space destination has insufficient space');
  }
}

async function cleanupStaging(stagingRoot: string, parent: string) {
  const resolved = path.resolve(stagingRoot);
  if (pathKey(path.dirname(resolved)) !== pathKey(parent) || !path.basename(resolved).startsWith(STAGING_PREFIX)) {
    throw new Error('Refusing to clean an unexpected import path');
  }
  try {
    const stats = await lstat(resolved);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Refusing to clean a replaced import path');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await rm(resolved, { recursive: true, force: true });
}

function parentArchivePath(archivePath: string) {
  const index = archivePath.lastIndexOf('/');
  return index < 0 ? '' : archivePath.slice(0, index);
}

function createProgress(header: LocalSpaceArchiveHeader, report: (progress: LocalSpaceArchiveProgress) => void) {
  let processedBytes = 0;
  let processedFiles = 0;
  let lastReportedAt = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReportedAt < 100) return;
    lastReportedAt = now;
    report({
      processedBytes,
      totalBytes: header.totalBytes,
      processedFiles,
      totalFiles: header.totalFiles,
    });
  };
  return {
    bytes(value: number) {
      processedBytes += value;
      if (processedBytes > header.totalBytes) archiveFailure('Archive byte totals do not match');
      emit();
    },
    file() {
      processedFiles += 1;
      if (processedFiles > header.totalFiles) archiveFailure('Archive file totals do not match');
      emit();
    },
    finish() {
      if (processedBytes !== header.totalBytes || processedFiles !== header.totalFiles) {
        archiveFailure('Archive totals do not match');
      }
      emit(true);
    },
  };
}

async function copyFallback(
  sourcePath: string,
  destinationPath: string,
  byteSize: number,
  mode: number,
  mtimeMs: number,
  signal: AbortSignal,
) {
  const source = await open(sourcePath, 'r');
  let destination: Awaited<ReturnType<typeof open>> | null = null;
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  try {
    destination = await open(destinationPath, 'wx', mode);
    let remaining = byteSize;
    while (remaining > 0) {
      signal.throwIfAborted();
      const result = await source.read(buffer, 0, Math.min(buffer.byteLength, remaining));
      if (result.bytesRead <= 0) archiveFailure('Hard-link target is incomplete');
      await writeFully(destination, buffer, result.bytesRead);
      remaining -= result.bytesRead;
    }
  } finally {
    await Promise.all([source.close(), destination?.close() ?? Promise.resolve()]);
  }
  await Promise.all([chmod(destinationPath, mode), utimes(destinationPath, new Date(mtimeMs), new Date(mtimeMs))]);
}

async function validateImportedIdentity(stagingRoot: string, header: LocalSpaceArchiveHeader, signal: AbortSignal) {
  const manifestPath = path.join(stagingRoot, 'library.json');
  let manifestBytes: Buffer;
  try {
    const stats = await lstat(manifestPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 2 * 1024 * 1024) {
      return archiveFailure('Imported local-space manifest is invalid');
    }
    manifestBytes = await readFile(manifestPath);
  } catch (error) {
    return archiveFailure('Imported local-space manifest is unavailable', error);
  }
  const manifest = parseArchiveValue(
    manifestSchema,
    parseJson(manifestBytes),
    'Imported local-space manifest is invalid',
  );
  if (
    manifest.id !== header.space.id ||
    manifest.name !== header.space.name ||
    manifest.createdAt !== header.space.createdAt
  ) {
    archiveFailure('Imported local-space identity does not match its archive');
  }
  const database = await verifyLocalSpaceDatabase(stagingRoot, 'DESTINATION', signal);
  if (database.schemaRevision !== header.databaseSchemaRevision) {
    archiveFailure('Imported database revision does not match its archive');
  }
}

type ArchiveDirectoryEntry = z.infer<typeof localSpaceArchiveDirectorySchema>;

interface ArchiveRestoreState {
  readonly stagingRoot: string;
  readonly header: LocalSpaceArchiveHeader;
  readonly progress: ReturnType<typeof createProgress>;
  readonly seenPaths: Set<string>;
  readonly knownDirectories: Set<string>;
  readonly knownFiles: Map<string, { path: string; byteSize: number }>;
  readonly directoryEntries: ArchiveDirectoryEntry[];
  totalDirectories: number;
  totalFiles: number;
  totalBytes: number;
  expandedBytes: number;
  dataStarted: boolean;
  hasDatabase: boolean;
  hasManifest: boolean;
  totalPathBytes: number;
}

function createRestoreState(
  stagingRoot: string,
  header: LocalSpaceArchiveHeader,
  report: (progress: LocalSpaceArchiveProgress) => void,
): ArchiveRestoreState {
  return {
    stagingRoot,
    header,
    progress: createProgress(header, report),
    seenPaths: new Set<string>(),
    knownDirectories: new Set<string>(['']),
    knownFiles: new Map<string, { path: string; byteSize: number }>(),
    directoryEntries: [],
    totalDirectories: 0,
    totalFiles: 0,
    totalBytes: 0,
    expandedBytes: 0,
    dataStarted: false,
    hasDatabase: false,
    hasManifest: false,
    totalPathBytes: 0,
  };
}

function assertUnusedPath(state: ArchiveRestoreState, archivePath: string, message: string) {
  const key = archivePathKey(archivePath);
  if (state.seenPaths.has(key)) archiveFailure(message);
  const parentKey = archivePathKeyOrRoot(parentArchivePath(archivePath));
  if (!state.knownDirectories.has(parentKey)) archiveFailure(message);
  state.totalPathBytes += Buffer.byteLength(archivePath, 'utf8');
  if (state.totalPathBytes > LOCAL_SPACE_MAX_PATH_BYTES) archiveFailure('Archive path metadata exceeds its limit');
  return key;
}

async function restoreDirectory(state: ArchiveRestoreState, value: unknown) {
  if (state.dataStarted || state.totalDirectories >= state.header.totalDirectories) {
    archiveFailure('Archive directory order is invalid');
  }
  const entry = parseArchiveValue(localSpaceArchiveDirectorySchema, value, 'Archive directory is invalid');
  const key = assertUnusedPath(state, entry.path, 'Archive directory hierarchy is invalid');
  const destination = resolveArchiveEntryPath(state.stagingRoot, entry.path);
  await mkdir(destination, { recursive: false, mode: entry.mode });
  state.seenPaths.add(key);
  state.knownDirectories.add(key);
  state.directoryEntries.push(entry);
  state.totalDirectories += 1;
}

function assertFileTotals(state: ArchiveRestoreState, byteSize: number) {
  if (state.totalFiles >= state.header.totalFiles) archiveFailure('Archive contains too many files');
  if (state.totalBytes + byteSize > state.header.totalBytes) archiveFailure('Archive file layout is invalid');
  if (state.expandedBytes + byteSize > state.header.expandedBytes) archiveFailure('Archive file layout is invalid');
}

function registerRestoredFile(
  state: ArchiveRestoreState,
  entry: { path: string; byteSize: number },
  key: string,
  destination: string,
  storedBytes: number,
) {
  state.seenPaths.add(key);
  state.knownFiles.set(key, { path: destination, byteSize: entry.byteSize });
  state.totalFiles += 1;
  state.totalBytes += storedBytes;
  state.expandedBytes += entry.byteSize;
  state.hasDatabase ||= entry.path === 'library.sqlite3';
  state.hasManifest ||= entry.path === 'library.json';
  state.progress.file();
}

async function restoreFile(
  reader: ArchiveReader,
  state: ArchiveRestoreState,
  value: unknown,
  ioBuffer: Buffer,
  signal: AbortSignal,
) {
  const entry = parseArchiveValue(localSpaceArchiveFileSchema, value, 'Archive file is invalid');
  assertFileTotals(state, entry.byteSize);
  const key = assertUnusedPath(state, entry.path, 'Archive file layout is invalid');
  const destination = resolveArchiveEntryPath(state.stagingRoot, entry.path);
  const destinationHandle = await open(destination, 'wx', entry.mode);
  const fileHash = createHash('sha256');
  try {
    let remaining = entry.byteSize;
    while (remaining > 0) {
      signal.throwIfAborted();
      const chunk = await reader.readInto(ioBuffer, Math.min(ioBuffer.byteLength, remaining));
      await writeFully(destinationHandle, chunk);
      fileHash.update(chunk);
      state.progress.bytes(chunk.byteLength);
      remaining -= chunk.byteLength;
    }
  } finally {
    await destinationHandle.close();
  }
  const expectedDigest = await reader.readExactly(32);
  reader.contentHash.update(expectedDigest);
  if (!fileHash.digest().equals(expectedDigest)) archiveFailure('Archive file checksum does not match');
  await Promise.all([
    chmod(destination, entry.mode),
    utimes(destination, new Date(entry.mtimeMs), new Date(entry.mtimeMs)),
  ]);
  registerRestoredFile(state, entry, key, destination, entry.byteSize);
}

async function restoreHardLink(
  state: ArchiveRestoreState,
  value: unknown,
  hardLinksAvailable: boolean,
  signal: AbortSignal,
) {
  if (state.totalFiles >= state.header.totalFiles) archiveFailure('Archive contains too many files');
  const entry = parseArchiveValue(localSpaceArchiveHardLinkSchema, value, 'Archive hard link is invalid');
  if (state.expandedBytes + entry.byteSize > state.header.expandedBytes) {
    archiveFailure('Archive hard-link layout is invalid');
  }
  const key = assertUnusedPath(state, entry.path, 'Archive hard-link layout is invalid');
  const target = state.knownFiles.get(archivePathKey(entry.target));
  if (!target || target.byteSize !== entry.byteSize) archiveFailure('Archive hard-link layout is invalid');
  const destination = resolveArchiveEntryPath(state.stagingRoot, entry.path);
  if (hardLinksAvailable) await link(target.path, destination);
  else await copyFallback(target.path, destination, entry.byteSize, entry.mode, entry.mtimeMs, signal);
  registerRestoredFile(state, entry, key, destination, 0);
}

function finishArchive(reader: ArchiveReader, state: ArchiveRestoreState, value: unknown, archiveByteSize: number) {
  const end = parseArchiveValue(localSpaceArchiveEndSchema, value, 'Archive footer is invalid');
  const contentSha256 = reader.contentHash.digest('hex');
  if (end.contentSha256 !== contentSha256) archiveFailure('Archive footer does not match its contents');
  if (end.totalDirectories !== state.totalDirectories) archiveFailure('Archive footer does not match its contents');
  if (end.totalFiles !== state.totalFiles) archiveFailure('Archive footer does not match its contents');
  if (end.totalBytes !== state.totalBytes) archiveFailure('Archive footer does not match its contents');
  if (end.expandedBytes !== state.expandedBytes) archiveFailure('Archive footer does not match its contents');
  if (end.totalDirectories !== state.header.totalDirectories)
    archiveFailure('Archive footer does not match its header');
  if (end.totalFiles !== state.header.totalFiles) archiveFailure('Archive footer does not match its header');
  if (end.totalBytes !== state.header.totalBytes) archiveFailure('Archive footer does not match its header');
  if (end.expandedBytes !== state.header.expandedBytes) archiveFailure('Archive footer does not match its header');
  if (reader.consumedBytes !== archiveByteSize) archiveFailure('Archive contains unexpected trailing data');
  state.progress.finish();
}

async function restoreArchiveContents(options: {
  reader: ArchiveReader;
  state: ArchiveRestoreState;
  archiveByteSize: number;
  hardLinksAvailable: boolean;
  signal: AbortSignal;
}) {
  const { reader, state, archiveByteSize, hardLinksAvailable, signal } = options;
  const ioBuffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  while (true) {
    signal.throwIfAborted();
    const record = await reader.readRecord();
    if (record.recordType === LOCAL_SPACE_ARCHIVE_RECORD.END) {
      finishArchive(reader, state, record.value, archiveByteSize);
      return;
    }
    reader.contentHash.update(record.packet);
    if (record.recordType === LOCAL_SPACE_ARCHIVE_RECORD.DIRECTORY) {
      await restoreDirectory(state, record.value);
      continue;
    }
    state.dataStarted = true;
    if (record.recordType === LOCAL_SPACE_ARCHIVE_RECORD.FILE) {
      await restoreFile(reader, state, record.value, ioBuffer, signal);
      continue;
    }
    if (record.recordType === LOCAL_SPACE_ARCHIVE_RECORD.HARD_LINK) {
      await restoreHardLink(state, record.value, hardLinksAvailable, signal);
      continue;
    }
    archiveFailure('Archive record type is unsupported');
  }
}

export async function readLocalSpaceArchive(options: {
  archivePath: string;
  destinationParent: string;
  forbiddenDestinationRoots: readonly string[];
  registeredSpaceIds: ReadonlySet<string>;
  signal: AbortSignal;
  report(progress: LocalSpaceArchiveProgress): void;
  onVerifying(): void;
}) {
  const { archivePath, destinationParent, forbiddenDestinationRoots, registeredSpaceIds, signal, report, onVerifying } =
    options;
  signal.throwIfAborted();
  const archiveStats = await lstat(archivePath);
  if (
    !archiveStats.isFile() ||
    archiveStats.isSymbolicLink() ||
    archiveStats.size <= LOCAL_SPACE_ARCHIVE_MAGIC.byteLength + 4 ||
    archiveStats.size > MAX_ARCHIVE_BYTES ||
    containsTrash(archivePath)
  ) {
    throw new LocalSpaceTransferFailure('SOURCE_INVALID', 'Space archive is invalid');
  }
  const resolvedParent = await assertImportDestination(destinationParent, forbiddenDestinationRoots);
  const archiveHandle = await open(archivePath, 'r');
  const reader = new ArchiveReader(archiveHandle, archiveStats.size);
  let stagingRoot: string | null = null;
  try {
    const header = await reader.readHeader();
    if (header.databaseSchemaRevision > DATABASE_SCHEMA_REVISION) {
      throw new LocalSpaceTransferFailure('ARCHIVE_UNSUPPORTED', 'Space archive requires a newer database version');
    }
    if (registeredSpaceIds.has(header.space.id)) {
      throw new LocalSpaceTransferFailure('SPACE_ID_CONFLICT', 'This local-space identity is already registered');
    }
    stagingRoot = path.join(resolvedParent, `${STAGING_PREFIX}${randomUUID()}`);
    await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
    const hardLinksAvailable = await supportsHardLinks(stagingRoot);
    await assertFreeSpace(resolvedParent, hardLinksAvailable ? header.totalBytes : header.expandedBytes);

    const state = createRestoreState(stagingRoot, header, report);
    await restoreArchiveContents({
      reader,
      state,
      archiveByteSize: archiveStats.size,
      hardLinksAvailable,
      signal,
    });

    if (!state.hasDatabase || !state.hasManifest) archiveFailure('Archive is missing required local-space files');
    for (const directory of [...state.directoryEntries].reverse()) {
      const destination = resolveArchiveEntryPath(stagingRoot, directory.path);
      await utimes(destination, new Date(directory.mtimeMs), new Date(directory.mtimeMs));
    }
    onVerifying();
    await validateImportedIdentity(stagingRoot, header, signal);
    signal.throwIfAborted();
    const finalRoot = await availableDestination(resolvedParent, header.space.name);
    await rename(stagingRoot, finalRoot);
    stagingRoot = null;
    return {
      rootPath: finalRoot,
      header,
      archiveByteSize: archiveStats.size,
      totalBytes: header.totalBytes,
      totalFiles: header.totalFiles,
    };
  } finally {
    await archiveHandle.close();
    if (stagingRoot) {
      await cleanupStaging(stagingRoot, resolvedParent).catch((error) => {
        console.error('[local-space-transfer] failed to clean import staging directory', error);
      });
    }
  }
}

function archivePathKeyOrRoot(value: string) {
  return value ? archivePathKey(value) : '';
}
