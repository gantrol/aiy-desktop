import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readBoundedJsonWithBackupSourceAsync, writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';

const MAXIMUM_RECOVERY_BYTES = 16 * 1024;
const storeVersionSchema = z
  .string()
  .min(7)
  .max(32)
  .regex(/^\d{1,5}(?:\.\d{1,5}){3}$/u)
  .refine(
    (value) => value.split('.').every((field) => Number.parseInt(field, 10) <= 65_535),
    'Store package version fields must be within 0..65535',
  );

const appUpdateRecoveryRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceVersion: z.string().min(1).max(64),
    targetStoreVersion: storeVersionSchema,
    phase: z.enum(['DOWNLOADED', 'INSTALL_REQUESTED']),
    updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type AppUpdateRecoveryRecord = z.infer<typeof appUpdateRecoveryRecordSchema>;

export interface AppUpdateRecoveryBackend {
  load(): Promise<AppUpdateRecoveryRecord | null>;
  save(record: AppUpdateRecoveryRecord): Promise<void>;
  clear(): Promise<void>;
}

async function removeFile(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export class AppUpdateRecoveryStore implements AppUpdateRecoveryBackend {
  private readonly filePath: string;

  constructor(userDataRoot: string) {
    this.filePath = path.join(userDataRoot, 'app-update', 'recovery.v1.json');
  }

  async load() {
    const stored = await readBoundedJsonWithBackupSourceAsync(
      this.filePath,
      MAXIMUM_RECOVERY_BYTES,
      (value) => appUpdateRecoveryRecordSchema.safeParse(value).success,
    );
    const parsed = appUpdateRecoveryRecordSchema.safeParse(stored?.value);
    if (!parsed.success) return null;
    if (stored?.source === 'backup') await writeJsonAtomicallyAsync(this.filePath, parsed.data);
    return parsed.data;
  }

  async save(record: AppUpdateRecoveryRecord) {
    await writeJsonAtomicallyAsync(this.filePath, appUpdateRecoveryRecordSchema.parse(record));
  }

  async clear() {
    await removeFile(this.filePath);
    await removeFile(`${this.filePath}.bak`);
  }
}
