import type {
  ArticleContentInput,
  ArticleCommentAnchorUpdateInput,
  ArticleDto,
  ArticleElementPlacementInput,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
} from '@/shared/contracts';
import {
  canonicalArticleContentJson,
  sameArticleCommentAnchorUpdates,
  sameArticleElementPlacements,
} from '@/shared/contracts/article';
import {
  articleEditorSessionDirty,
  articleEditorSaveResultMatches,
  type ArticleSaveMode,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import { ArticleEditorSessionModel } from '@/renderer/components/creator/article-editor/ArticleEditorSessionModel';
import { createArticleRevisionSaveRequest } from '@/renderer/components/creator/article-editor/articleRevisionRequest';
import { sha256Hex } from '@/renderer/lib/sha256Hex';

export const ARTICLE_AUTOSAVE_IDLE_MS = 650;

interface AutoSaveScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

interface SaveRequestIdentity {
  articleId: string;
  cause: ArticleRevisionSaveInput['cause'];
  expectedRevisionId: string;
  requestId?: string;
  sessionEpoch: string;
  draftSeq: number;
}

interface CapturedDraftAuxiliary {
  elements: readonly ArticleElementPlacementInput[];
  commentAnchors: readonly ArticleCommentAnchorUpdateInput[];
}

interface AutoSaveCoordinatorOptions {
  session: ArticleEditorSessionModel;
  readSnapshot(): ArticleContentInput;
  readElements?(): readonly ArticleElementPlacementInput[];
  readCommentAnchors?(): readonly ArticleCommentAnchorUpdateInput[];
  prepareForSave?(): void;
  persist(input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult>;
  onAcknowledged(article: ArticleDto, request: ArticleRevisionSaveInput): void;
  onUnchanged?(request: ArticleRevisionSaveInput): void;
  onConflict(conflict: Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>): void;
  onError(mode: ArticleSaveMode, detail: string): void;
  requestMatchesPersisted?(request: ArticleRevisionSaveInput): boolean;
  acknowledgementMatchesRequest?(request: ArticleRevisionSaveInput, article: ArticleDto): boolean;
  idleDelayMs?: number;
  scheduler?: AutoSaveScheduler;
  createRequest?(snapshot: ArticleContentInput, identity: SaveRequestIdentity): Promise<ArticleRevisionSaveInput>;
}

const defaultScheduler: AutoSaveScheduler = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function requestMatchesDraft(
  request: ArticleRevisionSaveInput,
  snapshot: ArticleContentInput,
  elements: readonly ArticleElementPlacementInput[] | null,
  commentAnchors: readonly ArticleCommentAnchorUpdateInput[] | null,
) {
  if (canonicalArticleContentJson(request.content) !== canonicalArticleContentJson(snapshot)) return false;
  if (elements && (!request.elements || !sameArticleElementPlacements(request.elements, elements))) return false;
  return (
    !commentAnchors ||
    Boolean(request.commentAnchors && sameArticleCommentAnchorUpdates(request.commentAnchors, commentAnchors))
  );
}

export class AutoSaveCoordinator {
  readonly #session: ArticleEditorSessionModel;
  readonly #readSnapshot: () => ArticleContentInput;
  readonly #persist: (input: ArticleRevisionSaveInput) => Promise<ArticleRevisionSaveResult>;
  readonly #readElements: (() => readonly ArticleElementPlacementInput[]) | null;
  readonly #readCommentAnchors: (() => readonly ArticleCommentAnchorUpdateInput[]) | null;
  readonly #prepareForSave: (() => void) | null;
  readonly #onAcknowledged: (article: ArticleDto, request: ArticleRevisionSaveInput) => void;
  readonly #onUnchanged: ((request: ArticleRevisionSaveInput) => void) | null;
  readonly #onConflict: (conflict: Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>) => void;
  readonly #onError: (mode: ArticleSaveMode, detail: string) => void;
  readonly #requestMatchesPersisted: ((request: ArticleRevisionSaveInput) => boolean) | null;
  readonly #acknowledgementMatchesRequest: ((request: ArticleRevisionSaveInput, article: ArticleDto) => boolean) | null;
  readonly #idleDelayMs: number;
  readonly #scheduler: AutoSaveScheduler;
  readonly #createRequest: NonNullable<AutoSaveCoordinatorOptions['createRequest']>;
  #timer: unknown = null;
  #drainPromise: Promise<boolean> | null = null;
  #retryRequest: ArticleRevisionSaveInput | null = null;
  #trailingRequested = false;
  #flushDrainRequested = false;
  #disposed = false;
  #latestSnapshot: ArticleContentInput | null = null;
  #latestElements: ArticleElementPlacementInput[] | null = null;
  #latestCommentAnchors: ArticleCommentAnchorUpdateInput[] | null = null;
  #pendingChangeSequence: number | null = null;

  constructor(options: AutoSaveCoordinatorOptions) {
    this.#session = options.session;
    this.#readSnapshot = options.readSnapshot;
    this.#readElements = options.readElements ?? null;
    this.#readCommentAnchors = options.readCommentAnchors ?? null;
    this.#prepareForSave = options.prepareForSave ?? null;
    this.#persist = options.persist;
    this.#onAcknowledged = options.onAcknowledged;
    this.#onUnchanged = options.onUnchanged ?? null;
    this.#onConflict = options.onConflict;
    this.#onError = options.onError;
    this.#requestMatchesPersisted = options.requestMatchesPersisted ?? null;
    this.#acknowledgementMatchesRequest = options.acknowledgementMatchesRequest ?? null;
    this.#idleDelayMs = options.idleDelayMs ?? ARTICLE_AUTOSAVE_IDLE_MS;
    this.#scheduler = options.scheduler ?? defaultScheduler;
    this.#createRequest = options.createRequest ?? createArticleRevisionSaveRequest;
  }

  noteChange(
    snapshot: ArticleContentInput,
    beforeSchedule?: (draftSeq: number, auxiliary: CapturedDraftAuxiliary) => void,
  ) {
    if (this.#disposed) return;
    const capturedSnapshot = {
      ...snapshot,
      mediaBindings: snapshot.mediaBindings.map((binding) => ({ ...binding })),
    };
    const elements = this.#readElements?.().map((element) => ({ ...element })) ?? null;
    const commentAnchors =
      this.#readCommentAnchors?.().map((item) => ({ ...item, anchor: { ...item.anchor } })) ?? null;
    this.#latestSnapshot = capturedSnapshot;
    this.#latestElements = elements;
    this.#latestCommentAnchors = commentAnchors;
    const draftSeq = this.#session.beginDraft(Boolean(snapshot.markdown.trim()));
    this.#pendingChangeSequence = draftSeq;
    beforeSchedule?.(draftSeq, { elements: elements ?? [], commentAnchors: commentAnchors ?? [] });
    void sha256Hex(canonicalArticleContentJson(snapshot))
      .then((contentHash) => this.#session.resolveDraftHash(draftSeq, contentHash))
      .catch((reason: unknown) => {
        if (!this.#disposed) this.#onError('auto', errorMessage(reason));
      });
    if (this.#drainPromise) {
      this.#trailingRequested = true;
      return;
    }
    const next = this.#session.getSnapshot();
    if (next.save.phase !== 'failed' && next.save.phase !== 'conflict') this.#schedule();
  }

  flush(mode: ArticleSaveMode = 'manual', cause: ArticleRevisionSaveInput['cause'] = 'EDITOR') {
    if (mode === 'manual') this.noteChange(this.#readSnapshot());
    this.#cancelTimer();
    this.#flushDrainRequested = true;
    if (this.#drainPromise) {
      this.#trailingRequested = true;
    }
    return this.#ensureDrain(mode, cause);
  }

  retry() {
    return this.flush('manual');
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelTimer();
    this.#session.dispose();
  }

  #schedule() {
    this.#cancelTimer();
    this.#timer = this.#scheduler.set(() => {
      this.#timer = null;
      void this.#ensureDrain('auto', 'EDITOR');
    }, this.#idleDelayMs);
  }

  #cancelTimer() {
    if (this.#timer === null) return;
    this.#scheduler.clear(this.#timer);
    this.#timer = null;
  }

  #ensureDrain(mode: ArticleSaveMode, cause: ArticleRevisionSaveInput['cause']): Promise<boolean> {
    if (this.#disposed || this.#session.getSnapshot().save.phase === 'conflict') return Promise.resolve(false);
    if (this.#drainPromise) return this.#drainPromise;
    if (
      mode === 'auto' &&
      !this.#retryRequest &&
      this.#pendingChangeSequence === null &&
      !articleEditorSessionDirty(this.#session.getSnapshot())
    ) {
      // A clean lifecycle flush with no captured editor change must not persist
      // incidental projections such as comment-anchor relocation.
      this.#flushDrainRequested = false;
      return Promise.resolve(true);
    }
    const pending = this.#drain(mode, cause).finally(() => {
      if (this.#drainPromise === pending) this.#drainPromise = null;
    });
    this.#drainPromise = pending;
    return pending;
  }

  async #drain(mode: ArticleSaveMode, cause: ArticleRevisionSaveInput['cause']) {
    let nextCause = cause;
    do {
      this.#trailingRequested = false;
      if (!(await this.#saveOnce(mode, nextCause))) return false;
      nextCause = 'EDITOR';
      const state = this.#session.getSnapshot();
      if (
        this.#disposed ||
        state.lifecycle === 'disposed' ||
        state.save.phase === 'failed' ||
        state.save.phase === 'conflict'
      ) {
        return false;
      }
      if (!this.#trailingRequested && !articleEditorSessionDirty(state)) {
        this.#flushDrainRequested = false;
        return true;
      }
      if (mode === 'auto' && !this.#flushDrainRequested) {
        this.#schedule();
        return true;
      }
      this.#flushDrainRequested = false;
    } while (!this.#disposed);
    return false;
  }

  async #newRequest(cause: ArticleRevisionSaveInput['cause']) {
    const before = this.#session.getSnapshot();
    const identity: SaveRequestIdentity = {
      articleId: before.session.articleId,
      cause,
      expectedRevisionId: before.persisted.revisionId,
      sessionEpoch: before.session.epoch,
      draftSeq: before.draft.sequence,
    };
    const sourceSnapshot = this.#latestSnapshot ?? this.#readSnapshot();
    const snapshot = {
      ...sourceSnapshot,
      mediaBindings: sourceSnapshot.mediaBindings.map((binding) => ({ ...binding })),
    };
    const elements = this.#latestElements ?? this.#readElements?.().map((element) => ({ ...element })) ?? null;
    const commentAnchors =
      this.#latestCommentAnchors ??
      this.#readCommentAnchors?.().map((item) => ({ ...item, anchor: { ...item.anchor } })) ??
      null;
    const capturedElements = elements?.map((element) => ({ ...element })) ?? null;
    const capturedCommentAnchors = commentAnchors?.map((item) => ({ ...item, anchor: { ...item.anchor } })) ?? null;
    const contentRequest = await this.#createRequest(snapshot, identity);
    const request = {
      ...contentRequest,
      ...(capturedElements ? { elements: capturedElements } : {}),
      ...(capturedCommentAnchors ? { commentAnchors: capturedCommentAnchors } : {}),
    };
    const after = this.#session.getSnapshot();
    if (this.#disposed || after.lifecycle === 'disposed' || after.session.epoch !== identity.sessionEpoch) return null;
    this.#session.resolveDraftHash(identity.draftSeq, request.contentHash);
    if (
      this.#requestMatchesPersisted
        ? this.#requestMatchesPersisted(request)
        : request.contentHash === after.persisted.contentHash
    ) {
      this.#settlePendingChange(identity.draftSeq);
      this.#onUnchanged?.(request);
      return null;
    }
    return request;
  }

  #settlePendingChange(draftSeq: number) {
    if (this.#pendingChangeSequence !== null && this.#pendingChangeSequence <= draftSeq) {
      this.#pendingChangeSequence = null;
    }
  }

  async #saveOnce(mode: ArticleSaveMode, cause: ArticleRevisionSaveInput['cause']) {
    let request: ArticleRevisionSaveInput | null;
    try {
      this.#prepareForSave?.();
      request = this.#retryRequest;
      if (!request) {
        request = await this.#newRequest(cause);
      }
    } catch (reason) {
      if (!this.#disposed) this.#onError(mode, errorMessage(reason));
      return false;
    }
    if (!request) return true;
    if (!this.#session.beginSave(request)) return false;
    try {
      const result = await this.#persist(request);
      if (!articleEditorSaveResultMatches(request, result)) {
        throw new Error('Article save acknowledgement identity does not match the request');
      }
      if (result.status === 'CONFLICT') {
        if (
          result.expectedRevisionId !== request.expectedRevisionId ||
          result.currentArticle.id !== request.articleId
        ) {
          throw new Error('Article conflict acknowledgement does not match the request');
        }
        this.#retryRequest = null;
        if (this.#session.enterConflict(request, result)) {
          this.#onConflict(result);
        }
        return false;
      }
      if (
        result.contentHash !== request.contentHash ||
        result.article.id !== request.articleId ||
        (this.#acknowledgementMatchesRequest && !this.#acknowledgementMatchesRequest(request, result.article))
      ) {
        throw new Error('Article save acknowledgement content does not match the request');
      }
      this.#retryRequest = null;
      if (!this.#session.acknowledgeSave(request, result.article)) return false;
      this.#settlePendingChange(request.draftSeq);
      if (this.#session.getSnapshot().draft.sequence > request.draftSeq) this.#trailingRequested = true;
      try {
        this.#onAcknowledged(result.article, request);
      } catch (reason) {
        this.#onError(mode, errorMessage(reason));
      }
      return true;
    } catch (reason) {
      const detail = errorMessage(reason);
      this.#retryRequest =
        this.#latestSnapshot &&
        !requestMatchesDraft(request, this.#latestSnapshot, this.#latestElements, this.#latestCommentAnchors)
          ? null
          : request;
      if (this.#session.failSave(request, mode, detail)) this.#onError(mode, detail);
      return false;
    }
  }
}
