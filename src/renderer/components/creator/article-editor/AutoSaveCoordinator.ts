import type {
  ArticleContentInput,
  ArticleCommentAnchorUpdateInput,
  ArticleDto,
  ArticleElementPlacementInput,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
} from '@/shared/contracts';
import { articleRevisionMatchesArticle, normalizeArticleContent } from '@/shared/article-revision';
import {
  articleEditorSaveResultMatches,
  type ArticleSaveMode,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import { ArticleEditorSessionModel } from '@/renderer/components/creator/article-editor/ArticleEditorSessionModel';
import { createArticleRevisionSaveRequest } from '@/renderer/components/creator/article-editor/articleRevisionRequest';

export const ARTICLE_AUTOSAVE_IDLE_MS = 650;

interface AutoSaveScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

interface CapturedDraft {
  readonly content: ArticleContentInput;
  readonly elements: ArticleElementPlacementInput[] | null;
  readonly commentAnchors: ArticleCommentAnchorUpdateInput[] | null;
  readonly draftSeq: number;
  readonly cause: ArticleRevisionSaveInput['cause'];
}

interface AutoSaveCoordinatorOptions {
  session: ArticleEditorSessionModel;
  readSnapshot(): ArticleContentInput;
  readElements?(): readonly ArticleElementPlacementInput[];
  readCommentAnchors?(): readonly ArticleCommentAnchorUpdateInput[];
  prepareForSave?(): void;
  persist(input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult>;
  onDraftCaptured?(draft: CapturedDraft): void;
  onAcknowledged(article: ArticleDto, request: ArticleRevisionSaveInput): void;
  onConflict(conflict: Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>): void;
  onError(mode: ArticleSaveMode, detail: string): void;
  idleDelayMs?: number;
  scheduler?: AutoSaveScheduler;
  createRequest?: typeof createArticleRevisionSaveRequest;
}

const defaultScheduler: AutoSaveScheduler = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export class AutoSaveCoordinator {
  readonly #options: AutoSaveCoordinatorOptions;
  readonly #session: ArticleEditorSessionModel;
  readonly #scheduler: AutoSaveScheduler;
  #timer: unknown = null;
  #savePromise: Promise<boolean> | null = null;
  // Retain only an immutable queued snapshot and an unconfirmed request.
  // A newer edit replaces the queued snapshot; it never replaces an uncertain save.
  #pendingDraft: CapturedDraft | null = null;
  #unacknowledgedRequest: ArticleRevisionSaveInput | null = null;
  #disposed = false;

  constructor(options: AutoSaveCoordinatorOptions) {
    this.#options = options;
    this.#session = options.session;
    this.#scheduler = options.scheduler ?? defaultScheduler;
  }

  noteChange(snapshot: ArticleContentInput, cause: ArticleRevisionSaveInput['cause'] = 'EDITOR') {
    if (this.#disposed) return this.#session.getSnapshot().draft.sequence;
    const content = normalizeArticleContent(snapshot);
    const elements = this.#options.readElements?.().map((element) => ({ ...element })) ?? null;
    const commentAnchors =
      this.#options.readCommentAnchors?.().map((item) => ({ ...item, anchor: { ...item.anchor } })) ?? null;
    const draftSeq = this.#session.beginDraft(Boolean(content.markdown.trim()));
    const draft = { content, elements, commentAnchors, draftSeq, cause };
    this.#pendingDraft = draft;
    this.#options.onDraftCaptured?.(draft);
    if (!this.#savePromise && this.#session.getSnapshot().save.phase !== 'conflict') this.#schedule();
    return draftSeq;
  }

  flush(mode: ArticleSaveMode = 'manual', cause: ArticleRevisionSaveInput['cause'] = 'EDITOR') {
    if (this.#disposed) return Promise.resolve(false);
    if (mode === 'manual') {
      try {
        this.#options.prepareForSave?.();
        this.noteChange(this.#options.readSnapshot(), cause);
      } catch (reason) {
        this.#options.onError(mode, errorMessage(reason));
        return Promise.resolve(false);
      }
    }
    return this.#flush(mode);
  }

  retry() {
    return this.#flush('manual');
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelTimer();
    this.#pendingDraft = null;
    this.#unacknowledgedRequest = null;
    this.#session.dispose();
  }

  async #flush(mode: ArticleSaveMode) {
    this.#cancelTimer();
    do {
      if (!(await this.#ensureSave(mode))) return false;
      this.#cancelTimer();
    } while (this.#pendingDraft || this.#unacknowledgedRequest);
    return !this.#disposed;
  }

  #schedule() {
    this.#cancelTimer();
    this.#timer = this.#scheduler.set(() => {
      this.#timer = null;
      void this.#ensureSave('auto');
    }, this.#options.idleDelayMs ?? ARTICLE_AUTOSAVE_IDLE_MS);
  }

  #cancelTimer() {
    if (this.#timer === null) return;
    this.#scheduler.clear(this.#timer);
    this.#timer = null;
  }

  #ensureSave(mode: ArticleSaveMode): Promise<boolean> {
    if (this.#disposed || this.#session.getSnapshot().save.phase === 'conflict') return Promise.resolve(false);
    if (this.#savePromise) return this.#savePromise;
    if (!this.#unacknowledgedRequest && !this.#pendingDraft) return Promise.resolve(true);
    let successful = false;
    const pending = Promise.resolve()
      .then(async () => {
        successful = await this.#saveOnce(mode);
        return successful;
      })
      .finally(() => {
        this.#savePromise = null;
        if (successful && !this.#disposed && this.#pendingDraft && this.#session.getSnapshot().save.phase === 'idle') {
          this.#schedule();
        }
      });
    this.#savePromise = pending;
    return pending;
  }

  async #newRequest() {
    this.#options.prepareForSave?.();
    const draft = this.#pendingDraft;
    if (!draft) return null;
    const state = this.#session.getSnapshot();
    const request = await (this.#options.createRequest ?? createArticleRevisionSaveRequest)(draft.content, {
      articleId: state.session.articleId,
      cause: draft.cause,
      expectedRevisionId: state.persisted.revisionId,
      sessionEpoch: state.session.epoch,
      draftSeq: draft.draftSeq,
    });
    return {
      ...request,
      ...(draft.elements ? { elements: draft.elements } : {}),
      ...(draft.commentAnchors ? { commentAnchors: draft.commentAnchors } : {}),
    };
  }

  async #saveOnce(mode: ArticleSaveMode) {
    let request: ArticleRevisionSaveInput | null;
    try {
      request = this.#unacknowledgedRequest ?? (await this.#newRequest());
    } catch (reason) {
      if (!this.#disposed) this.#options.onError(mode, errorMessage(reason));
      return false;
    }
    if (!request) return !this.#disposed;
    if (!this.#session.beginSave(request)) return false;
    this.#unacknowledgedRequest = request;
    try {
      const result = await this.#options.persist(request);
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
        this.#unacknowledgedRequest = null;
        if (this.#session.enterConflict(request, result)) this.#options.onConflict(result);
        return false;
      }
      if (result.contentHash !== request.contentHash || !articleRevisionMatchesArticle(request, result.article)) {
        throw new Error('Article save acknowledgement content does not match the request');
      }
      if (!this.#session.acknowledgeSave(request, result.article)) return false;
      this.#unacknowledgedRequest = null;
      if (this.#pendingDraft && this.#pendingDraft.draftSeq <= request.draftSeq) this.#pendingDraft = null;
      try {
        this.#options.onAcknowledged(result.article, request);
      } catch (reason) {
        this.#options.onError(mode, errorMessage(reason));
      }
      return true;
    } catch (reason) {
      const detail = errorMessage(reason);
      if (this.#session.failSave(request, mode, detail)) this.#options.onError(mode, detail);
      return false;
    }
  }
}
