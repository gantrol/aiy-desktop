import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const checkpointSchemaVersion = 1;
const maximumCheckpointBytes = 4 * 1024 * 1024;
const checkpointKeyPattern = /^[a-f0-9]{64}$/;

export interface VideoDocumentGenerationCheckpoint<T> {
  actualModel: string;
  value: T;
}

export class VideoDocumentGenerationCheckpointStore {
  private readonly parentRoot: string;
  private readonly root: string;

  constructor(libraryRoot: string, documentId: string) {
    this.parentRoot = path.resolve(
      libraryRoot,
      'temp',
      'video-document-generation-checkpoints',
      `v${checkpointSchemaVersion}`,
    );
    const documentScope = createHash('sha256').update(documentId, 'utf8').digest('hex');
    this.root = path.join(this.parentRoot, documentScope);
  }

  keyFor(input: unknown) {
    return createHash('sha256')
      .update(JSON.stringify({ schemaVersion: checkpointSchemaVersion, input }), 'utf8')
      .digest('hex');
  }

  async read<T>(key: string, stage: string, valueSchema: z.ZodType<T>) {
    if (!checkpointKeyPattern.test(key)) return null;
    const filePath = this.filePath(key);
    try {
      const handle = await open(filePath, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size <= 0 || stat.size > maximumCheckpointBytes) return null;
        const capacity = Math.min(maximumCheckpointBytes + 1, Number(stat.size) + 1);
        const buffer = Buffer.alloc(capacity);
        let byteLength = 0;
        while (byteLength < capacity) {
          const chunk = await handle.read(buffer, byteLength, capacity - byteLength, null);
          if (chunk.bytesRead === 0) break;
          byteLength += chunk.bytesRead;
        }
        if (byteLength > maximumCheckpointBytes || byteLength !== stat.size) return null;
        let decoded: unknown;
        try {
          decoded = JSON.parse(buffer.subarray(0, byteLength).toString('utf8')) as unknown;
        } catch {
          return null;
        }
        const parsed = z
          .object({
            schemaVersion: z.literal(checkpointSchemaVersion),
            key: z.string().regex(checkpointKeyPattern),
            stage: z.string().min(1).max(100),
            actualModel: z.string().min(1).max(200),
            offeredVisualCandidateIds: z.array(z.string().min(1).max(200)).max(8),
            value: valueSchema,
          })
          .strict()
          .safeParse(decoded);
        if (!parsed.success || parsed.data.key !== key || parsed.data.stage !== stage) return null;
        return { actualModel: parsed.data.actualModel, value: parsed.data.value };
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  async write<T>(
    key: string,
    stage: string,
    actualModel: string,
    offeredVisualCandidateIds: string[],
    value: T,
    valueSchema: z.ZodType<T>,
  ): Promise<void> {
    if (!checkpointKeyPattern.test(key)) return;
    const parsed = valueSchema.safeParse(value);
    if (!parsed.success) return;
    const serialized = JSON.stringify({
      schemaVersion: checkpointSchemaVersion,
      key,
      stage,
      actualModel,
      offeredVisualCandidateIds,
      value: parsed.data,
    });
    if (Buffer.byteLength(serialized, 'utf8') > maximumCheckpointBytes) return;

    const filePath = this.filePath(key);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      const handle = await open(temporaryPath, 'wx');
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporaryPath, filePath);
      } catch {
        await rm(filePath, { force: true });
        await rename(temporaryPath, filePath);
      }
    } catch {
      // Checkpoints are an optimization. Generation must still succeed when this cache is unavailable.
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async clear(): Promise<boolean> {
    const relative = path.relative(this.parentRoot, this.root);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    try {
      await rm(this.root, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  private filePath(key: string) {
    return path.join(this.root, key.slice(0, 2), `${key}.json`);
  }
}
