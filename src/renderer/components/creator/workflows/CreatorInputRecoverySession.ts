import { contentImagesRecoverable } from '@/renderer/features/content-editor/contentImageRecovery';
import { ContentCheckpointTimer } from '@/renderer/features/content-editor/ContentCheckpointTimer';
import { creatorInputRecoverySnapshotKey } from '@/renderer/components/creator/workflows/creatorInputRecoverySnapshot';
import { creatorInputRecoveryRequests } from '@/renderer/components/creator/workflows/creatorInputRecoveryRequests';
import {
  CREATOR_INPUT_RECOVERY_MAX_BYTES,
  creatorInputRecoverySaveSchema,
  creatorInputRecoverySnapshotSchema,
  type CreatorInputRecoveryApi,
  type CreatorInputRecoveryRecord,
  type CreatorInputRecoverySave,
  type CreatorInputRecoveryScope,
  type CreatorInputRecoverySnapshot,
} from '@/shared/contracts/creator-input-recovery';

type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
interface State {
  status: Status;
  remote: CreatorInputRecoveryRecord | null;
  changed: boolean;
}

function normalize(snapshot: CreatorInputRecoverySnapshot) {
  // Incomplete edits stay editable; the write boundary validates them before assigning a request ID.
  const parsed = creatorInputRecoverySnapshotSchema.safeParse(snapshot);
  return parsed.success ? parsed.data : snapshot;
}

const sessions = new Set<CreatorInputRecoverySession>();
export async function flushCreatorInputRecoverySessions() {
  let saved = true;
  for (const session of sessions) {
    if (!(await session.flushForAction())) saved = false;
  }
  return saved;
}

export class CreatorInputRecoverySession {
  private state: State = { status: 'loading', remote: null, changed: false };
  private readonly listeners = new Set<() => void>();
  private baseline: CreatorInputRecoverySnapshot;
  private baselineKey: string;
  private baselineCaptured = false;
  private latest: CreatorInputRecoverySnapshot;
  private savedKey: string;
  private savedInput: CreatorInputRecoverySnapshot;
  private revision: string | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private pending: CreatorInputRecoverySave | null = null;
  private writing: Promise<boolean> | null = null;
  private readonly timer = new ContentCheckpointTimer();
  private active = false;
  private restore: (snapshot: CreatorInputRecoverySnapshot) => void = () => {};
  private capture: (() => CreatorInputRecoverySnapshot) | null = null;

  constructor(
    readonly scope: CreatorInputRecoveryScope,
    initial: CreatorInputRecoverySnapshot,
    private readonly api: CreatorInputRecoveryApi,
  ) {
    this.baseline = normalize(initial);
    this.baselineKey = creatorInputRecoverySnapshotKey(this.baseline);
    this.latest = this.baseline;
    this.savedKey = this.baselineKey;
    this.savedInput = this.baseline;
  }

  getSnapshot = () => this.state;
  getCurrentInput = () => this.latest;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(status: Status, remote = this.state.remote) {
    this.state = { status, remote, changed: creatorInputRecoverySnapshotKey(this.latest) !== this.baselineKey };
    this.listeners.forEach((listener) => listener());
  }
  static acquire(
    scope: CreatorInputRecoveryScope,
    initial: CreatorInputRecoverySnapshot,
    api: CreatorInputRecoveryApi,
  ) {
    const existing = [...sessions].find(
      (session) =>
        !session.active &&
        session.scope.spaceId === scope.spaceId &&
        session.scope.seriesId === scope.seriesId &&
        session.scope.versionId === scope.versionId,
    );
    return existing ?? new CreatorInputRecoverySession(scope, initial, api);
  }
  start(restore: (snapshot: CreatorInputRecoverySnapshot) => void, capture: () => CreatorInputRecoverySnapshot) {
    this.active = true;
    this.restore = restore;
    this.capture = capture;
    sessions.add(this);
    if (this.initialized) this.restore(this.latest);
    return this.initialize();
  }
  private initialize() {
    if (this.initialized) return Promise.resolve();
    if (this.initializing) return this.initializing;
    if (!this.baselineCaptured) {
      // Hydration and the editor's schema normalization must finish before establishing the edit baseline.
      // Use the same live capture as later saves, rather than comparing it with a pre-editor render snapshot.
      // If capture fails, retain the supplied baseline so edits made before retry are still detected.
      this.baselineCaptured = true;
      if (!this.captureCurrent()) return Promise.resolve();
      this.baseline = this.latest;
      this.baselineKey = creatorInputRecoverySnapshotKey(this.baseline);
      this.savedKey = this.baselineKey;
      this.savedInput = this.baseline;
    }
    this.initializing = this.api
      .creatorInputRecoveryLoad(this.scope)
      .then((record) => {
        if (this.active && this.capture) this.latest = normalize(this.capture());
        this.revision = record?.revision ?? null;
        this.initialized = true;
        const recovered = normalize(record?.snapshot ?? this.baseline);
        const recoveredKey = creatorInputRecoverySnapshotKey(recovered);
        const latestKey = creatorInputRecoverySnapshotKey(this.latest);
        this.savedKey = recoveredKey;
        this.savedInput = recovered;
        if (latestKey !== recoveredKey && latestKey !== this.baselineKey && recoveredKey !== this.baselineKey) {
          this.publish('conflict', record);
          return;
        }
        if (latestKey === this.baselineKey && latestKey !== recoveredKey) {
          this.latest = recovered;
          if (this.active) this.restore(recovered);
        }
        this.publish(creatorInputRecoverySnapshotKey(this.latest) === this.savedKey ? 'saved' : 'dirty');
        this.schedule();
      })
      .catch(() => {
        this.publish('error');
      })
      .finally(() => {
        this.initializing = null;
      });
    return this.initializing;
  }

  observe(snapshot: CreatorInputRecoverySnapshot) {
    this.latest = normalize(snapshot);
    if (!this.initialized || this.state.status === 'conflict' || this.state.status === 'error') return;
    if (!this.writing) this.publish(creatorInputRecoverySnapshotKey(this.latest) === this.savedKey ? 'saved' : 'dirty');
    this.schedule();
  }
  captureCurrent() {
    try {
      if (this.active && this.capture) this.observe(this.capture());
      return true;
    } catch {
      this.publish('error');
      return false;
    }
  }
  private schedule() {
    if (!this.active || this.state.status !== 'dirty' || this.writing) {
      this.timer.cancel();
      return;
    }
    this.timer.schedule(() => {
      void this.flush();
    }, 700);
  }

  async flush(): Promise<boolean> {
    this.timer.cancel();
    if (!this.captureCurrent()) return false;
    this.timer.cancel();
    if (!this.initialized) await this.initialize();
    if (!this.initialized || this.state.status === 'conflict' || this.state.status === 'error') return false;
    if (this.writing) return this.writing;
    this.writing = this.write();
    try {
      return await this.writing;
    } finally {
      this.writing = null;
      if (!this.active && this.state.status === 'saved') sessions.delete(this);
    }
  }
  private async write() {
    try {
      while (this.pending || creatorInputRecoverySnapshotKey(this.latest) !== this.savedKey) {
        this.publish('saving');
        const latestKey = creatorInputRecoverySnapshotKey(this.latest);
        if (!this.pending) {
          const request = creatorInputRecoverySaveSchema.parse({
            ...this.scope,
            schemaVersion: 1,
            expectedRevision: this.revision,
            revision: crypto.randomUUID(),
            // Keep a revision even when clearing a working copy so stale writers cannot resurrect it.
            snapshot: latestKey === this.baselineKey ? null : this.latest,
          });
          if (new TextEncoder().encode(JSON.stringify(request)).byteLength > CREATOR_INPUT_RECOVERY_MAX_BYTES) {
            this.publish('error');
            return false;
          }
          this.pending = request;
        }
        const request = this.pending;
        if (request.snapshot?.document && !(await contentImagesRecoverable(request.snapshot.document)))
          throw new Error('BLOCK_IMAGE_IMPORT_NOT_DURABLE');
        const result = await this.api.creatorInputRecoverySave(request);
        if (result.status === 'conflict') {
          this.pending = null;
          const remoteKey = creatorInputRecoverySnapshotKey(normalize(result.record?.snapshot ?? this.baseline));
          // A newer revision is not a content conflict when it confirms our saved base or our in-flight write.
          // Keep any edits made while that write was pending and save them against the confirmed revision.
          if (
            remoteKey === this.savedKey ||
            remoteKey === creatorInputRecoverySnapshotKey(request.snapshot ?? this.baseline) ||
            remoteKey === creatorInputRecoverySnapshotKey(this.latest)
          ) {
            this.revision = result.record?.revision ?? null;
            this.savedKey = remoteKey;
            this.savedInput = normalize(result.record?.snapshot ?? this.baseline);
            continue;
          }
          this.publish('conflict', result.record);
          return false;
        }
        this.revision = result.record.revision;
        this.savedKey = creatorInputRecoverySnapshotKey(request.snapshot ?? this.baseline);
        this.savedInput = request.snapshot ?? this.baseline;
        this.pending = null;
      }
      this.publish('saved', null);
      return true;
    } catch {
      this.publish('error');
      return false;
    }
  }
  async retry() {
    if (this.state.status === 'conflict') return false;
    this.publish('dirty');
    return this.flush();
  }
  retryIfFailed() {
    return this.state.status === 'error' ? this.retry() : this.flush();
  }
  async flushForAction() {
    if (await this.retryIfFailed()) return true;
    // An unreadable recovery file alone cannot prevent leaving an untouched editor.
    // A failed live capture or an uncertain write still needs an explicit decision.
    if (
      this.captureCurrent() &&
      this.state.status !== 'conflict' &&
      !this.pending &&
      !this.writing &&
      creatorInputRecoverySnapshotKey(this.latest) === this.savedKey
    ) {
      if (!this.active) sessions.delete(this);
      return true;
    }
    // Cancel the attempted action promptly. In particular, do not keep the native exit handshake
    // (and its inert workspace) waiting for a human decision or replay an outdated generation snapshot.
    creatorInputRecoveryRequests.open(this);
    return false;
  }
  async keepCurrent() {
    if (this.state.status !== 'conflict') return false;
    this.revision = this.state.remote?.revision ?? null;
    this.savedKey = creatorInputRecoverySnapshotKey(this.state.remote?.snapshot ?? this.baseline);
    this.savedInput = this.state.remote?.snapshot ?? this.baseline;
    this.pending = null;
    this.publish('dirty', null);
    return this.flush();
  }
  useSaved() {
    if (this.state.status !== 'conflict') return;
    const remote = this.state.remote;
    this.revision = remote?.revision ?? null;
    this.latest = remote?.snapshot ?? this.baseline;
    this.savedKey = creatorInputRecoverySnapshotKey(this.latest);
    this.savedInput = this.latest;
    this.pending = null;
    this.restore(this.latest);
    this.publish('saved', null);
  }
  async discardUnsaved() {
    const reviewedKey = creatorInputRecoverySnapshotKey(this.latest);
    if (this.writing) await this.writing;
    if (creatorInputRecoverySnapshotKey(this.latest) !== reviewedKey) return false;
    this.timer.cancel();
    this.pending = null;
    this.latest = this.savedInput;
    if (this.active) this.restore(this.latest);
    this.publish('saved', null);
    if (!this.active) sessions.delete(this);
    return true;
  }
  release() {
    this.captureCurrent();
    this.active = false;
    this.capture = null;
    void this.flush().then((saved) => {
      if (saved && !this.active) sessions.delete(this);
    });
  }
}
