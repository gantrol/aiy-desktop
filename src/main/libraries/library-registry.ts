import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { PreparedLocalSpaceCover } from '@/main/libraries/local-space-cover';
import type { LocalSpaceDescriptorDto, LocalSpaceRegistryDto } from '@/shared/contracts';

const REGISTRY_VERSION = 1;
const REGISTRY_FILE = 'index.json';
const MANIFEST_FILE = 'library.json';
const DATABASE_FILE = 'library.sqlite3';
const BACKUP_SUFFIX = '.bak';
const COVER_FILE_PATTERN =
  /^space-cover-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;
export interface LibraryDescriptor {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  lastOpenedAt: string;
  /** Historical provenance only; opening a space never resolves or reapplies it. */
  templateKey: string | null;
  coverFileName: string | null;
}

interface RegistryState {
  version: number;
  currentLibraryId: string;
  libraries: LibraryDescriptor[];
}

function cloneRegistryState(state: RegistryState): RegistryState {
  return {
    version: state.version,
    currentLibraryId: state.currentLibraryId,
    libraries: state.libraries.map((library) => ({ ...library })),
  };
}

interface LibraryManifest {
  [key: string]: unknown;
  version: number;
  id: string;
  name: string;
  createdAt: string;
  templateKey: LibraryDescriptor['templateKey'];
  coverFileName: string | null;
}

interface RegistryParseResult {
  state: RegistryState;
  complete: boolean;
}

type RegistryCandidate = { kind: 'ABSENT' } | { kind: 'CORRUPT' } | { kind: 'VALID'; result: RegistryParseResult };

interface ManifestParseResult {
  manifest: Partial<LibraryManifest>;
  complete: boolean;
}

function now() {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readJsonValue(filePath: string): unknown | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function normalizeRoot(rootPath: string) {
  return path.resolve(rootPath);
}

function directoryExists(directoryPath: string) {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function samePath(left: string, right: string) {
  const normalizedLeft = normalizeRoot(left);
  const normalizedRight = normalizeRoot(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function available(descriptor: LibraryDescriptor) {
  return directoryExists(descriptor.rootPath) && existsSync(path.join(descriptor.rootPath, DATABASE_FILE));
}

function normalizeTemplateKey(value: unknown): LibraryDescriptor['templateKey'] {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalized) ? normalized : null;
}

function normalizeCoverFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return COVER_FILE_PATTERN.test(normalized) ? normalized : null;
}

function coverUrl(descriptor: LibraryDescriptor) {
  if (!descriptor.coverFileName) return null;
  return `aiy-media://space-cover/${encodeURIComponent(descriptor.id)}?revision=${encodeURIComponent(descriptor.coverFileName)}`;
}

function parseLibraryDescriptor(value: unknown): LibraryDescriptor | null {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.name) ||
    !nonEmptyString(value.rootPath) ||
    value.rootPath.includes('\0') ||
    !nonEmptyString(value.createdAt) ||
    !nonEmptyString(value.lastOpenedAt)
  ) {
    return null;
  }

  return {
    id: value.id.trim(),
    name: value.name.trim(),
    rootPath: normalizeRoot(value.rootPath),
    createdAt: value.createdAt,
    lastOpenedAt: value.lastOpenedAt,
    templateKey: normalizeTemplateKey(value.templateKey),
    coverFileName: normalizeCoverFileName(value.coverFileName),
  };
}

function parseRegistryValue(value: unknown): RegistryParseResult | null {
  if (!isRecord(value) || value.version !== REGISTRY_VERSION || !Array.isArray(value.libraries)) {
    return null;
  }

  let complete = nonEmptyString(value.currentLibraryId);
  const libraries: LibraryDescriptor[] = [];
  const identities = new Set<string>();
  const roots = new Set<string>();

  for (const candidate of value.libraries) {
    const descriptor = parseLibraryDescriptor(candidate);
    const normalizedRootKey = descriptor
      ? process.platform === 'win32'
        ? descriptor.rootPath.toLowerCase()
        : descriptor.rootPath
      : null;
    if (!descriptor || identities.has(descriptor.id) || (normalizedRootKey !== null && roots.has(normalizedRootKey))) {
      complete = false;
      continue;
    }
    identities.add(descriptor.id);
    roots.add(normalizedRootKey!);
    libraries.push(descriptor);
  }

  if (libraries.length === 0) return null;

  const requestedCurrentId = nonEmptyString(value.currentLibraryId) ? value.currentLibraryId.trim() : '';
  const currentLibraryId = libraries.some((library) => library.id === requestedCurrentId)
    ? requestedCurrentId
    : libraries[0].id;
  if (currentLibraryId !== requestedCurrentId) complete = false;

  return {
    state: {
      version: REGISTRY_VERSION,
      currentLibraryId,
      libraries,
    },
    complete,
  };
}

function readRegistryCandidate(filePath: string): RegistryCandidate {
  if (!existsSync(filePath)) return { kind: 'ABSENT' };
  const parsed = parseRegistryValue(readJsonValue(filePath));
  return parsed ? { kind: 'VALID', result: parsed } : { kind: 'CORRUPT' };
}

function parseManifestValue(value: unknown): ManifestParseResult | null {
  if (!isRecord(value)) return null;
  if (value.version !== undefined && value.version !== 1) return null;
  if (value.id !== undefined && !nonEmptyString(value.id)) return null;
  if (value.name !== undefined && !nonEmptyString(value.name)) return null;
  if (value.createdAt !== undefined && !nonEmptyString(value.createdAt)) return null;
  if (value.templateKey !== undefined && value.templateKey !== null && typeof value.templateKey !== 'string') {
    return null;
  }
  if (
    value.coverFileName !== undefined &&
    value.coverFileName !== null &&
    normalizeCoverFileName(value.coverFileName) === null
  ) {
    return null;
  }
  return {
    manifest: value,
    complete: value.version === 1 && nonEmptyString(value.id) && nonEmptyString(value.name),
  };
}

function readManifestCandidate(filePath: string): ManifestParseResult | null {
  if (!existsSync(filePath)) return null;
  return parseManifestValue(readJsonValue(filePath));
}

function backupPath(filePath: string) {
  return `${filePath}${BACKUP_SUFFIX}`;
}

function preserveCorruptRegistry(filePath: string) {
  const evidencePath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
  renameSync(filePath, evidencePath);
  syncDirectory(path.dirname(filePath));
  return evidencePath;
}

function syncDirectory(directoryPath: string) {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directoryPath, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EACCES', 'EBADF', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function writeSyncedTemporaryFile(filePath: string, contents: string) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, contents, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the write/fsync failure that made this file unusable.
      }
    }
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Cleanup is best-effort; never mask the persistence failure.
      }
    }
    throw error;
  }
  return temporaryPath;
}

function unlinkBestEffort(filePath: string) {
  if (!existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // Never replace the persistence error with a cleanup-only failure.
  }
}

function writeDurableFile(filePath: string, contents: Buffer) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  let descriptor: number | null = null;
  try {
    descriptor = openSync(filePath, 'wx', 0o600);
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    syncDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the write/fsync failure that made this file unusable.
      }
    }
    unlinkBestEffort(filePath);
    throw error;
  }
}

function replaceFileAtomically(temporaryPath: string, filePath: string) {
  try {
    renameSync(temporaryPath, filePath);
  } catch (initialError) {
    const code = (initialError as NodeJS.ErrnoException).code;
    const replaceDenied =
      process.platform === 'win32' && ['EACCES', 'EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code ?? '');
    if (!replaceDenied || !existsSync(filePath) || !existsSync(temporaryPath)) throw initialError;

    // Some Windows filesystems reject rename-over-existing. Keep the old target
    // recoverable until the synced replacement has reached its final name.
    const displacedPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.replaced`,
    );
    renameSync(filePath, displacedPath);
    try {
      renameSync(temporaryPath, filePath);
      syncDirectory(path.dirname(filePath));
    } catch (replacementError) {
      if (!existsSync(filePath) && existsSync(displacedPath)) {
        renameSync(displacedPath, filePath);
        syncDirectory(path.dirname(filePath));
      }
      throw replacementError;
    }
    if (existsSync(displacedPath)) {
      try {
        unlinkSync(displacedPath);
        syncDirectory(path.dirname(filePath));
      } catch {
        // The replacement is already durable; stale recovery-file cleanup is
        // best-effort and must not report a committed state as failed.
      }
    }
    return;
  }
  syncDirectory(path.dirname(filePath));
}

function writeFileAtomicallyWithoutBackup(filePath: string, contents: string) {
  const temporaryPath = writeSyncedTemporaryFile(filePath, contents);
  try {
    replaceFileAtomically(temporaryPath, filePath);
  } finally {
    unlinkBestEffort(temporaryPath);
  }
}

function writeRecoverableJson(filePath: string, contents: string, existingIsValid: (value: unknown) => boolean) {
  if (existsSync(filePath)) {
    const currentText = readFileSync(filePath, 'utf8');
    const currentValue = (() => {
      try {
        return JSON.parse(currentText) as unknown;
      } catch {
        return null;
      }
    })();
    if (currentValue !== null && existingIsValid(currentValue) && currentText === contents) return;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = writeSyncedTemporaryFile(filePath, contents);
  try {
    // Keep the backup at the latest fully serialized state during real writes.
    // Stable reopens can then remain entirely read-only without weakening the
    // fallback used when the primary is later truncated or corrupted.
    writeFileAtomicallyWithoutBackup(backupPath(filePath), contents);
    replaceFileAtomically(temporaryPath, filePath);
  } finally {
    unlinkBestEffort(temporaryPath);
  }
}

export class LibraryRegistry {
  private readonly librariesRoot: string;
  private readonly registryPath: string;
  private state: RegistryState | null = null;
  private readonly pendingDatabaseCreation = new Set<string>();

  constructor(userDataRoot: string) {
    this.librariesRoot = path.join(userDataRoot, 'libraries');
    this.registryPath = path.join(this.librariesRoot, REGISTRY_FILE);
  }

  initialize(defaultName = '我的创作空间'): LibraryDescriptor {
    mkdirSync(this.librariesRoot, { recursive: true });
    const persisted = this.readRegistry();
    this.state = persisted ?? this.createInitialRegistry(defaultName);
    return this.ensureUsableCurrent();
  }

  getCurrent() {
    const state = this.requireState();
    const current = state.libraries.find((library) => library.id === state.currentLibraryId);
    if (!current) throw new Error('Current library is missing from the registry');
    return current;
  }

  get(libraryId: string) {
    const descriptor = this.requireState().libraries.find((library) => library.id === libraryId);
    if (!descriptor) throw new Error('Unknown library');
    return descriptor;
  }

  getCurrentCoverUrl() {
    return coverUrl(this.getCurrent());
  }

  resolveCoverPath(libraryId: string, revision: string | null) {
    const descriptor = this.requireState().libraries.find((library) => library.id === libraryId);
    if (
      !descriptor?.coverFileName ||
      revision !== descriptor.coverFileName ||
      normalizeCoverFileName(revision) !== revision
    ) {
      return null;
    }
    const candidate = path.join(descriptor.rootPath, descriptor.coverFileName);
    try {
      const stats = lstatSync(candidate);
      return stats.isFile() && !stats.isSymbolicLink() ? candidate : null;
    } catch {
      return null;
    }
  }

  private describeSpace(space: LibraryDescriptor): LocalSpaceDescriptorDto {
    return {
      id: space.id,
      name: space.name,
      coverUrl: coverUrl(space),
      isCurrent: space.id === this.requireState().currentLibraryId,
      available: available(space),
      createdAt: space.createdAt,
      lastOpenedAt: space.lastOpenedAt,
    };
  }

  /** Registry diagnostics; desktop clients consume listSpaces(). */
  list() {
    const state = this.requireState();
    return {
      currentLibraryId: state.currentLibraryId,
      libraries: state.libraries.map((library) => ({
        id: library.id,
        name: library.name,
        isCurrent: library.id === state.currentLibraryId,
        available: available(library),
        lastOpenedAt: library.lastOpenedAt,
      })),
    };
  }

  listSpaces(): LocalSpaceRegistryDto {
    const state = this.requireState();
    return {
      currentSpaceId: state.currentLibraryId,
      spaces: state.libraries.map((space) => this.describeSpace(space)),
    };
  }

  registerExisting(rootPath: string) {
    const state = this.requireState();
    const normalizedRoot = normalizeRoot(rootPath);
    if (!existsSync(normalizedRoot) || !statSync(normalizedRoot).isDirectory()) {
      throw new Error('Library folder is unavailable');
    }
    if (!existsSync(path.join(normalizedRoot, DATABASE_FILE))) {
      throw new Error('library.sqlite3 was not found');
    }

    const existing = state.libraries.find((library) => samePath(library.rootPath, normalizedRoot));
    if (existing) return existing;

    const manifestPath = path.join(normalizedRoot, MANIFEST_FILE);
    const manifest = this.readManifest(manifestPath);
    const manifestId = typeof manifest?.id === 'string' && manifest.id.trim() ? manifest.id.trim() : randomUUID();
    const identityConflict = state.libraries.find((library) => library.id === manifestId);
    if (identityConflict) {
      throw new Error('Local space identity is already registered at another path');
    }
    const id = manifestId;
    const timestamp = now();
    const descriptor: LibraryDescriptor = {
      id,
      name:
        typeof manifest?.name === 'string' && manifest.name.trim()
          ? manifest.name.trim()
          : path.basename(normalizedRoot),
      rootPath: normalizedRoot,
      createdAt: typeof manifest?.createdAt === 'string' ? manifest.createdAt : timestamp,
      lastOpenedAt: timestamp,
      templateKey: normalizeTemplateKey(manifest?.templateKey),
      coverFileName: normalizeCoverFileName(manifest?.coverFileName),
    };
    const nextState = cloneRegistryState(state);
    nextState.libraries.push(descriptor);
    this.writeManifest(descriptor);
    this.commitState(nextState);
    return descriptor;
  }

  create(name: string) {
    return this.createLibrary(name, null);
  }

  createSpace(name: string) {
    return this.create(name);
  }

  createCandidate(name: string) {
    return this.createLibrary(name, null, false);
  }

  requiresDatabaseCreation(libraryId: string) {
    return this.pendingDatabaseCreation.has(libraryId);
  }

  markDatabaseCreated(libraryId: string) {
    this.pendingDatabaseCreation.delete(libraryId);
  }

  private createLibrary(name: string, templateKey: LibraryDescriptor['templateKey'], select = true) {
    const state = this.requireState();
    const baseName = name.trim() || '新本地空间';
    const existingNames = new Set(state.libraries.map((library) => library.name));
    let uniqueName = baseName;
    let suffix = 2;
    while (existingNames.has(uniqueName)) uniqueName = `${baseName} ${suffix++}`;
    const timestamp = now();
    const id = randomUUID();
    const descriptor: LibraryDescriptor = {
      id,
      name: uniqueName,
      rootPath: path.join(this.librariesRoot, id),
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      templateKey,
      coverFileName: null,
    };
    const nextState = cloneRegistryState(state);
    nextState.libraries.push(descriptor);
    if (select) nextState.currentLibraryId = descriptor.id;
    mkdirSync(descriptor.rootPath, { recursive: true });
    this.pendingDatabaseCreation.add(descriptor.id);
    this.writeManifest(descriptor);
    this.commitState(nextState);
    return descriptor;
  }

  unregisterCandidate(libraryId: string) {
    const state = this.requireState();
    if (state.currentLibraryId === libraryId) throw new Error('Cannot unregister the current library');
    if (!state.libraries.some((library) => library.id === libraryId)) return;
    const nextState = cloneRegistryState(state);
    nextState.libraries = nextState.libraries.filter((library) => library.id !== libraryId);
    this.pendingDatabaseCreation.delete(libraryId);
    this.commitState(nextState);
  }

  setCurrent(libraryId: string) {
    const state = this.requireState();
    const descriptor = state.libraries.find((library) => library.id === libraryId);
    if (!descriptor) throw new Error('Unknown library');
    if (!available(descriptor)) throw new Error('Library is unavailable');
    const nextState = cloneRegistryState(state);
    const nextDescriptor = nextState.libraries.find((library) => library.id === libraryId)!;
    nextDescriptor.lastOpenedAt = now();
    nextState.currentLibraryId = nextDescriptor.id;
    this.commitState(nextState);
    return nextDescriptor;
  }

  updateCurrentName(name: string) {
    const descriptor = this.getCurrent();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName === descriptor.name) return;
    const nextState = cloneRegistryState(this.requireState());
    const nextDescriptor = nextState.libraries.find((library) => library.id === descriptor.id)!;
    nextDescriptor.name = normalizedName;
    this.writeManifest(nextDescriptor);
    this.commitState(nextState);
  }

  setCover(libraryId: string, cover: PreparedLocalSpaceCover) {
    const descriptor = this.get(libraryId);
    if (!available(descriptor)) throw new Error('Local space is unavailable');
    if (!Buffer.isBuffer(cover.bytes) || cover.bytes.length < 1) throw new Error('Local space cover is empty');
    if (!['.png', '.jpg', '.webp'].includes(cover.extension)) {
      throw new Error('Local space cover format is unsupported');
    }

    const coverFileName = `space-cover-${randomUUID()}${cover.extension}`;
    const coverPath = path.join(descriptor.rootPath, coverFileName);
    writeDurableFile(coverPath, cover.bytes);

    const nextState = cloneRegistryState(this.requireState());
    const nextDescriptor = nextState.libraries.find((library) => library.id === libraryId)!;
    const previousCoverFileName = nextDescriptor.coverFileName;
    nextDescriptor.coverFileName = coverFileName;
    try {
      this.writeManifest(nextDescriptor);
      this.commitState(nextState);
    } catch (error) {
      unlinkBestEffort(coverPath);
      try {
        this.writeManifest(descriptor);
      } catch {
        // The registry remains authoritative; preserve the original failure.
      }
      throw error;
    }

    if (previousCoverFileName) unlinkBestEffort(path.join(descriptor.rootPath, previousCoverFileName));
    return this.describeSpace(nextDescriptor);
  }

  removeCover(libraryId: string) {
    const descriptor = this.get(libraryId);
    if (!descriptor.coverFileName) return this.describeSpace(descriptor);
    if (!available(descriptor)) throw new Error('Local space is unavailable');
    const nextState = cloneRegistryState(this.requireState());
    const nextDescriptor = nextState.libraries.find((library) => library.id === libraryId)!;
    const previousCoverPath = path.join(descriptor.rootPath, descriptor.coverFileName);
    nextDescriptor.coverFileName = null;
    try {
      this.writeManifest(nextDescriptor);
      this.commitState(nextState);
    } catch (error) {
      try {
        this.writeManifest(descriptor);
      } catch {
        // The registry remains authoritative; preserve the original failure.
      }
      throw error;
    }
    unlinkBestEffort(previousCoverPath);
    return this.describeSpace(nextDescriptor);
  }

  private createInitialRegistry(defaultName: string): RegistryState {
    const timestamp = now();
    const id = randomUUID();
    const descriptor: LibraryDescriptor = {
      id,
      name: defaultName,
      rootPath: path.join(this.librariesRoot, id),
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      templateKey: null,
      coverFileName: null,
    };
    mkdirSync(descriptor.rootPath, { recursive: true });
    this.pendingDatabaseCreation.add(descriptor.id);
    this.writeManifest(descriptor);
    const state = { version: REGISTRY_VERSION, currentLibraryId: id, libraries: [descriptor] };
    this.saveState(state);
    return state;
  }

  private readRegistry(): RegistryState | null {
    const primary = readRegistryCandidate(this.registryPath);
    const registryBackupPath = backupPath(this.registryPath);
    const backup = readRegistryCandidate(registryBackupPath);

    if (primary.kind === 'VALID' && primary.result.complete) {
      if (backup.kind === 'CORRUPT') preserveCorruptRegistry(registryBackupPath);
      return primary.result.state;
    }

    if (backup.kind === 'VALID' && backup.result.complete) {
      if (primary.kind === 'CORRUPT') preserveCorruptRegistry(this.registryPath);
      this.saveState(backup.result.state);
      return backup.result.state;
    }

    // A structurally valid top level may contain one interrupted or historical
    // bad entry. Keep the valid identities rather than blocking application boot.
    if (primary.kind === 'VALID') {
      if (backup.kind === 'CORRUPT') preserveCorruptRegistry(registryBackupPath);
      return primary.result.state;
    }
    if (backup.kind === 'VALID') {
      if (primary.kind === 'CORRUPT') preserveCorruptRegistry(this.registryPath);
      return backup.result.state;
    }
    if (primary.kind === 'ABSENT' && backup.kind === 'ABSENT') return null;
    throw new LibraryRegistryRecoveryError(this.registryPath, registryBackupPath);
  }

  private ensureUsableCurrent() {
    const state = this.requireState();
    const current = state.libraries.find((library) => library.id === state.currentLibraryId);
    if (!current) throw new Error('Current library is missing from the registry');
    return current;
  }

  private readManifest(manifestPath: string) {
    const primary = readManifestCandidate(manifestPath);
    if (primary?.complete) return primary.manifest;

    const backup = readManifestCandidate(backupPath(manifestPath));
    if (backup?.complete) return backup.manifest;

    // A partial manifest without an older complete identity is still useful for
    // preserving unknown extension fields on its first successful write.
    return primary?.manifest ?? backup?.manifest ?? {};
  }

  private writeManifest(descriptor: LibraryDescriptor) {
    mkdirSync(descriptor.rootPath, { recursive: true });
    const manifestPath = path.join(descriptor.rootPath, MANIFEST_FILE);
    const previous = this.readManifest(manifestPath);
    const manifest: LibraryManifest = {
      ...previous,
      version: 1,
      id: descriptor.id,
      name: descriptor.name,
      createdAt: descriptor.createdAt,
      templateKey: descriptor.templateKey,
      coverFileName: descriptor.coverFileName,
    };
    writeRecoverableJson(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      (value) => parseManifestValue(value)?.complete === true,
    );
  }

  private save() {
    this.saveState(this.requireState());
  }

  private saveState(state: RegistryState) {
    writeRecoverableJson(
      this.registryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      (value) => parseRegistryValue(value)?.complete === true,
    );
  }

  private commitState(nextState: RegistryState) {
    this.saveState(nextState);
    this.state = nextState;
  }

  private requireState() {
    if (!this.state) throw new Error('Library registry has not been initialized');
    return this.state;
  }
}

export class LibraryRegistryRecoveryError extends Error {
  readonly code = 'LIBRARY_REGISTRY_CORRUPT';

  constructor(
    readonly registryPath: string,
    readonly backupRegistryPath: string,
  ) {
    super('Local space registry is corrupted; no data was changed');
    this.name = 'LibraryRegistryRecoveryError';
  }
}

export const libraryDatabasePath = (descriptor: LibraryDescriptor) => path.join(descriptor.rootPath, DATABASE_FILE);
