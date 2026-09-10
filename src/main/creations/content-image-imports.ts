import { CreatorImageStagingService } from '@/main/creations/creator-image-staging';
import type { LibraryDatabase } from '@/main/database';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import type { AssetDto } from '@/shared/contracts';
import {
  contentImageImportIdSchema,
  contentImageStageSchema,
  type ContentImageStage,
} from '@/shared/contracts/content-image-import';
import { creationDraftDtoSchema } from '@/shared/contracts/creation-draft';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const recordSchema = contentImageStageSchema
  .omit({ item: true })
  .extend({
    schemaVersion: z.literal(1),
    item: contentImageStageSchema.shape.item.omit({ bytes: true }),
    hash: z.string().regex(/^[a-f0-9]{64}$/u),
    asset: creationDraftDtoSchema.shape.referenceAssets.element.optional(),
  })
  .strict();
type Record = z.infer<typeof recordSchema>;

/** Only accepted imports are recoverable. Decode/asset registration can resume on demand after restart. */
export class ContentImageImports {
  private readonly directory: string;
  private readonly staging: CreatorImageStagingService;
  private readonly operations = new Map<string, Promise<unknown>>();
  constructor(database: LibraryDatabase) {
    this.directory = path.join(database.libraryRoot, 'editor-imports');
    this.staging = new CreatorImageStagingService(() => database);
  }
  private file(id: string, extension: string) {
    return path.join(this.directory, contentImageImportIdSchema.parse(id) + extension);
  }
  private async read(id: string): Promise<Record | null> {
    try {
      return recordSchema.parse(JSON.parse(await readFile(this.file(id, '.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  private async write(record: Record) {
    const temporary = this.file(record.importId, '.' + randomUUID() + '.tmp');
    await writeFile(temporary, JSON.stringify(record), { flag: 'wx', flush: true });
    try {
      await rename(temporary, this.file(record.importId, '.json'));
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.operations.get(id) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.operations.set(id, task);
    void task
      .finally(() => {
        if (this.operations.get(id) === task) this.operations.delete(id);
      })
      .catch(() => undefined);
    return task;
  }
  async accepted(id: string) {
    return (await this.read(contentImageImportIdSchema.parse(id))) !== null;
  }
  stage(raw: ContentImageStage) {
    const input = contentImageStageSchema.parse(raw);
    return this.serialize(input.importId, async () => {
      const hash = createHash('sha256').update(input.item.bytes).digest('hex');
      const previous = await this.read(input.importId);
      if (previous) {
        if (previous.hash !== hash || previous.item.mimeType !== input.item.mimeType)
          throw new Error('IMAGE_IMPORT_ID_CONFLICT');
        return;
      }
      await mkdir(this.directory, { recursive: true });
      // A complete payload precedes the receipt, so an acknowledgement never refers to volatile renderer bytes.
      await writeFile(this.file(input.importId, '.bin'), input.item.bytes, { flush: true });
      await this.write({
        schemaVersion: 1,
        importId: input.importId,
        source: input.source,
        item: { name: input.item.name, mimeType: input.item.mimeType },
        hash,
      });
    });
  }
  resolve(rawId: string): Promise<AssetDto> {
    const id = contentImageImportIdSchema.parse(rawId);
    return this.serialize(id, async () => {
      const record = await this.read(id);
      if (!record) throw new Error('IMAGE_IMPORT_NOT_ACCEPTED');
      if (record.asset) return record.asset;
      const bytes = await readBoundedImageFile(this.file(id, '.bin'), undefined, 25 * 1024 * 1024);
      if (createHash('sha256').update(bytes).digest('hex') !== record.hash)
        throw new Error('IMAGE_IMPORT_BYTES_CHANGED');
      const rows = await this.staging.stageItems([{ ...record.item, id, bytes }]);
      const assets = await this.staging.importReferences(
        record.source,
        rows.flatMap((row) => row.item.stageId ?? []),
      );
      const asset = assets[0];
      if (!asset) throw new Error('IMAGE_IMPORT_ASSET_UNAVAILABLE');
      await this.write({ ...record, asset });
      await unlink(this.file(id, '.bin')).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      return asset;
    });
  }
}

const services = new WeakMap<LibraryDatabase, ContentImageImports>();
export function contentImageImports(database: LibraryDatabase) {
  let service = services.get(database);
  if (!service) {
    service = new ContentImageImports(database);
    services.set(database, service);
  }
  return service;
}
