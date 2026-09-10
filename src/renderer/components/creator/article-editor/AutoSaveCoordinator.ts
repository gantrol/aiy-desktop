import type {
  ArticleContentInput,
  ArticleCommentAnchorUpdateInput,
  ArticleDto,
  ArticleElementPlacementInput,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
} from '@/shared/contracts';
import { articleRevisionMatchesArticle, normalizeArticleContent } from '@/shared/article-revision';
import { articleContentSchema } from '@/shared/contracts/article';
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

/** One editor publication: content and positions must describe the same document. */
export interface ArticleEditorDraftSnapshot extends ArticleContentInput {
  elements?: readonly ArticleElementPlacementInput[];
  commentAnchors?: readonly ArticleCommentAnchorUpdateInput[];
}

interface AutoSaveCoordinatorOptions {
  session: ArticleEditorSessionModel;
  readSnapshot(): ArticleEditorDraftSnapshot;
  whenSettled?(): Promise<boolean>;
  persist(input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult>;
  onDraftCaptured?(draft: CapturedDraft): void;
  onAcknowledged(article: ArticleDto, request: ArticleRevisionSaveInput): void;
  onConflict(conflict: Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>): void;
  onError(mode: ArticleSaveMode, detail: string): void;
  onIdle?(): void;
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
  #operationTail: Promise<unknown> = Promise.resolve();
  #pendingOperations = 0;
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

  noteChange(snapshot: ArticleEditorDraftSnapshot, cause: ArticleRevisionSaveInput['cause'] = 'EDITOR') {
    if (this.#disposed) return this.#session.getSnapshot().draft.sequence;
    const { elements: snapshotElements, commentAnchors: snapshotAnchors, ...input } = snapshot;
    const content = articleContentSchema.parse(input);
    const elements = snapshotElements?.map((element) => ({ ...element })) ?? null;
    const commentAnchors = snapshotAnchors?.map((item) => ({ ...item, anchor: { ...item.anchor } })) ?? null;
    const previous = this.#pendingDraft;
    if (
      previous &&
      JSON.stringify([previous.content, previous.elements, previous.commentAnchors]) ===
        JSON.stringify([content, elements, commentAnchors])
    )
      return previous.draftSeq;
    const draftSeq = this.#session.beginDraft(Boolean(content.markdown.trim()));
    const draft = { content, elements, commentAnchors, draftSeq, cause };
    this.#pendingDraft = draft;
    this.#options.onDraftCaptured?.(draft);
    if (!this.busy && this.#session.getSnapshot().save.phase !== 'conflict') this.#schedule();
    return draftSeq;
  }

  flush(mode: ArticleSaveMode = 'manual', cause: ArticleRevisionSaveInput['cause'] = 'EDITOR') {
    if (this.#disposed) return Promise.resolve(false);
    return this.#enqueue(async () => {
      try {
        if (this.#options.whenSettled && !(await this.#options.whenSettled())) return false;
        if (mode === 'manual') this.noteChange(this.#options.readSnapshot(), cause);
      } catch (reason) {
        this.#session.failPreparation(mode, errorMessage(reason));
        this.#options.onError(mode, errorMessage(reason));
        return false;
      }
      return this.#flush(mode);
    });
  }

  retry() {
    return this.flush('manual');
  }

  get busy() {
    return this.#pendingOperations > 0;
  }

  /** Comments and document revisions share a single write lane. */
  mutate<T>(operation: () => Promise<T>): Promise<T | null> {
    return this.#enqueue(async () => {
      if (this.#disposed) return null;
      if (this.#options.whenSettled && !(await this.#options.whenSettled())) return null;
      this.noteChange(this.#options.readSnapshot());
      if (!(await this.#flush('manual'))) return null;
      return operation();
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.#cancelTimer();
    this.#pendingOperations += 1;
    const pending = this.#operationTail.then(operation).finally(() => {
      this.#pendingOperations -= 1;
      if (!this.busy) this.#options.onIdle?.();
      if (!this.#disposed && !this.busy && this.#pendingDraft && this.#session.getSnapshot().save.phase === 'idle') {
        this.#schedule();
      }
    });
    this.#operationTail = pending.catch(() => undefined);
    return pending;
  }

  reset() {
    if (this.busy) return false;
    this.#cancelTimer();
    this.#pendingDraft = null;
    this.#unacknowledgedRequest = null;
    return true;
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
      if (
        this.#disposed ||
        this.#session.getSnapshot().save.phase === 'conflict' ||
        this.#session.getSnapshot().externalArticle
      )
        return false;
      if (!(await this.#saveOnce(mode))) return false;
      this.#cancelTimer();
    } while (this.#pendingDraft || this.#unacknowledgedRequest);
    return !this.#disposed;
  }

  #schedule() {
    this.#cancelTimer();
    this.#timer = this.#scheduler.set(() => {
      this.#timer = null;
      void this.flush('auto');
    }, this.#options.idleDelayMs ?? ARTICLE_AUTOSAVE_IDLE_MS);
  }

  #cancelTimer() {
    if (this.#timer === null) return;
    this.#scheduler.clear(this.#timer);
    this.#timer = null;
  }

  async #newRequest() {
    const draft = this.#pendingDraft;
    if (!draft) return null;
    this.#session.beginPreparation(draft.draftSeq);
    if (normalizeArticleContent(draft.content).markdown !== draft.content.markdown) {
      throw new Error('An article image is unavailable. Import or remove it before saving.');
    }
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
      if (!this.#disposed) {
        this.#session.failPreparation(mode, errorMessage(reason));
        this.#options.onError(mode, errorMessage(reason));
      }
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
