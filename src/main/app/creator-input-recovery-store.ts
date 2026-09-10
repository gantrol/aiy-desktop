import { createHash } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readBoundedJsonWithBackupSourceAsync, writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  CREATOR_INPUT_RECOVERY_MAX_BYTES,
  creatorInputRecoveryRecordSchema,
  creatorInputRecoverySaveSchema,
  creatorInputRecoveryScopeSchema,
  type CreatorInputRecoveryScope,
  type CreatorInputRecoverySave,
  type CreatorInputRecoverySaveResult,
} from '@/shared/contracts/creator-input-recovery';

export class CreatorInputRecoveryStore {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly userDataRoot: string) {}

  private filePath(scope: CreatorInputRecoveryScope) {
    const key = createHash('sha256')
      .update(JSON.stringify([scope.spaceId, scope.seriesId, scope.versionId]))
      .digest('hex');
    return path.join(this.userDataRoot, 'ui-state', 'creator-input-recovery', `${key}.json`);
  }

  private async read(filePath: string, scope: CreatorInputRecoveryScope) {
    const stored = await readBoundedJsonWithBackupSourceAsync(
      filePath,
      CREATOR_INPUT_RECOVERY_MAX_BYTES,
      (value) => creatorInputRecoveryRecordSchema.safeParse(value).success,
    );
    if (stored) {
      const record = creatorInputRecoveryRecordSchema.parse(stored.value);
      if (
        record.spaceId !== scope.spaceId ||
        record.seriesId !== scope.seriesId ||
        record.versionId !== scope.versionId
      ) {
        throw new Error('CREATOR_INPUT_RECOVERY_SCOPE_MISMATCH');
      }
      return { record, source: stored.source };
    }
    for (const candidate of [filePath, `${filePath}.bak`]) {
      try {
        await stat(candidate);
      } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw reason;
      }
      throw new Error('CREATOR_INPUT_RECOVERY_UNREADABLE');
    }
    return null;
  }

  async load(raw: CreatorInputRecoveryScope) {
    const scope = creatorInputRecoveryScopeSchema.parse(raw);
    const filePath = this.filePath(scope);
    await this.pending.get(filePath)?.catch(() => undefined);
    return (await this.read(filePath, scope))?.record ?? null;
  }

  async save(raw: CreatorInputRecoverySave): Promise<CreatorInputRecoverySaveResult> {
    const input = creatorInputRecoverySaveSchema.parse(raw);
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > CREATOR_INPUT_RECOVERY_MAX_BYTES) {
      throw new Error('CREATOR_INPUT_RECOVERY_TOO_LARGE');
    }
    const filePath = this.filePath(input);
    const operation = (this.pending.get(filePath) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const stored = await this.read(filePath, input);
        const current = stored?.record ?? null;
        const { expectedRevision, ...record } = input;
        if (current?.revision === record.revision) {
          if (JSON.stringify(current) !== JSON.stringify(record))
            throw new Error('CREATOR_INPUT_RECOVERY_REQUEST_REUSED');
          return { status: 'saved' as const, record: current };
        }
        if ((current?.revision ?? null) !== expectedRevision) return { status: 'conflict' as const, record: current };
        if (stored?.source === 'backup') {
          try {
            await unlink(filePath);
          } catch (reason) {
            if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason;
          }
        }
        await writeJsonAtomicallyAsync(filePath, record);
        return { status: 'saved' as const, record };
      });
    this.pending.set(filePath, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(filePath) === operation) this.pending.delete(filePath);
    }
  }
}
