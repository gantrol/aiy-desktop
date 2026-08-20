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
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { imageDimensions } from '@/main/media/image-dimensions';
import { rasterizeSvgBytesInSandbox } from '@/main/media/svg-rasterization';
import { storeSvgRasterCacheFile } from '@/main/media/svg-raster-cache';

const maxImageCount = 8;
const maxImageBytes = 25 * 1024 * 1024;
const maxBatchBytes = 100 * 1024 * 1024;
const headerBytes = 4 * 1024 * 1024;
const stageLifetimeMs = 15 * 60 * 1000;
const staleFileCleanupConcurrency = 4;

const extensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
} as const;

const mimeTypeByExtension = new Map<string, CreatorImageImportItemInput['mimeType']>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

interface StageRecord {
  filePath: string;
  modelRasterPath: string | null;
  libraryRoot: string;
  item: StagedImageItem;
  hash: string;
  width: number;
  height: number;
  byteSize: number;
  expiry: NodeJS.Timeout;
}

type StagedImageItem = Pick<CreatorImageImportItemInput, 'id' | 'name' | 'metadata'> & {
  mimeType: CreatorImageImportItemInput['mimeType'];
};

async function removeStaleFiles(directory: string, fileNames: readonly string[]) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < fileNames.length) {
      const fileName = fileNames[cursor];
      cursor += 1;
      try {
        await unlink(path.join(directory, fileName));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(staleFileCleanupConcurrency, fileNames.length) }, () => worker()));
}

function hasExpectedSignature(bytes: Uint8Array, mimeType: CreatorImageImportItemInput['mimeType']) {
  if (mimeType === 'image/png') {
    return bytes.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  }
  if (mimeType === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/svg+xml') {
    return imageDimensions(bufferView(bytes), '.svg') !== null;
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
    const svgRasterByteSizes: number[] = [];
    try {
      for (const item of items) {
        const bytes = bufferView(item.bytes);
        const rasterized = item.mimeType === 'image/svg+xml' ? await rasterizeSvgBytesInSandbox(bytes) : null;
        if (rasterized) {
          svgRasterByteSizes.push(rasterized.bytes.byteLength);
          this.assertBatch(svgRasterByteSizes);
        }
        const stagedItem: StagedImageItem = {
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          metadata: item.metadata,
        };
        rows.push(
          await this.stageCandidate({
            libraryRoot,
            item: stagedItem,
            byteSize: bytes.byteLength,
            header: bytes.subarray(0, headerBytes),
            dimensions: rasterized ? { width: rasterized.width, height: rasterized.height } : undefined,
            modelRaster: rasterized?.bytes,
            seenHashes,
            write: async (destination) => {
              const hash = await sha256HexAsync(bytes);
              await writeFile(destination, bytes, { flag: 'wx' });
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
    const svgRasterByteSizes: number[] = [];
    try {
      for (const { filePath, fileStat, mimeType } of entries) {
        if (mimeType === 'image/svg+xml') {
          const bytes = await readBoundedImageFile(filePath);
          const rasterized = await rasterizeSvgBytesInSandbox(bytes);
          svgRasterByteSizes.push(rasterized.bytes.byteLength);
          this.assertBatch(svgRasterByteSizes);
          rows.push(
            await this.stageCandidate({
              libraryRoot,
              item: { id: randomUUID(), name: path.basename(filePath), mimeType },
              byteSize: bytes.byteLength,
              header: bytes.subarray(0, headerBytes),
              dimensions: { width: rasterized.width, height: rasterized.height },
              modelRaster: rasterized.bytes,
              seenHashes,
              write: async (destination) => {
                const hash = await sha256HexAsync(bytes);
                await writeFile(destination, bytes, { flag: 'wx' });
                return hash;
              },
            }),
          );
          continue;
        }
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
    return this.consume(
      input.items.map((item) => item.stageId),
      (database, images) => database.importStoredCreatorOutputs(input.context, images, input.items),
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
      const result = await operation(claim.database, images);
      await this.cleanupClaimed(claim.records);
      return result;
    } catch (error) {
      this.restoreClaim(claim.stageIds, claim.records);
      throw error;
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
    return { database, records, stageIds };
  }

  private restoreClaim(stageIds: readonly string[], records: readonly StageRecord[]) {
    for (const [index, stageId] of stageIds.entries()) {
      const record = records[index];
      const expiry = setTimeout(() => {
        void this.discard([stageId]);
      }, stageLifetimeMs);
      expiry.unref();
      record.expiry = expiry;
      this.records.set(stageId, record);
    }
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
      if (record.modelRasterPath) {
        await storeSvgRasterCacheFile(record.libraryRoot, record.hash, record.modelRasterPath);
      }
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
        const filePaths = record.modelRasterPath ? [record.filePath, record.modelRasterPath] : [record.filePath];
        await Promise.all(
          filePaths.map(async (filePath) => {
            try {
              await unlink(filePath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }),
        );
      }),
    );
  }

  private async cleanupClaimed(records: readonly StageRecord[]) {
    const filePaths = records.flatMap((record) =>
      record.modelRasterPath ? [record.filePath, record.modelRasterPath] : [record.filePath],
    );
    const results = await Promise.allSettled(filePaths.map((filePath) => unlink(filePath)));
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
    item: StagedImageItem;
    byteSize: number;
    header: Buffer;
    dimensions?: { width: number; height: number };
    modelRaster?: Buffer;
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
    const duplicateStage = [...this.records.values()].some(
      (record) => path.resolve(record.libraryRoot) === path.resolve(input.libraryRoot) && record.hash === hash,
    );
    if (input.seenHashes.has(hash) || duplicateStage) {
      await unlink(filePath);
      return {
        item: { ...input.item, stageId: null, byteSize: input.byteSize },
        state: 'DUPLICATE',
      };
    }
    const modelRasterPath = input.modelRaster ? path.join(directory, `${stageId}.model.png`) : null;
    if (input.modelRaster && modelRasterPath) {
      try {
        await writeFile(modelRasterPath, input.modelRaster, { flag: 'wx' });
      } catch (error) {
        await unlink(filePath);
        try {
          await unlink(modelRasterPath);
        } catch {
          // The derivative write may have failed before creating the destination.
        }
        throw error;
      }
    }
    input.seenHashes.add(hash);
    const extension = extensionByMimeType[input.item.mimeType];
    const dimensions = input.dimensions ?? imageDimensions(input.header, extension);
    const expiry = setTimeout(() => {
      void this.discard([stageId]);
    }, stageLifetimeMs);
    expiry.unref();
    this.records.set(stageId, {
      filePath,
      modelRasterPath,
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
      await removeStaleFiles(
        directory,
        entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      );
      return directory;
    })();
    this.directoryPreparations.set(resolvedRoot, preparation);
    void preparation.catch(() => this.directoryPreparations.delete(resolvedRoot));
    return preparation;
  }
}
