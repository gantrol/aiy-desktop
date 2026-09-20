import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  browserCompanionBatchInputSchema,
  browserCompanionBatchDeleteInputSchema,
  browserCompanionBatchResultSchema,
  browserCompanionDestinationSchema,
} from '@/shared/contracts/browser-companion';

const MAX_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_HISTORY = 1_000;
const BATCH_FILE_NAME = /^\d{13}-([0-9a-f-]{36})\.json$/i;
const batchRecordSchema = browserCompanionBatchResultSchema
  .extend({
    schemaVersion: z.literal(1),
    input: browserCompanionBatchInputSchema,
    destinations: z
      .object({
        weibo: browserCompanionDestinationSchema.nullable(),
        wechat: browserCompanionDestinationSchema.nullable(),
        x: browserCompanionDestinationSchema.nullable(),
        xiaohongshu: browserCompanionDestinationSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type BrowserCompanionBatchRecord = z.infer<typeof batchRecordSchema>;

function hasCode(reason: unknown, code: string): boolean {
  return reason instanceof Error && 'code' in reason && reason.code === code;
}

/** Local receipts keep the accepted candidate even when one target cannot be staged. */
export class BrowserCompanionBatchStore {
  constructor(private readonly directory: string) {}

  private file(batchId: string, createdAt: string): string {
    const id = browserCompanionBatchResultSchema.shape.batchId.parse(batchId);
    return path.join(this.directory, `${String(Date.parse(createdAt)).padStart(13, '0')}-${id}.json`);
  }

  private async fileNames(): Promise<string[]> {
    try {
      const names = await readdir(this.directory);
      return names.filter((name) => {
        const match = BATCH_FILE_NAME.exec(name);
        return match && browserCompanionBatchResultSchema.shape.batchId.safeParse(match[1]).success;
      });
    } catch (reason) {
      if (hasCode(reason, 'ENOENT')) return [];
      throw reason;
    }
  }

  async save(record: BrowserCompanionBatchRecord): Promise<void> {
    const parsed = batchRecordSchema.parse(record);
    const bytes = Buffer.from(JSON.stringify(parsed));
    if (bytes.length > MAX_BATCH_BYTES) throw new Error('Browser companion batch is too large');
    await mkdir(this.directory, { recursive: true });
    const destination = this.file(parsed.batchId, parsed.createdAt);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    try {
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async get(batchId: string): Promise<BrowserCompanionBatchRecord | null> {
    browserCompanionBatchResultSchema.shape.batchId.parse(batchId);
    const name = (await this.fileNames()).find((candidate) => candidate.endsWith(`-${batchId}.json`));
    return name ? this.readFile(name) : null;
  }

  private async readFile(name: string): Promise<BrowserCompanionBatchRecord | null> {
    const batchId = BATCH_FILE_NAME.exec(name)?.[1];
    if (!batchId) return null;
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path.join(this.directory, name), 'r');
    } catch (reason) {
      if (hasCode(reason, 'ENOENT')) return null;
      throw reason;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_BATCH_BYTES) return null;
      const bytes = Buffer.alloc(metadata.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) return null;
        offset += read.bytesRead;
      }
      if ((await handle.stat()).size !== metadata.size) return null;
      const parsed = batchRecordSchema.safeParse(JSON.parse(bytes.toString('utf8')) as unknown);
      return parsed.success && parsed.data.batchId === batchId ? parsed.data : null;
    } catch (reason) {
      if (reason instanceof SyntaxError) return null;
      throw reason;
    } finally {
      await handle.close();
    }
  }

  async list(): Promise<BrowserCompanionBatchRecord[]> {
    // Timestamped names let normal history bound body reads without reading every frozen candidate.
    const names = (await this.fileNames()).sort().reverse().slice(0, MAX_BATCH_HISTORY);
    const records: BrowserCompanionBatchRecord[] = [];
    for (const name of names) {
      const record = await this.readFile(name);
      if (record) records.push(record);
    }
    return records;
  }

  async deleteItems(batchId: string, targets: readonly string[], expectedHandoffId?: string): Promise<void> {
    const input = browserCompanionBatchDeleteInputSchema.parse({
      batchId,
      targets,
    });
    const record = await this.get(input.batchId);
    if (!record) return;
    const removedTargets = new Set(input.targets);
    const items = record.items.filter(
      (item) =>
        !removedTargets.has(item.target) ||
        (expectedHandoffId && item.result && item.result.handoff.handoffId !== expectedHandoffId),
    );
    if (items.length === record.items.length) return;
    if (!items.length) {
      await rm(this.file(record.batchId, record.createdAt), { force: true });
      return;
    }
    const retainedTargets = new Set(items.map((item) => item.target));
    await this.save({
      ...record,
      items,
      input: {
        ...record.input,
        items: record.input.items.filter((item) =>
          retainedTargets.has(item.target as (typeof items)[number]['target']),
        ),
      },
    });
  }
}
