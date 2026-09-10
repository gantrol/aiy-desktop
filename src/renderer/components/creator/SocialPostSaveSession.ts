import { editableContent } from '@/renderer/components/creator/socialPostEditorTransforms';
import { SocialPostRecoveryPersistence } from '@/renderer/components/creator/SocialPostRecoveryPersistence';
import { ContentCheckpointTimer } from '@/renderer/features/content-editor/ContentCheckpointTimer';
import { contentImagesRecoverable } from '@/renderer/features/content-editor/contentImageRecovery';
import { sha256Hex } from '@/renderer/lib/sha256Hex';
import type { AssetDto, SocialPostContentInput, SocialPostDto } from '@/shared/contracts';
import { blockDocumentImportIds } from '@/shared/contracts/block-document';
import {
  canonicalSocialPostContentJson,
  socialPostContentSchema,
  type SocialPostRevisionSaveInput,
  type SocialPostRevisionSaveResult,
} from '@/shared/contracts/social-post';
import {
  socialPostRecoverySnapshotSchema,
  type SocialPostRecoveryApi,
  type SocialPostRecoveryScope,
  type SocialPostRecoverySnapshot,
} from '@/shared/contracts/social-post-recovery';

interface Handlers {
  save(request: SocialPostRevisionSaveInput, spaceId: string): Promise<SocialPostRevisionSaveResult>;
  report(kind: 'save' | 'recovery', detail?: string): void;
}

function legacyKey(scope: SocialPostRecoveryScope) {
  return `aiy.social-post-recovery.v1:${encodeURIComponent(scope.spaceId)}:${encodeURIComponent(scope.postId)}`;
}
function readLegacy(scope: SocialPostRecoveryScope) {
  try {
    const raw = sessionStorage.getItem(legacyKey(scope));
    if (!raw || raw.length > 1_000_000) return null;
    const parsed = socialPostRecoverySnapshotSchema.safeParse({ ...JSON.parse(raw), baseContent: null });
    if (!parsed.success || (parsed.data.pending && parsed.data.pending.postId !== scope.postId)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
function sameDraft(left: SocialPostRecoverySnapshot, right: SocialPostRecoverySnapshot) {
  return (
    left.baseRevisionId === right.baseRevisionId &&
    canonicalSocialPostContentJson(left.content) === canonicalSocialPostContentJson(right.content) &&
    JSON.stringify(left.pending) === JSON.stringify(right.pending)
  );
}

/** The session outlives the editor so navigation cannot abandon an in-flight acknowledgement. */
export class SocialPostSaveSession {
  private recoverEditor: (() => Promise<boolean>) | null = null;
  setRecoverableInput = (recover: (() => Promise<boolean>) | null) => {
    this.recoverEditor = recover;
  };
  readonly savedPostRef: { current: SocialPostDto };
  private content: SocialPostContentInput;
  private assets: AssetDto[];
  private baseRevisionId: string;
  private baseContent: SocialPostContentInput | null;
  private latest: SocialPostDto;
  private conflict: SocialPostDto | null = null;
  private pending: SocialPostRevisionSaveInput | null = null;
  private readonly recovery: SocialPostRecoveryPersistence;
  private readonly listeners = new Set<() => void>();
  private readonly inputOperations = new Set<Promise<void>>();
  private readonly epoch = crypto.randomUUID();
  private sequence = 0;
  private editorEpoch = 0;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private saving: Promise<boolean> | null = null;
  private flushing: Promise<boolean> | null = null;
  private exitSnapshotJson: string | undefined;
  private saveFailed = false;
  private leases = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly recoveryTimer = new ContentCheckpointTimer();
  private handlers: Handlers;
  private state: ReturnType<SocialPostSaveSession['snapshot']>;

  constructor(
    readonly scope: SocialPostRecoveryScope,
    post: SocialPostDto,
    api: SocialPostRecoveryApi,
    handlers: Handlers,
  ) {
    this.latest = post;
    this.savedPostRef = { current: post };
    this.content = editableContent(post);
    this.baseContent = this.content;
    this.baseRevisionId = post.revisionId;
    this.assets = post.content.mediaAssets;
    this.handlers = handlers;
    this.recovery = new SocialPostRecoveryPersistence(
      scope,
      api,
      () => this.captureRecovery(),
      () => this.publish(),
    );
    this.state = this.snapshot();
  }
  private contentDirty() {
    return (
      !this.baseContent ||
      canonicalSocialPostContentJson(this.content) !== canonicalSocialPostContentJson(this.baseContent)
    );
  }
  private hasPendingImages() {
    return Boolean(this.content.document && blockDocumentImportIds(this.content.document).length);
  }
  private snapshot() {
    return {
      content: this.content,
      editorEpoch: this.editorEpoch,
      mediaAssets: this.assets,
      conflict: this.conflict,
      dirty: this.contentDirty() || Boolean(this.pending || this.conflict) || this.inputOperations.size > 0,
      saving: Boolean(this.saving),
      saveFailed: this.saveFailed,
      ready: this.initialized,
      recoveryStatus: this.recovery.status,
      recoveryConflict: this.recovery.remote,
      inputPending: this.inputOperations.size > 0,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.state = this.snapshot();
    this.listeners.forEach((listener) => listener());
  }
  updateHandlers(handlers: Handlers) {
    this.handlers = handlers;
  }
  get retained() {
    return this.leases > 0;
  }
  retain() {
    this.leases += 1;
    void this.initialize().then(() => this.schedule());
  }
  release() {
    this.leases = Math.max(0, this.leases - 1);
    if (this.leases) return;
    this.clearTimers();
    queueMicrotask(() => {
      if (!this.leases)
        void this.flushForExit().then((safe) => {
          if (safe && !this.leases && this.recovery.status === 'saved' && !this.inputOperations.size)
            sessions.delete(sessionKey(this.scope));
        });
    });
  }
  private initialize() {
    if (this.initialized) return Promise.resolve();
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const record = await this.recovery.load();
        const legacy = readLegacy(this.scope);
        if (record?.snapshot) this.restore(record.snapshot);
        else if (!record && legacy) this.restore(legacy);
        else this.acceptPost(this.latest);
        this.initialized = true;
        if (record?.snapshot && legacy && !sameDraft(legacy, record.snapshot)) {
          this.restore(legacy);
          this.recovery.conflict(record);
        } else this.recovery.observe();
        this.publish();
      } catch {
        this.handlers.report('recovery');
      }
    })().finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }
  private captureRecovery(): SocialPostRecoverySnapshot | null {
    if (!this.contentDirty() && !this.pending && !this.conflict) return null;
    return {
      content: this.content,
      baseRevisionId: this.baseRevisionId,
      baseContent: this.baseContent,
      pending: this.pending,
    };
  }
  private restore(snapshot: SocialPostRecoverySnapshot) {
    this.editorEpoch++;
    this.content = snapshot.content;
    this.baseRevisionId = snapshot.baseRevisionId;
    this.baseContent = snapshot.baseContent;
    this.pending = snapshot.pending;
    // Replay an uncertain request before comparing with the current remote revision.
    this.conflict = !this.pending && this.baseRevisionId !== this.latest.revisionId ? this.latest : null;
    this.saveFailed = false;
  }
  private acceptPost(post: SocialPostDto) {
    this.editorEpoch++;
    this.savedPostRef.current = post;
    this.baseRevisionId = post.revisionId;
    this.baseContent = editableContent(post);
    this.content = this.baseContent;
    this.pending = null;
    this.conflict = null;
    this.saveFailed = false;
  }
  receivePost(post: SocialPostDto) {
    if (post.id !== this.scope.postId || post.revisionNo < this.latest.revisionNo) return;
    this.latest = post;
    this.mergeAssets(post.content.mediaAssets);
    if (!this.initialized || post.revisionId === this.baseRevisionId || this.pending || this.saving) return;
    // A compared revision stays fixed until the user chooses it; newer revisions are checked on save.
    if (!this.conflict) {
      if (this.contentDirty()) this.conflict = post;
      else this.acceptPost(post);
    }
    this.recovery.observe();
    this.publish();
    this.schedule();
  }
  setContent = (action: SocialPostContentInput | ((current: SocialPostContentInput) => SocialPostContentInput)) => {
    if (!this.initialized) return;
    // Store immediately so drain sees the last input even before React's next render.
    this.content = typeof action === 'function' ? action(this.content) : action;
    this.recovery.observe();
    this.publish();
    this.schedule();
  };
  setMediaAssets = (action: AssetDto[] | ((current: AssetDto[]) => AssetDto[])) => {
    this.assets = typeof action === 'function' ? action(this.assets) : action;
    this.publish();
  };
  trackInput = async (operation: Promise<void>) => {
    this.inputOperations.add(operation);
    this.publish();
    try {
      await operation;
    } finally {
      this.inputOperations.delete(operation);
      this.publish();
      this.schedule();
    }
  };
  private async settleInput() {
    while (this.inputOperations.size) await Promise.allSettled([...this.inputOperations]);
  }
  private mergeAssets(assets: AssetDto[]) {
    this.setMediaAssets((current) => [...new Map([...current, ...assets].map((asset) => [asset.id, asset])).values()]);
  }
  private clearTimers() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.recoveryTimer.cancel();
    this.saveTimer = null;
  }
  private schedule() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.leases || !this.initialized) {
      this.recoveryTimer.cancel();
      return;
    }
    if (this.recovery.status === 'dirty') this.recoveryTimer.schedule(() => void this.checkpoint(), 400);
    else this.recoveryTimer.cancel();
    if (
      !this.saving &&
      !this.saveFailed &&
      !this.conflict &&
      !this.hasPendingImages() &&
      !['error', 'conflict'].includes(this.recovery.status) &&
      (this.contentDirty() || this.pending)
    )
      this.saveTimer = setTimeout(() => void this.persist(), 650);
  }
  private async checkpoint() {
    const safe = await this.recovery.checkpoint();
    if (safe) {
      // The durable record (including a tombstone) now supersedes the old window-only copy.
      try {
        sessionStorage.removeItem(legacyKey(this.scope));
      } catch {
        /* Durable storage is authoritative. */
      }
    } else if (this.recovery.status === 'error') this.handlers.report('recovery');
    return safe;
  }
  persist = async (_snapshot?: SocialPostContentInput): Promise<boolean> => {
    await this.initialize();
    await this.settleInput();
    if (!this.initialized || this.conflict || this.recovery.status === 'conflict') return false;
    if (this.saving) return this.saving;
    this.clearTimers();
    this.saveFailed = false;
    this.saving = this.saveChanges();
    this.publish();
    try {
      return await this.saving;
    } finally {
      this.saving = null;
      this.publish();
      this.schedule();
    }
  };
  private async saveChanges() {
    try {
      while (this.pending || this.contentDirty()) {
        if (!this.pending) {
          if (this.hasPendingImages()) {
            await this.checkpoint();
            return false;
          }
          const content = socialPostContentSchema.parse(this.content);
          const expectedRevisionId = this.baseRevisionId;
          const contentHash = await sha256Hex(canonicalSocialPostContentJson(content));
          this.pending = {
            postId: this.scope.postId,
            expectedRevisionId,
            requestId: crypto.randomUUID(),
            sessionEpoch: this.epoch,
            draftSeq: ++this.sequence,
            content,
            contentHash,
          };
        }
        const request = this.pending;
        // Persist the original request before dispatch: a restart can replay its exact identity.
        if (!(await this.checkpoint())) return false;
        const result = await this.handlers.save(request, this.scope.spaceId);
        if (
          result.postId !== request.postId ||
          result.requestId !== request.requestId ||
          result.sessionEpoch !== request.sessionEpoch ||
          result.draftSeq !== request.draftSeq
        )
          throw new Error('Unmatched social post save response');
        if (result.status === 'CONFLICT') {
          if (result.currentPost.id !== request.postId || result.expectedRevisionId !== request.expectedRevisionId)
            throw new Error('Unmatched social post conflict response');
          this.pending = null;
          if (result.currentPost.revisionNo >= this.latest.revisionNo) this.latest = result.currentPost;
          this.conflict = this.latest;
          this.mergeAssets(this.latest.content.mediaAssets);
          await this.checkpoint();
          this.publish();
          return false;
        }
        if (
          result.post.id !== request.postId ||
          result.contentHash !== request.contentHash ||
          result.post.contentHash !== request.contentHash ||
          canonicalSocialPostContentJson(editableContent(result.post)) !==
            canonicalSocialPostContentJson(request.content)
        )
          throw new Error('Social post acknowledgement does not match the saved content');
        this.pending = null;
        this.savedPostRef.current = result.post;
        this.baseRevisionId = result.post.revisionId;
        this.baseContent = request.content;
        this.mergeAssets(result.post.content.mediaAssets);
        if (this.latest.revisionNo > result.post.revisionNo) this.conflict = this.latest;
        else this.latest = result.post;
        if (!(await this.checkpoint()) || this.conflict) return false;
        // Input received while saving belongs to the next request, never to the old acknowledgement.
      }
      return await this.checkpoint();
    } catch (reason) {
      this.saveFailed = true;
      this.handlers.report('save', String(reason));
      await this.checkpoint();
      return false;
    }
  }
  resolveConflict = (useLocal: boolean) => {
    const reviewed = this.conflict;
    if (!reviewed || this.saving || this.recovery.status === 'conflict') return;
    const local = this.content;
    this.acceptPost(reviewed);
    if (useLocal) this.content = local;
    this.recovery.observe();
    this.publish();
    this.schedule();
  };
  resolveRecovery = (useLocal: boolean) => {
    if (this.recovery.status !== 'conflict' || this.saving) return;
    const snapshot = this.recovery.remote?.snapshot;
    if (!useLocal) {
      if (snapshot) this.restore(snapshot);
      else this.acceptPost(this.latest);
    }
    this.recovery.acceptComparedRecord();
    this.publish();
    void this.checkpoint().then((safe) => {
      if (safe) this.schedule();
    });
  };
  retry = async () => {
    await this.initialize();
    if (!this.initialized || !(await this.checkpoint())) return false;
    return this.persist();
  };
  async flushForExit(): Promise<boolean> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain();
    try {
      return await this.flushing;
    } finally {
      this.flushing = null;
    }
  }
  private async drain() {
    this.clearTimers();
    await this.initialize();
    if (this.content.document && blockDocumentImportIds(this.content.document).length) {
      if (this.recoverEditor && !(await this.recoverEditor())) return false;
      if (!(await contentImagesRecoverable(this.content.document))) return false;
      return this.initialized && (await this.checkpoint());
    }
    await this.settleInput();
    if (!this.initialized) return false;
    if (this.saving) await this.saving;
    else if (
      JSON.stringify(this.captureRecovery()) !== this.exitSnapshotJson &&
      !this.conflict &&
      this.recovery.status !== 'conflict'
    )
      await this.persist();
    this.clearTimers();
    // A conflict or save error can safely survive closing once the recovery copy is durable.
    const safe = await this.checkpoint();
    if (safe) this.exitSnapshotJson = JSON.stringify(this.captureRecovery());
    return safe;
  }
}

const sessions = new Map<string, SocialPostSaveSession>();
function sessionKey(scope: SocialPostRecoveryScope) {
  return JSON.stringify([scope.spaceId, scope.postId]);
}
export function acquireSocialPostSaveSession(
  scope: SocialPostRecoveryScope,
  post: SocialPostDto,
  api: SocialPostRecoveryApi,
  handlers: Handlers,
) {
  const key = sessionKey(scope);
  const existing = sessions.get(key);
  if (existing) return existing;
  const session = new SocialPostSaveSession(scope, post, api, handlers);
  sessions.set(key, session);
  return session;
}
export async function flushSocialPostSaveSessions() {
  let safe = true;
  for (const session of sessions.values()) {
    if (!(await session.flushForExit())) safe = false;
    else if (!session.retained) sessions.delete(sessionKey(session.scope));
  }
  return safe;
}
