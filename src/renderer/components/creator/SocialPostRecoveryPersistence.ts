import {
  SOCIAL_POST_RECOVERY_MAX_BYTES,
  socialPostRecoveryRecordSchema,
  socialPostRecoverySaveSchema,
  socialPostRecoverySnapshotSchema,
  type SocialPostRecoveryApi,
  type SocialPostRecoveryRecord,
  type SocialPostRecoverySave,
  type SocialPostRecoveryScope,
  type SocialPostRecoverySnapshot,
} from '@/shared/contracts/social-post-recovery';

export type SocialPostRecoveryStatus = 'loading' | 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

function snapshotJson(snapshot: SocialPostRecoverySnapshot | null) {
  // Compare the same field order on both sides of the IPC validation boundary.
  // Incomplete input stays editable; write() reports validation failures.
  const parsed = socialPostRecoverySnapshotSchema.nullable().safeParse(snapshot);
  return JSON.stringify(parsed.success ? parsed.data : snapshot);
}

/** Serial, conditional checkpoints; an uncertain write keeps its original request identity. */
export class SocialPostRecoveryPersistence {
  status: SocialPostRecoveryStatus = 'loading';
  remote: SocialPostRecoveryRecord | null = null;
  private revision: string | null = null;
  private savedJson = 'null';
  private pending: SocialPostRecoverySave | null = null;
  private writing: Promise<boolean> | null = null;
  private loaded = false;

  constructor(
    private readonly scope: SocialPostRecoveryScope,
    private readonly api: SocialPostRecoveryApi,
    private readonly capture: () => SocialPostRecoverySnapshot | null,
    private readonly changed: () => void,
  ) {}

  private setStatus(status: SocialPostRecoveryStatus) {
    this.status = status;
    this.changed();
  }
  async load() {
    this.setStatus('loading');
    try {
      const record = await this.api.socialPostRecoveryLoad(this.scope);
      this.revision = record?.revision ?? null;
      this.savedJson = snapshotJson(record?.snapshot ?? null);
      this.loaded = true;
      this.setStatus('saved');
      return record;
    } catch (reason) {
      this.setStatus('error');
      throw reason;
    }
  }
  observe() {
    if (!this.loaded || this.writing || this.status === 'error' || this.status === 'conflict') return;
    this.setStatus(snapshotJson(this.capture()) === this.savedJson && !this.pending ? 'saved' : 'dirty');
  }
  conflict(record: SocialPostRecoveryRecord | null) {
    this.remote = record;
    this.setStatus('conflict');
  }
  acceptComparedRecord() {
    this.revision = this.remote?.revision ?? null;
    this.savedJson = snapshotJson(this.remote?.snapshot ?? null);
    this.remote = null;
    this.pending = null;
    this.setStatus('dirty');
  }
  async checkpoint(): Promise<boolean> {
    if (!this.loaded || this.status === 'conflict') return false;
    if (this.writing) {
      if (!(await this.writing)) return false;
      // A caller may have changed the snapshot while joining an earlier write.
      return this.checkpoint();
    }
    this.writing = this.write();
    try {
      return await this.writing;
    } finally {
      this.writing = null;
    }
  }
  private async write() {
    try {
      while (this.pending || snapshotJson(this.capture()) !== this.savedJson) {
        this.setStatus('saving');
        if (!this.pending) {
          const request = socialPostRecoverySaveSchema.parse({
            ...this.scope,
            schemaVersion: 1,
            expectedRevision: this.revision,
            revision: crypto.randomUUID(),
            // A null snapshot is a tombstone, so an old writer cannot resurrect a cleared draft.
            snapshot: this.capture(),
          });
          if (new TextEncoder().encode(JSON.stringify(request)).byteLength > SOCIAL_POST_RECOVERY_MAX_BYTES)
            throw new Error('SOCIAL_POST_RECOVERY_TOO_LARGE');
          this.pending = request;
        }
        const request = this.pending;
        const result = await this.api.socialPostRecoverySave(request);
        if (result.status === 'conflict') {
          this.pending = null;
          this.conflict(result.record);
          return false;
        }
        const { expectedRevision: _expectedRevision, ...expected } = request;
        if (
          JSON.stringify(socialPostRecoveryRecordSchema.parse(result.record)) !==
          JSON.stringify(socialPostRecoveryRecordSchema.parse(expected))
        )
          throw new Error('SOCIAL_POST_RECOVERY_UNMATCHED_ACKNOWLEDGEMENT');
        this.revision = result.record.revision;
        this.savedJson = snapshotJson(result.record.snapshot);
        this.pending = null;
      }
      this.setStatus('saved');
      return true;
    } catch {
      this.setStatus('error');
      return false;
    }
  }
}
