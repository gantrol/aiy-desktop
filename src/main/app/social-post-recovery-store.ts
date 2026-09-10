import { createHash } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readBoundedJsonWithBackupSourceAsync, writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  SOCIAL_POST_RECOVERY_MAX_BYTES,
  socialPostRecoveryRecordSchema,
  socialPostRecoverySaveSchema,
  socialPostRecoveryScopeSchema,
  type SocialPostRecoveryScope,
  type SocialPostRecoverySave,
  type SocialPostRecoverySaveResult,
} from '@/shared/contracts/social-post-recovery';

export class SocialPostRecoveryStore {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly userDataRoot: string) {}

  private filePath(scope: SocialPostRecoveryScope) {
    const key = createHash('sha256')
      .update(JSON.stringify([scope.spaceId, scope.postId]))
      .digest('hex');
    return path.join(this.userDataRoot, 'ui-state', 'social-post-recovery', `${key}.json`);
  }
  private async read(filePath: string, scope: SocialPostRecoveryScope) {
    const stored = await readBoundedJsonWithBackupSourceAsync(
      filePath,
      SOCIAL_POST_RECOVERY_MAX_BYTES,
      (value) => socialPostRecoveryRecordSchema.safeParse(value).success,
    );
    if (stored) {
      const record = socialPostRecoveryRecordSchema.parse(stored.value);
      if (record.spaceId !== scope.spaceId || record.postId !== scope.postId)
        throw new Error('SOCIAL_POST_RECOVERY_SCOPE_MISMATCH');
      return { record, source: stored.source };
    }
    for (const candidate of [filePath, `${filePath}.bak`]) {
      try {
        await stat(candidate);
      } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw reason;
      }
      throw new Error('SOCIAL_POST_RECOVERY_UNREADABLE');
    }
    return null;
  }
  async load(raw: SocialPostRecoveryScope) {
    const scope = socialPostRecoveryScopeSchema.parse(raw);
    const filePath = this.filePath(scope);
    await this.pending.get(filePath)?.catch(() => undefined);
    return (await this.read(filePath, scope))?.record ?? null;
  }
  async save(raw: SocialPostRecoverySave): Promise<SocialPostRecoverySaveResult> {
    const input = socialPostRecoverySaveSchema.parse(raw);
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > SOCIAL_POST_RECOVERY_MAX_BYTES)
      throw new Error('SOCIAL_POST_RECOVERY_TOO_LARGE');
    const filePath = this.filePath(input);
    const operation = (this.pending.get(filePath) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const stored = await this.read(filePath, input);
        const current = stored?.record ?? null;
        const { expectedRevision, ...record } = input;
        if (current?.revision === record.revision) {
          if (JSON.stringify(current) !== JSON.stringify(record))
            throw new Error('SOCIAL_POST_RECOVERY_REQUEST_REUSED');
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
