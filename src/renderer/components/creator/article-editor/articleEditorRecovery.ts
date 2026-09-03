import type {
  ArticleCommentAnchorUpdateInput,
  ArticleContentInput,
  ArticleDto,
  ArticleElementPlacementInput,
  ArticleRevisionSaveInput,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import {
  articleCommentAnchorUpdatesAreApplied,
  articleCommentAnchorUpdates,
  articleContentSchema,
  canonicalArticleContentJson,
  sameArticleCommentAnchorUpdates,
  sameArticleElementPlacements,
} from '@/shared/contracts/article';
import {
  articleEditorRecoveryCheckpointSchema,
  type ArticleEditorRecoveryCheckpoint,
} from '@/shared/contracts/article-editor-recovery';
import { editableArticleContent } from '@/renderer/components/creator/article-editor/articleEditorSnapshot';

const storagePrefix = 'aiy.article-editor-recovery.v1';
const maxStoredCheckpointCharacters = 4_000_000;
const recoveryWriteIdleMs = 800;
type RecoveryCheckpoint = ArticleEditorRecoveryCheckpoint;

export interface ArticleEditorRecoveredDraft {
  content: ArticleContentInput;
  media: readonly VideoDocumentRevisionMediaDto[];
  elements: readonly ArticleElementPlacementInput[];
  commentAnchors: readonly ArticleCommentAnchorUpdateInput[];
}

export type ArticleEditorRecoveryResult =
  | { kind: 'none' }
  | { kind: 'resumed'; draft: ArticleEditorRecoveredDraft; updatedAt: number }
  | { kind: 'restored'; draft: ArticleEditorRecoveredDraft; updatedAt: number }
  | { kind: 'conflict'; draft: ArticleEditorRecoveredDraft; updatedAt: number };

interface RecordDraftInput extends ArticleEditorRecoveredDraft {
  draftSeq: number;
  baseRevisionId: string;
  baseContentHash: string;
}

function checkpointPrefix(spaceId: string, articleId: string) {
  return `${storagePrefix}:${encodeURIComponent(spaceId)}:${encodeURIComponent(articleId)}:`;
}

function checkpointKey(prefix: string, sessionEpoch: string) {
  return `${prefix}${encodeURIComponent(sessionEpoch)}`;
}

function storageKeys(storage: Storage, prefix: string) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function parseCheckpoint(serialized: string | null) {
  if (!serialized || serialized.length > maxStoredCheckpointCharacters) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    const parsed = articleEditorRecoveryCheckpointSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sameContent(left: ArticleContentInput, right: ArticleContentInput) {
  return canonicalArticleContentJson(left) === canonicalArticleContentJson(right);
}

function copyDraft(checkpoint: RecoveryCheckpoint): ArticleEditorRecoveredDraft {
  return {
    content: articleContentSchema.parse(checkpoint.content),
    media: checkpoint.media.map((item) => ({ ...item })),
    elements: checkpoint.elements.map((item) => ({ ...item })),
    commentAnchors: (checkpoint.commentAnchors ?? []).map((item) => ({ ...item, anchor: { ...item.anchor } })),
  };
}

function sameCheckpointAsArticle(
  checkpoint: RecoveryCheckpoint,
  article: ArticleDto,
  currentContent: ArticleContentInput,
) {
  if (!sameContent(checkpoint.content, currentContent)) return false;
  if (!sameArticleElementPlacements(checkpoint.elements, article.elements)) return false;
  return (
    !checkpoint.commentAnchors ||
    articleCommentAnchorUpdatesAreApplied(checkpoint.commentAnchors, articleCommentAnchorUpdates(article.comments))
  );
}

function sameCheckpointAsRequest(checkpoint: RecoveryCheckpoint, input: ArticleRevisionSaveInput) {
  if (!sameContent(checkpoint.content, input.content)) return false;
  if (input.elements && !sameArticleElementPlacements(checkpoint.elements, input.elements)) return false;
  return (
    !input.commentAnchors || sameArticleCommentAnchorUpdates(checkpoint.commentAnchors ?? [], input.commentAnchors)
  );
}

function recoverableFromCurrent(checkpoint: RecoveryCheckpoint, article: ArticleDto) {
  if (checkpoint.baseRevisionId === article.revisionId && checkpoint.baseContentHash === article.contentHash) {
    return true;
  }
  return (
    checkpoint.pendingSave?.expectedRevisionId === checkpoint.baseRevisionId &&
    checkpoint.pendingSave.contentHash === article.contentHash
  );
}

export class ArticleEditorRecoveryStore {
  readonly #storage: Storage | null;
  readonly #prefix: string;
  readonly #key: string;
  readonly #spaceId: string;
  readonly #articleId: string;
  readonly #sessionEpoch: string;
  readonly #onError: () => void;
  #checkpoint: RecoveryCheckpoint | null = null;
  #sourceCheckpoint: { sessionEpoch: string; localKey: string | null } | null = null;
  #pendingCheckpoint: RecoveryCheckpoint | null = null;
  #writeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  #writeInFlight: Promise<boolean> | null = null;
  #mutationTail: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(spaceId: string, articleId: string, sessionEpoch: string, onError: () => void) {
    this.#spaceId = spaceId;
    this.#articleId = articleId;
    this.#sessionEpoch = sessionEpoch;
    this.#onError = onError;
    this.#prefix = checkpointPrefix(spaceId, articleId);
    this.#key = checkpointKey(this.#prefix, sessionEpoch);
    try {
      this.#storage = window.localStorage;
    } catch {
      this.#storage = null;
    }
  }

  async load(article: ArticleDto): Promise<ArticleEditorRecoveryResult> {
    if (article.id !== this.#articleId) throw new Error('Article editor recovery identity mismatch');
    const currentContent = editableArticleContent(article);
    const checkpoints = new Map<string, { key: string | null; checkpoint: RecoveryCheckpoint }>();
    const acceptCandidate = (key: string | null, checkpoint: RecoveryCheckpoint) => {
      const existing = checkpoints.get(checkpoint.sessionEpoch);
      if (!existing || checkpoint.updatedAt >= existing.checkpoint.updatedAt) {
        checkpoints.set(checkpoint.sessionEpoch, {
          key: key ?? existing?.key ?? null,
          checkpoint,
        });
      }
    };
    try {
      (await window.desktopApi.articleEditorRecoveryList({ spaceId: this.#spaceId, articleId: article.id })).forEach(
        (checkpoint) => acceptCandidate(null, checkpoint),
      );
    } catch {
      this.#onError();
    }
    const storage = this.#storage;
    if (storage) {
      try {
        for (const key of storageKeys(storage, this.#prefix)) {
          const checkpoint = parseCheckpoint(storage.getItem(key));
          if (!checkpoint || checkpoint.spaceId !== this.#spaceId || checkpoint.articleId !== article.id) {
            storage.removeItem(key);
            continue;
          }
          acceptCandidate(key, checkpoint);
        }
      } catch {
        // The durable main-process checkpoint remains authoritative.
      }
    }

    const candidates: ({ key: string | null; checkpoint: RecoveryCheckpoint } & { recoverable: boolean })[] = [];
    for (const candidate of checkpoints.values()) {
      if (sameCheckpointAsArticle(candidate.checkpoint, article, currentContent)) {
        await this.#removeStoredCheckpoint(candidate.checkpoint.sessionEpoch, candidate.key);
        continue;
      }
      candidates.push({ ...candidate, recoverable: recoverableFromCurrent(candidate.checkpoint, article) });
    }
    const ordered = candidates.sort((left, right) => right.checkpoint.updatedAt - left.checkpoint.updatedAt);
    if (!ordered.length) {
      return { kind: 'none' };
    }
    const selected = ordered.find((candidate) => candidate.recoverable);
    if (!selected) {
      const conflict = ordered[0];
      this.#sourceCheckpoint = {
        sessionEpoch: conflict.checkpoint.sessionEpoch,
        localKey: conflict.key,
      };
      return {
        kind: 'conflict',
        draft: copyDraft(conflict.checkpoint),
        updatedAt: conflict.checkpoint.updatedAt,
      };
    }

    const resumeWithoutPrompt = sameContent(selected.checkpoint.content, currentContent);
    this.#checkpoint = {
      ...selected.checkpoint,
      sessionEpoch: this.#sessionEpoch,
      baseRevisionId: article.revisionId,
      baseContentHash: article.contentHash,
      pendingSave: null,
      updatedAt: Date.now(),
    };
    this.#pendingCheckpoint = this.#checkpoint;
    const migrated = await this.flush();
    if (selected.checkpoint.sessionEpoch !== this.#sessionEpoch) {
      if (migrated) await this.#removeStoredCheckpoint(selected.checkpoint.sessionEpoch, selected.key);
      else {
        this.#sourceCheckpoint = {
          sessionEpoch: selected.checkpoint.sessionEpoch,
          localKey: selected.key,
        };
      }
    }
    return {
      kind: resumeWithoutPrompt ? 'resumed' : 'restored',
      draft: copyDraft(this.#checkpoint),
      updatedAt: selected.checkpoint.updatedAt,
    };
  }

  record(input: RecordDraftInput) {
    if (this.#disposed) return false;
    this.#checkpoint = {
      schemaVersion: 1,
      spaceId: this.#spaceId,
      articleId: this.#articleId,
      sessionEpoch: this.#sessionEpoch,
      draftSeq: input.draftSeq,
      baseRevisionId: input.baseRevisionId,
      baseContentHash: input.baseContentHash,
      content: input.content,
      media: input.media.map((item) => ({ ...item })),
      elements: input.elements.map((item) => ({ ...item })),
      commentAnchors: input.commentAnchors.map((item) => ({ ...item, anchor: { ...item.anchor } })),
      pendingSave: this.#checkpoint?.pendingSave ?? null,
      updatedAt: Date.now(),
    };
    this.#queueWrite(this.#checkpoint);
    return true;
  }

  markPending(input: ArticleRevisionSaveInput) {
    const checkpoint = this.#checkpoint;
    if (!checkpoint || checkpoint.sessionEpoch !== input.sessionEpoch) return true;
    this.#checkpoint = {
      ...checkpoint,
      pendingSave: {
        requestId: input.requestId,
        expectedRevisionId: input.expectedRevisionId,
        contentHash: input.contentHash,
      },
      updatedAt: Date.now(),
    };
    this.#queueWrite(this.#checkpoint);
    return true;
  }

  acknowledge(input: ArticleRevisionSaveInput, article: ArticleDto) {
    const checkpoint = this.#checkpoint;
    if (!checkpoint || checkpoint.sessionEpoch !== input.sessionEpoch) return true;
    if (checkpoint.draftSeq <= input.draftSeq && sameCheckpointAsRequest(checkpoint, input)) {
      void this.clear();
      return true;
    }
    this.#checkpoint = {
      ...checkpoint,
      baseRevisionId: article.revisionId,
      baseContentHash: article.contentHash,
      pendingSave: checkpoint.pendingSave?.requestId === input.requestId ? null : checkpoint.pendingSave,
      updatedAt: Date.now(),
    };
    this.#queueWrite(this.#checkpoint);
    return true;
  }

  async clear() {
    this.#checkpoint = null;
    this.#pendingCheckpoint = null;
    this.#cancelTimer();
    const removals = [this.#removeStoredCheckpoint(this.#sessionEpoch, this.#key)];
    if (this.#sourceCheckpoint) {
      removals.push(this.#removeStoredCheckpoint(this.#sourceCheckpoint.sessionEpoch, this.#sourceCheckpoint.localKey));
    }
    const successful = (await Promise.all(removals)).every(Boolean);
    if (successful) this.#sourceCheckpoint = null;
    return successful;
  }

  async flush() {
    if (this.#disposed) return !this.#pendingCheckpoint && !this.#writeInFlight;
    this.#cancelTimer();
    let successful = true;
    while (this.#pendingCheckpoint || this.#writeInFlight) {
      const result = await (this.#writeInFlight ?? this.#writeOnce());
      successful &&= result;
      if (!result) break;
    }
    try {
      await this.#mutationTail;
    } catch {
      successful = false;
    }
    return successful;
  }

  dispose() {
    this.#disposed = true;
    this.#cancelTimer();
  }

  async #removeStoredCheckpoint(sessionEpoch: string, localKey: string | null) {
    let successful = true;
    try {
      const keys = new Set([checkpointKey(this.#prefix, sessionEpoch), ...(localKey ? [localKey] : [])]);
      keys.forEach((key) => this.#storage?.removeItem(key));
    } catch {
      successful = false;
      this.#onError();
    }
    try {
      await this.#enqueueMutation(() =>
        window.desktopApi.articleEditorRecoveryRemove({
          spaceId: this.#spaceId,
          articleId: this.#articleId,
          sessionEpoch,
        }),
      );
    } catch {
      successful = false;
      this.#onError();
    }
    return successful;
  }

  #queueWrite(checkpoint: RecoveryCheckpoint) {
    this.#pendingCheckpoint = checkpoint;
    this.#cancelTimer();
    this.#writeTimer = globalThis.setTimeout(() => {
      this.#writeTimer = null;
      void this.#writeAfterInFlight();
    }, recoveryWriteIdleMs);
  }

  async #writeAfterInFlight() {
    if (this.#writeInFlight && !(await this.#writeInFlight)) return;
    if (!this.#disposed && this.#pendingCheckpoint) await this.#writeOnce();
  }

  #writeOnce() {
    if (this.#writeInFlight) return this.#writeInFlight;
    const checkpoint = this.#pendingCheckpoint;
    if (!checkpoint) return Promise.resolve(true);
    if (this.#disposed) return Promise.resolve(false);
    this.#pendingCheckpoint = null;
    let scheduleTrailing = true;
    const pending = this.#enqueueMutation(() => window.desktopApi.articleEditorRecoveryWrite(checkpoint))
      .then(() => true)
      .catch(() => {
        if (
          this.#checkpoint === checkpoint &&
          (!this.#pendingCheckpoint || this.#pendingCheckpoint.updatedAt <= checkpoint.updatedAt)
        ) {
          this.#pendingCheckpoint = checkpoint;
          scheduleTrailing = false;
        }
        this.#onError();
        return false;
      })
      .finally(() => {
        if (this.#writeInFlight === pending) this.#writeInFlight = null;
        if (scheduleTrailing && !this.#disposed && this.#pendingCheckpoint && this.#writeTimer === null) {
          this.#writeTimer = globalThis.setTimeout(() => {
            this.#writeTimer = null;
            void this.#writeAfterInFlight();
          }, recoveryWriteIdleMs);
        }
      });
    this.#writeInFlight = pending;
    return pending;
  }

  #enqueueMutation(operation: () => Promise<void>) {
    const pending = this.#mutationTail.catch(() => undefined).then(operation);
    this.#mutationTail = pending;
    return pending;
  }

  #cancelTimer() {
    if (this.#writeTimer === null) return;
    globalThis.clearTimeout(this.#writeTimer);
    this.#writeTimer = null;
  }
}
