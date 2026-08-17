import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  AssetDto,
  CreatorImageImportItemInput,
  CreatorImageStagePreviewRow,
  CreatorOutputsImportResult,
  CreatorStagedImageImportInput,
  NewExternalCreationImportInput,
  NewExternalCreationImportResult,
} from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import type { StoredCreatorImage } from '@/main/database/creations/creation-import-repository';
import { sha256HexAsync } from '@/main/database/core/storage';
import { imageDimensions } from '@/main/media/image-dimensions';

const maxImageCount = 8;
const maxImageBytes = 25 * 1024 * 1024;
const maxBatchBytes = 100 * 1024 * 1024;
const headerBytes = 4 * 1024 * 1024;
const stageLifetimeMs = 15 * 60 * 1000;

const extensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
} as const;

const mimeTypeByExtension = new Map<string, CreatorImageImportItemInput['mimeType']>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

interface StageRecord {
  filePath: string;
  libraryRoot: string;
  item: Pick<CreatorImageImportItemInput, 'id' | 'name' | 'mimeType' | 'metadata'>;
  hash: string;
  width: number;
  height: number;
  byteSize: number;
  expiry: NodeJS.Timeout;
}

function hasExpectedSignature(bytes: Uint8Array, mimeType: CreatorImageImportItemInput['mimeType']) {
  if (mimeType === 'image/png') {
    return bytes.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  }
  if (mimeType === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.byteLength >= 12 &&
    Buffer.from(bytes.buffer, bytes.byteOffset, 4).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.buffer, bytes.byteOffset + 8, 4).toString('ascii') === 'WEBP'
  );
}

function bufferView(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export class CreatorImageStagingService {
  private readonly records = new Map<string, StageRecord>();
  private readonly directoryPreparations = new Map<string, Promise<string>>();

  constructor(private readonly resolveDatabase: () => LibraryDatabase) {}

  async stageItems(items: CreatorImageImportItemInput[]): Promise<CreatorImageStagePreviewRow[]> {
    this.assertBatch(items.map((item) => item.bytes.byteLength));
    const libraryRoot = this.resolveDatabase().libraryRoot;
    const seenHashes = new Set<string>();
    const rows: CreatorImageStagePreviewRow[] = [];
    try {
      for (const item of items) {
        const bytes = bufferView(item.bytes);
        rows.push(
          await this.stageCandidate({
            libraryRoot,
            item: { id: item.id, name: item.name, mimeType: item.mimeType, metadata: item.metadata },
            byteSize: item.bytes.byteLength,
            header: bytes.subarray(0, headerBytes),
            seenHashes,
            write: async (destination) => {
              const hash = await sha256HexAsync(bytes);
              await writeFile(destination, item.bytes, { flag: 'wx' });
              return hash;
            },
          }),
        );
      }
    } catch (error) {
      await this.discard(rows.flatMap((row) => row.item.stageId ?? []));
      throw error;
    }
    return rows;
  }

  async stageFiles(filePaths: string[]): Promise<CreatorImageStagePreviewRow[]> {
    const entries = await Promise.all(
      filePaths.map(async (filePath) => {
        const fileStat = await stat(filePath);
        const mimeType = mimeTypeByExtension.get(path.extname(filePath).toLowerCase());
        if (!mimeType) throw new Error(`Unsupported image: ${path.basename(filePath)}`);
        return { filePath, fileStat, mimeType };
      }),
    );
    this.assertBatch(entries.map(({ fileStat }) => (fileStat.isFile() ? fileStat.size : 0)));
    const libraryRoot = this.resolveDatabase().libraryRoot;
    const seenHashes = new Set<string>();
    const rows: CreatorImageStagePreviewRow[] = [];
    try {
      for (const { filePath, fileStat, mimeType } of entries) {
        const header = await this.readHeader(filePath, fileStat.size);
        rows.push(
          await this.stageCandidate({
            libraryRoot,
            item: { id: randomUUID(), name: path.basename(filePath), mimeType },
            byteSize: fileStat.size,
            header,
            seenHashes,
            write: async (destination) => {
              const hash = createHash('sha256');
              const digestingStream = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                  hash.update(chunk);
                  callback(null, chunk);
                },
              });
              await pipeline(
                createReadStream(filePath),
                digestingStream,
                createWriteStream(destination, { flags: 'wx' }),
              );
              return hash.digest('hex');
            },
          }),
        );
      }
    } catch (error) {
      await this.discard(rows.flatMap((row) => row.item.stageId ?? []));
      throw error;
    }
    return rows;
  }

  async import(input: CreatorStagedImageImportInput): Promise<CreatorOutputsImportResult> {
    return this.consume(input.stageIds, (database, images) =>
      database.importStoredCreatorOutputs(input.context, images),
    );
  }

  async importReferences(
    source: CreatorStagedImageImportInput['context']['source'],
    stageIds: string[],
  ): Promise<AssetDto[]> {
    return this.consume(stageIds, (database, images) => database.importStoredCreatorReferences(source, images));
  }

  async importNewExternalCreation(
    input: NewExternalCreationImportInput,
    stageIds: string[],
    duplicateCount: number,
  ): Promise<NewExternalCreationImportResult> {
    return this.consume(stageIds, (database, images) =>
      database.importStoredNewExternalCreation(input, images, duplicateCount),
    );
  }

  async consume<T>(
    stageIds: string[],
    operation: (database: LibraryDatabase, images: StoredCreatorImage[]) => T | Promise<T>,
  ): Promise<T> {
    const claim = this.claim(stageIds);
    try {
      const images = await this.materialize(claim.database, claim.records);
      return await operation(claim.database, images);
    } finally {
      await this.cleanupClaimed(claim.records);
    }
  }

  private claim(stageIdsInput: string[]) {
    const stageIds = [...new Set(stageIdsInput)];
    if (!stageIds.length || stageIds.length !== stageIdsInput.length || stageIds.length > maxImageCount) {
      throw new Error('Staged image selection is invalid');
    }
    const database = this.resolveDatabase();
    const libraryRoot = path.resolve(database.libraryRoot);
    const records = stageIds.map((stageId) => {
      const record = this.records.get(stageId);
      if (!record || path.resolve(record.libraryRoot) !== libraryRoot) {
        throw new Error('Staged image is unavailable for the active local space');
      }
      return record;
    });
    this.assertBatch(records.map((record) => record.byteSize));

    // Claim every record before the first await. A competing import or discard
    // can therefore win or lose atomically, but can never reuse the same stage.
    for (const [index, stageId] of stageIds.entries()) {
      this.records.delete(stageId);
      clearTimeout(records[index].expiry);
    }
    return { database, records };
  }

  private async materialize(database: LibraryDatabase, records: StageRecord[]) {
    const images: StoredCreatorImage[] = [];
    for (const record of records) {
      const stored = await database.storeVerifiedCreatorImportFile(
        record.filePath,
        extensionByMimeType[record.item.mimeType],
        {
          hash: record.hash,
          width: record.width,
          height: record.height,
          byteSize: record.byteSize,
        },
      );
      images.push({ item: record.item, stored });
    }
    return images;
  }

  async discard(stageIds: readonly string[]) {
    await Promise.all(
      [...new Set(stageIds)].map(async (stageId) => {
        const record = this.records.get(stageId);
        if (!record) return;
        this.records.delete(stageId);
        clearTimeout(record.expiry);
        try {
          await unlink(record.filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }),
    );
  }

  private async cleanupClaimed(records: readonly StageRecord[]) {
    const results = await Promise.allSettled(records.map((record) => unlink(record.filePath)));
    for (const result of results) {
      if (result.status === 'rejected' && (result.reason as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[creator-image-staging] failed to remove consumed stage file', result.reason);
      }
    }
  }

  private assertBatch(byteSizes: number[]) {
    if (!byteSizes.length || byteSizes.length > maxImageCount) {
      throw new Error(`Import supports 1 to ${maxImageCount} images`);
    }
    if (byteSizes.some((size) => !Number.isSafeInteger(size) || size <= 0 || size > maxImageBytes)) {
      throw new Error('Each image must be 25 MB or smaller');
    }
    if (byteSizes.reduce((total, size) => total + size, 0) > maxBatchBytes) {
      throw new Error('Import must be 100 MB or smaller');
    }
  }

  private async readHeader(filePath: string, byteSize: number) {
    const file = await open(filePath, 'r');
    try {
      const header = Buffer.allocUnsafe(Math.min(byteSize, headerBytes));
      const { bytesRead } = await file.read(header, 0, header.byteLength, 0);
      return header.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  }

  private async stageCandidate(input: {
    libraryRoot: string;
    item: Pick<CreatorImageImportItemInput, 'id' | 'name' | 'mimeType' | 'metadata'>;
    byteSize: number;
    header: Buffer;
    seenHashes: Set<string>;
    write(destination: string): Promise<string>;
  }): Promise<CreatorImageStagePreviewRow> {
    if (!hasExpectedSignature(input.header, input.item.mimeType)) {
      return {
        item: { ...input.item, stageId: null, byteSize: input.byteSize },
        state: 'INVALID',
      };
    }
    const stageId = randomUUID();
    const directory = await this.prepareDirectory(input.libraryRoot);
    const filePath = path.join(directory, `${stageId}${extensionByMimeType[input.item.mimeType]}`);
    let hash: string;
    try {
      hash = await input.write(filePath);
    } catch (error) {
      try {
        await unlink(filePath);
      } catch {
        // The staging write may have failed before creating the destination.
      }
      throw error;
    }
    if (input.seenHashes.has(hash)) {
      await unlink(filePath);
      return {
        item: { ...input.item, stageId: null, byteSize: input.byteSize },
        state: 'DUPLICATE',
      };
    }
    input.seenHashes.add(hash);
    const extension = extensionByMimeType[input.item.mimeType];
    const dimensions = imageDimensions(input.header, extension);
    const expiry = setTimeout(() => {
      void this.discard([stageId]);
    }, stageLifetimeMs);
    expiry.unref();
    this.records.set(stageId, {
      filePath,
      libraryRoot: input.libraryRoot,
      item: input.item,
      hash,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      byteSize: input.byteSize,
      expiry,
    });
    return {
      item: { ...input.item, stageId, byteSize: input.byteSize },
      state: 'READY',
    };
  }

  private prepareDirectory(libraryRoot: string) {
    const resolvedRoot = path.resolve(libraryRoot);
    const existing = this.directoryPreparations.get(resolvedRoot);
    if (existing) return existing;
    const preparation = (async () => {
      const directory = path.join(resolvedRoot, 'temp', 'creator-import');
      await mkdir(directory, { recursive: true });
      const entries = await readdir(directory, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            try {
              await unlink(path.join(directory, entry.name));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }),
      );
      return directory;
    })();
    this.directoryPreparations.set(resolvedRoot, preparation);
    void preparation.catch(() => this.directoryPreparations.delete(resolvedRoot));
    return preparation;
  }
}
