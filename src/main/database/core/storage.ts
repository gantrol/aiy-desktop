// v13 resolves its bundled N-API binary from the current runtime platform and
// architecture. Keep the package external so packaged macOS and Windows builds
// select their own prebuild instead of embedding a Windows-only entry point.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { now } from '@/main/database/core/values';
import { imageDimensions } from '@/main/media/image-dimensions';

export interface LibraryStorageOptions {
  openMode?: 'create' | 'must-exist';
}

export interface StoredObject {
  hash: string;
  relativePath: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface RecordedLibraryChange {
  entityType: string;
  entityId: string;
  operation: string;
  /** False when the audit event cannot change a managed file-view path. */
  affectsFileView?: boolean;
}

function objectStorePlan(buffer: Buffer, requestedExtension: string) {
  const hash = createHash('sha256').update(buffer).digest('hex');
  const normalizedExtension = requestedExtension.toLowerCase();
  const extension = /^\.[a-z0-9]{1,8}$/.test(normalizedExtension) ? normalizedExtension : '.bin';
  const dimensions = imageDimensions(buffer, extension);
  return {
    extension,
    stored: {
      hash,
      relativePath: path.join('objects', 'sha256', hash.slice(0, 2), `${hash}${extension}`),
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      byteSize: buffer.byteLength,
    } satisfies StoredObject,
  };
}

function bufferView(bytes: Uint8Array) {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Hash in bounded chunks and yield between them. Node's incremental hash work
 * is synchronous, so hashing a full import batch in one update would otherwise
 * monopolize Electron's main event loop even though the eventual write is async.
 */
export async function sha256HexAsync(bytes: Uint8Array) {
  const buffer = bufferView(bytes);
  const hash = createHash('sha256');
  const chunkBytes = 1024 * 1024;
  for (let offset = 0; offset < buffer.byteLength; offset += chunkBytes) {
    hash.update(buffer.subarray(offset, Math.min(buffer.byteLength, offset + chunkBytes)));
    if (offset + chunkBytes < buffer.byteLength) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return hash.digest('hex');
}

async function objectStorePlanAsync(buffer: Buffer, requestedExtension: string) {
  const hash = await sha256HexAsync(buffer);
  const normalizedExtension = requestedExtension.toLowerCase();
  const extension = /^\.[a-z0-9]{1,8}$/.test(normalizedExtension) ? normalizedExtension : '.bin';
  const dimensions = imageDimensions(buffer.subarray(0, 4 * 1024 * 1024), extension);
  return {
    extension,
    stored: {
      hash,
      relativePath: path.join('objects', 'sha256', hash.slice(0, 2), `${hash}${extension}`),
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      byteSize: buffer.byteLength,
    } satisfies StoredObject,
  };
}

export class LibraryStorage {
  readonly db: Database.Database;
  private changeListener: ((change: RecordedLibraryChange) => void) | null = null;
  private changeEventInsert: Database.Statement | null = null;
  private imageAssetRevision = 0;

  constructor(
    dbPath: string,
    readonly libraryRoot: string,
    options: LibraryStorageOptions = {},
  ) {
    const mustExist = options.openMode === 'must-exist';
    if (!mustExist) mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { fileMustExist: mustExist });
    mkdirSync(path.join(libraryRoot, 'objects', 'sha256'), { recursive: true });
    mkdirSync(path.join(libraryRoot, 'temp', 'generation'), { recursive: true });
    // Baseline REFERENCES clauses are hard integrity contracts. Creation briefly
    // disables enforcement only while the complete baseline is installed.
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
  }

  close() {
    this.db.close();
  }

  setChangeListener(listener: ((change: RecordedLibraryChange) => void) | null) {
    this.changeListener = listener;
  }

  getImageAssetRevision() {
    return this.imageAssetRevision;
  }

  copyIntoObjectStore(sourcePath: string): StoredObject {
    const buffer = readFileSync(sourcePath);
    return this.storeBuffer(buffer, path.extname(sourcePath).toLowerCase() || '.bin');
  }

  async copyIntoObjectStoreAsync(sourcePath: string): Promise<StoredObject> {
    const buffer = await readFile(sourcePath);
    return this.storeBufferAsync(buffer, path.extname(sourcePath).toLowerCase() || '.bin');
  }

  storeBuffer(bytes: Uint8Array, requestedExtension: string): StoredObject {
    const buffer = Buffer.from(bytes);
    const plan = objectStorePlan(buffer, requestedExtension);
    const destination = path.join(this.libraryRoot, plan.stored.relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    if (!existsSync(destination)) writeFileSync(destination, buffer);
    return plan.stored;
  }

  /**
   * Same object-store write as `storeBuffer`, but the file I/O yields to the
   * event loop. Import batches move tens of megabytes and must not freeze the
   * main process while they land.
   */
  async storeBufferAsync(bytes: Uint8Array, requestedExtension: string): Promise<StoredObject> {
    const buffer = bufferView(bytes);
    const plan = await objectStorePlanAsync(buffer, requestedExtension);
    const destination = path.join(this.libraryRoot, plan.stored.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await writeFile(destination, buffer, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return plan.stored;
  }

  async storeVerifiedFile(
    sourcePath: string,
    requestedExtension: string,
    metadata: Omit<StoredObject, 'relativePath'>,
  ): Promise<StoredObject> {
    if (!/^[a-f0-9]{64}$/.test(metadata.hash)) throw new Error('Stored object hash is invalid');
    if (!Number.isSafeInteger(metadata.byteSize) || metadata.byteSize <= 0) {
      throw new Error('Stored object size is invalid');
    }
    const source = await stat(sourcePath);
    if (!source.isFile() || source.size !== metadata.byteSize) throw new Error('Staged image changed before import');
    const normalizedExtension = requestedExtension.toLowerCase();
    const extension = /^\.[a-z0-9]{1,8}$/.test(normalizedExtension) ? normalizedExtension : '.bin';
    const relativePath = path.join('objects', 'sha256', metadata.hash.slice(0, 2), `${metadata.hash}${extension}`);
    const destination = path.join(this.libraryRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return { ...metadata, relativePath };
  }

  recordChange(
    entityType: string,
    entityId: string,
    operation: string,
    payload: unknown,
    options?: { affectsFileView?: boolean },
  ) {
    this.changeEventInsert ??= this.db.prepare(
      'INSERT INTO change_events(id, entity_type, entity_id, operation, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.changeEventInsert.run(ulid(), entityType, entityId, operation, JSON.stringify(payload), now());
    if (entityType === 'IMAGE_ASSET') this.imageAssetRevision += 1;
    this.changeListener?.({ entityType, entityId, operation, affectsFileView: options?.affectsFileView });
  }
}
