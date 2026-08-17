import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ImageGenerationConcurrencyDto, ImageGenerationConcurrencySaveInput } from '@/shared/contracts';
import {
  DEFAULT_IMAGE_GENERATION_MAX_CONCURRENT,
  MAX_IMAGE_GENERATION_MAX_CONCURRENT,
  MIN_IMAGE_GENERATION_MAX_CONCURRENT,
} from '@/shared/image-generation-concurrency';

interface PersistedGenerationConcurrency {
  schemaVersion: 1;
  limitsByModelKey: Record<string, number>;
  updatedAt: string;
}

const modelKeySchema = z.string().min(1).max(512);
const maxConcurrentSchema = z
  .number()
  .int()
  .min(MIN_IMAGE_GENERATION_MAX_CONCURRENT)
  .max(MAX_IMAGE_GENERATION_MAX_CONCURRENT);
const persistedGenerationConcurrencySchema: z.ZodType<PersistedGenerationConcurrency> = z
  .object({
    schemaVersion: z.literal(1),
    limitsByModelKey: z.record(modelKeySchema, maxConcurrentSchema),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.limitsByModelKey).length > 10_000) {
      context.addIssue({ code: 'custom', message: 'Too many image-generation concurrency overrides' });
    }
  });

function snapshot(limitsByModelKey: Record<string, number>, updatedAt: string | null): ImageGenerationConcurrencyDto {
  return {
    defaultMaxConcurrent: DEFAULT_IMAGE_GENERATION_MAX_CONCURRENT,
    limitsByModelKey: { ...limitsByModelKey },
    updatedAt,
  };
}

export class GenerationConcurrencyConfiguration {
  constructor(private readonly filePath: string) {}

  get(): ImageGenerationConcurrencyDto {
    const persisted = this.read();
    return snapshot(persisted?.limitsByModelKey ?? {}, persisted?.updatedAt ?? null);
  }

  save(input: ImageGenerationConcurrencySaveInput): ImageGenerationConcurrencyDto {
    const modelKey = modelKeySchema.parse(input.modelKey);
    const maxConcurrent = maxConcurrentSchema.parse(input.maxConcurrent);
    const limitsByModelKey = this.get().limitsByModelKey;
    if (maxConcurrent === DEFAULT_IMAGE_GENERATION_MAX_CONCURRENT) delete limitsByModelKey[modelKey];
    else limitsByModelKey[modelKey] = maxConcurrent;
    const record: PersistedGenerationConcurrency = {
      schemaVersion: 1,
      limitsByModelKey,
      updatedAt: new Date().toISOString(),
    };
    this.write(record);
    return snapshot(record.limitsByModelKey, record.updatedAt);
  }

  private read(): Omit<PersistedGenerationConcurrency, 'schemaVersion'> | null {
    try {
      const parsed = persistedGenerationConcurrencySchema.safeParse(
        JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown,
      );
      if (!parsed.success) throw new Error('Stored image-generation concurrency configuration is invalid');
      return { limitsByModelKey: parsed.data.limitsByModelKey, updatedAt: parsed.data.updatedAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private write(record: PersistedGenerationConcurrency) {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporaryPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        /* no partial configuration remains */
      }
      throw error;
    }
  }
}
