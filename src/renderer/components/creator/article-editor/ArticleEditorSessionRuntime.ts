import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { hydrateArticleElementJsonIdentities } from '@/renderer/features/video-documents/articleElementJsonIdentity';
import { ArticleEditorSessionModel } from '@/renderer/components/creator/article-editor/ArticleEditorSessionModel';
import {
  AutoSaveCoordinator,
  type ArticleEditorDraftSnapshot,
} from '@/renderer/components/creator/article-editor/AutoSaveCoordinator';
import {
  ArticleEditorRecoveryStore,
  type ArticleEditorRecoveredDraft,
  type ArticleEditorRecoveryResult,
} from '@/renderer/components/creator/article-editor/articleEditorRecovery';
import {
  articleEditorSessionDirty,
  type ArticleSaveMode,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import {
  articleEditorMediaFromContent,
  articleEditorSnapshot,
  editableArticleContentDto,
} from '@/renderer/components/creator/article-editor/articleEditorSnapshot';
import { contentImagesRecoverable } from '@/renderer/features/content-editor/contentImageRecovery';
import type {
  VideoDocumentEditorImageImport,
  VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import type {
  ArticleCheckBlockInput,
  ArticleCommentAnchorUpdateInput,
  ArticleCommentDto,
  ArticleContentInput,
  ArticleDto,
  ArticleElementPlacementInput,
  ArticleRevisionDto,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
} from '@/shared/contracts';
import { articleCommentAnchorUpdates } from '@/shared/contracts/article';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { blockDocumentImportIds } from '@/shared/contracts/block-document';
import type { RendererDiagnosticInput } from '@/shared/contracts/renderer-diagnostics';

type RecoveryStatus = ArticleEditorRecoveryResult['kind'] | 'loading';
type RevisionConflict = Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>;

export interface ArticleEditorSessionRuntime {
  updateHandlers(
    handlers: Pick<RuntimeOptions, 'onSave' | 'onSaved' | 'onConflict' | 'onError' | 'onRecoveryError'>,
  ): void;
  readonly model: ArticleEditorSessionModel;
  readonly recovery: RecoveryStatus;
  readonly recoveryUpdatedAt: number | null;
  capturePersistedArticle(): ArticleDto;
  captureSnapshot(): ArticleContentInput;
  getEditorSessionIdentity(): string;
  getMarkdownProjection(): string;
  getDocumentProjection(): BlockDocument | undefined;
  getArticleCheckBlocksProjection(): readonly ArticleCheckBlockInput[];
  getArticleElementsProjection(): readonly ArticleElementPlacementInput[];
  getArticleCommentAnchorsProjection(): readonly ArticleCommentAnchorUpdateInput[];
  getRecoveryPending(): boolean;
  getRecoveryStatus(): RecoveryStatus;
  subscribeMarkdownProjection(listener: () => void): () => void;
  subscribeRecovery(listener: () => void): () => void;
  subscribeAcknowledged(listener: (article: ArticleDto, request: ArticleRevisionSaveInput) => void): () => void;
  receiveArticle(article: ArticleDto): void;
  acceptExternalArticle(): Promise<boolean>;
  mutateComments<T extends { comments: ArticleCommentDto[] }>(
    operation: (article: ArticleDto) => Promise<T>,
  ): Promise<T | null>;
  adoptRecovery(): void;
  discardRecovery(): Promise<boolean>;
  keepRecovery(): void;
  documentChanged(markdown: string): number;
  articleElementsChanged(): number;
  titleChanged(title: string): number;
  coverChanged(assetId: string | null): number;
  imageImported(result: VideoDocumentEditorImageImport): number;
  imageRemoved(assetId: string): number;
  registerEditor(
    handle: VideoDocumentWysiwygEditorHandle | null,
    previous: VideoDocumentWysiwygEditorHandle | null,
  ): void;
  restoreRevision(revision: ArticleRevisionDto): Promise<boolean>;
  flush(mode?: ArticleSaveMode): Promise<boolean>;
  flushForExit(): Promise<boolean>;
  retry(): Promise<boolean>;
  start(): void;
  dispose(): void;
}

interface RuntimeOptions {
  article: ArticleDto;
  onConflict(conflict: RevisionConflict): void;
  onError(mode: ArticleSaveMode, detail: string): void;
  onRecoveryError(): void;
  onSave(input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult>;
  onSaved(article: ArticleDto): void;
  spaceId: string;
}

class ArticleSession implements ArticleEditorSessionRuntime {
  readonly model: ArticleEditorSessionModel;
  readonly #coordinator: AutoSaveCoordinator;
  readonly #recoveryStore: ArticleEditorRecoveryStore;
  readonly #initialization: Promise<void>;
  readonly #markdownListeners = new Set<() => void>();
  readonly #recoveryListeners = new Set<() => void>();
  readonly #acknowledgedListeners = new Set<(article: ArticleDto, request: ArticleRevisionSaveInput) => void>();
  readonly #options: RuntimeOptions;
  #recoveredDraft: ArticleEditorRecoveredDraft | null = null;
  #recoveryStatus: RecoveryStatus = 'loading';
  #recoveryUpdatedAt: number | null = null;
  #recoveryPending = true;
  #recoveryAdopted = false;
  #recoveryErrorReported = false;
  #started = false;
  #disposed = false;
  #editorHandle: VideoDocumentWysiwygEditorHandle | null = null;
  #unsubscribeInput: (() => void) | null = null;
  #markdown: string;
  #elements: ArticleElementPlacementInput[];
  #anchors: ArticleCommentAnchorUpdateInput[];
  #queuedArticle: ArticleDto | null = null;
  #receivedArticle: ArticleDto;
  #capturedKey: string;
  #document?: BlockDocument;

  updateHandlers(handlers: Pick<RuntimeOptions, 'onSave' | 'onSaved' | 'onConflict' | 'onError' | 'onRecoveryError'>) {
    Object.assign(this.#options, handlers);
  }

  constructor(options: RuntimeOptions) {
    this.#options = options;
    const { article, spaceId } = options;
    this.model = new ArticleEditorSessionModel(article);
    this.#markdown = article.content.markdown;
    this.#elements = article.elements;
    this.#anchors = articleCommentAnchorUpdates(article.comments);
    this.#receivedArticle = article;
    this.#capturedKey = JSON.stringify(this.#captureDocument());
    this.#recoveryStore = new ArticleEditorRecoveryStore(
      spaceId,
      article.id,
      this.model.getSnapshot().session.epoch,
      this.#reportRecoveryError,
    );
    this.#coordinator = new AutoSaveCoordinator({
      session: this.model,
      readSnapshot: this.#captureDocument,
      whenSettled: this.#whenSettled,
      onIdle: this.#receiveQueuedArticle,
      onDraftCaptured: (draft) => {
        const state = this.model.getSnapshot();
        this.#elements = draft.elements ?? [];
        this.#anchors = draft.commentAnchors ?? [];
        if (
          !this.#recoveryStore.record({
            draftSeq: draft.draftSeq,
            baseRevisionId: state.persisted.revisionId,
            baseContentHash: state.persisted.contentHash,
            content: draft.content,
            media: state.draft.media,
            elements: this.#elements,
            commentAnchors: this.#anchors,
          })
        )
          this.#reportRecoveryError();
      },
      persist: async (input) => {
        this.#trace('article-save-start', input.requestId);
        if (!this.#recoveryStore.markPending(input)) this.#reportRecoveryError();
        if (!(await this.#recoveryStore.flush())) this.#reportRecoveryError();
        return this.#options.onSave(input);
      },
      onAcknowledged: (savedArticle, request) => {
        this.#trace('article-save-acknowledged', request.requestId);
        if (!this.#recoveryStore.acknowledge(request, savedArticle)) this.#reportRecoveryError();
        this.#options.onSaved(savedArticle);
        this.#acknowledgedListeners.forEach((listener) => listener(savedArticle, request));
      },
      onConflict: (conflict) => {
        this.#trace('article-conflict', conflict.requestId);
        this.#queuedArticle = conflict.currentArticle;
        this.model.receiveExternalArticle(conflict.currentArticle);
        this.#options.onConflict(conflict);
      },
      onError: (mode, detail) => {
        this.#trace('article-save-failed');
        this.#options.onError(mode, detail);
      },
    });
    this.#initialization = this.#initialize(article);
  }

  #trace(event: RendererDiagnosticInput['event'], requestId?: string) {
    const state = this.model.getSnapshot();
    try {
      window.desktopApi.rendererDiagnosticRecord?.({
        event,
        details: {
          articleId: state.session.articleId,
          sessionId: state.session.epoch,
          requestId,
          draftSequence: state.draft.sequence,
          revisionNo: state.persisted.article.revisionNo,
          dirty: articleEditorSessionDirty(state),
          composing: state.editorPending,
        },
      });
    } catch {
      /* Diagnostics must not affect document ownership or persistence. */
    }
  }

  #reportRecoveryError = () => {
    if (this.#recoveryErrorReported) return;
    this.#recoveryErrorReported = true;
    queueMicrotask(this.#options.onRecoveryError);
  };

  async #initialize(article: ArticleDto) {
    const result = await this.#recoveryStore.load(article).catch(() => {
      this.#reportRecoveryError();
      return { kind: 'none' } as const;
    });
    if (this.#disposed) return;
    this.#recoveryStatus = result.kind;
    this.#recoveryUpdatedAt = result.kind === 'none' ? null : result.updatedAt;
    this.#recoveredDraft = result.kind === 'restored' || result.kind === 'resumed' ? result.draft : null;
    if (this.#recoveredDraft) this.#loadArticle(article, this.#recoveredDraft);
    this.#recoveryAdopted = result.kind === 'resumed';
    this.#recoveryPending = result.kind === 'restored' || result.kind === 'conflict';
    this.#recoveryListeners.forEach((listener) => listener());
    this.start();
  }

  #publishMarkdown(value: string) {
    if (this.#markdown === value) return;
    this.#markdown = value;
    this.#markdownListeners.forEach((listener) => listener());
  }

  #captureDocument = (): ArticleEditorDraftSnapshot => {
    const snapshot = this.#editorHandle?.getPersistenceSnapshot();
    this.#document = snapshot?.document ?? this.#document ?? this.model.getSnapshot().draft.metadata.document;
    const mapped = new Map((snapshot?.commentAnchors ?? this.#anchors).map((item) => [item.commentId, item.anchor]));
    return {
      ...articleEditorSnapshot(
        this.model.getSnapshot().draft.metadata,
        snapshot?.markdown ?? this.#markdown,
        this.#document,
      ),
      elements: snapshot?.articleElements ?? this.#elements,
      commentAnchors: this.model.getSnapshot().draft.comments.map((comment) => ({
        commentId: comment.id,
        anchor: { ...(mapped.get(comment.id) ?? comment.anchor) },
      })),
    };
  };

  #recordChange(cause: ArticleRevisionSaveInput['cause'] = 'EDITOR') {
    const snapshot = this.#captureDocument();
    const key = JSON.stringify(snapshot);
    if (key === this.#capturedKey) return this.model.getSnapshot().draft.sequence;
    this.#publishMarkdown(snapshot.markdown);
    const sequence = this.#coordinator.noteChange(snapshot, cause);
    this.#capturedKey = key;
    return sequence;
  }

  #whenSettled = async () => {
    const handle = this.#editorHandle;
    if (handle && !(await handle.whenSettled())) return false;
    if (this.#disposed) return false;
    this.#recordChange();
    return true;
  };

  #detachEditor() {
    this.#unsubscribeInput?.();
    this.#unsubscribeInput = null;
    this.#editorHandle = null;
    this.model.setEditorPending(false);
  }

  #loadArticle(next: ArticleDto, draft: ArticleEditorRecoveredDraft | null = null) {
    if (!this.#coordinator.reset()) return false;
    this.#document = draft?.content.document ?? next.content.document;
    this.#detachEditor();
    this.#elements = (draft?.elements ?? next.elements).map((element) => ({ ...element }));
    this.#anchors = [...(draft?.commentAnchors ?? articleCommentAnchorUpdates(next.comments))];
    this.#markdown = draft?.content.markdown ?? next.content.markdown;
    this.model.loadArticle(
      next,
      draft ? { content: draft.content, media: draft.media, commentAnchors: draft.commentAnchors } : undefined,
    );
    this.#capturedKey = draft ? '' : JSON.stringify(this.#captureDocument());
    this.#markdownListeners.forEach((listener) => listener());
    return true;
  }

  #receiveQueuedArticle = () => {
    if (!this.#queuedArticle || this.#recoveryPending || this.#coordinator.busy || this.#disposed) return;
    const next = this.#queuedArticle;
    const state = this.model.getSnapshot();
    if (next.revisionNo < state.persisted.article.revisionNo) {
      this.#queuedArticle = null;
      return;
    }
    if (next.revisionId === state.persisted.revisionId) {
      this.#queuedArticle = null;
      if (next !== state.persisted.article) this.model.updateComments(next.comments);
      return;
    }
    if (articleEditorSessionDirty(state) || state.save.phase !== 'idle') {
      this.model.receiveExternalArticle(next);
      return;
    }
    this.#queuedArticle = null;
    this.#loadArticle(next);
  };

  get recovery() {
    return this.#recoveryStatus;
  }
  get recoveryUpdatedAt() {
    return this.#recoveryUpdatedAt;
  }
  capturePersistedArticle = () => this.model.getSnapshot().persisted.article;
  captureSnapshot = () => {
    const { elements: _elements, commentAnchors: _anchors, ...content } = this.#captureDocument();
    return content;
  };
  getEditorSessionIdentity = () => {
    const state = this.model.getSnapshot();
    return state.session.articleId + ':' + state.session.epoch + ':load:' + state.documentVersion;
  };
  getMarkdownProjection = () => this.#markdown;
  getDocumentProjection = () => this.#document ?? this.model.getSnapshot().draft.metadata.document;
  getArticleCheckBlocksProjection = () => this.#editorHandle?.getArticleCheckBlocks() ?? [];
  getArticleElementsProjection = () => this.#elements;
  getArticleCommentAnchorsProjection = () => this.#anchors;
  getRecoveryPending = () => this.#recoveryPending;
  getRecoveryStatus = (): RecoveryStatus => (this.#recoveryPending ? this.#recoveryStatus : 'none');
  subscribeMarkdownProjection = (listener: () => void) => {
    this.#markdownListeners.add(listener);
    return () => this.#markdownListeners.delete(listener);
  };
  subscribeRecovery = (listener: () => void) => {
    this.#recoveryListeners.add(listener);
    return () => this.#recoveryListeners.delete(listener);
  };
  subscribeAcknowledged = (listener: (article: ArticleDto, request: ArticleRevisionSaveInput) => void) => {
    this.#acknowledgedListeners.add(listener);
    return () => this.#acknowledgedListeners.delete(listener);
  };

  receiveArticle = (next: ArticleDto) => {
    if (next.id !== this.#options.article.id || next === this.#receivedArticle || this.#disposed) return;
    this.#receivedArticle = next;
    this.#trace('article-external-revision');
    if (!this.#queuedArticle || next.revisionNo >= this.#queuedArticle.revisionNo) this.#queuedArticle = next;
    this.#receiveQueuedArticle();
  };

  acceptExternalArticle = async () => {
    if (this.#coordinator.busy || !(await this.#whenSettled())) return false;
    const next = this.model.getSnapshot().externalArticle;
    if (!next) return true;
    // A retained checkpoint owns its own identity; future saves cannot clear it.
    const copy = new ArticleEditorRecoveryStore(
      this.#options.spaceId,
      next.id,
      globalThis.crypto.randomUUID(),
      this.#reportRecoveryError,
    );
    const state = this.model.getSnapshot();
    const snapshot = this.#captureDocument();
    copy.record({
      draftSeq: state.draft.sequence,
      baseRevisionId: state.persisted.revisionId,
      baseContentHash: state.persisted.contentHash,
      content: this.captureSnapshot(),
      media: state.draft.media,
      elements: [...(snapshot.elements ?? [])],
      commentAnchors: [...(snapshot.commentAnchors ?? [])],
    });
    const retained = await copy.flush();
    copy.dispose();
    if (
      !retained ||
      this.model.getSnapshot().draft.sequence !== state.draft.sequence ||
      this.#coordinator.busy ||
      this.model.getSnapshot().editorPending
    )
      return false;
    if (!this.#loadArticle(next)) return false;
    this.#queuedArticle = null;
    await this.#recoveryStore.clear();
    this.#options.onSaved(next);
    return true;
  };

  mutateComments = async <T extends { comments: ArticleCommentDto[] }>(
    operation: (article: ArticleDto) => Promise<T>,
  ): Promise<T | null> => {
    await this.#initialization;
    if (this.#recoveryPending) return null;
    return this.#coordinator.mutate(async () => {
      const result = await operation(this.capturePersistedArticle());
      // A queued projection of this head predates the completed mutation.
      // Its comments cannot replace the authoritative mutation response.
      if (this.#queuedArticle?.revisionId === this.capturePersistedArticle().revisionId) this.#queuedArticle = null;
      this.model.updateComments(result.comments);
      this.#options.onSaved(this.capturePersistedArticle());
      this.#recordChange();
      return result;
    });
  };

  adoptRecovery = () => {
    if (!this.#recoveryPending || !this.#recoveredDraft) return;
    this.#recoveryAdopted = true;
    this.#recoveryPending = false;
    this.#recoveryListeners.forEach((listener) => listener());
    this.start();
  };
  discardRecovery = async () => {
    if (!this.#recoveryPending) return true;
    if (!(await this.#recoveryStore.clear())) return false;
    this.#recoveryAdopted = false;
    this.#recoveryPending = false;
    this.#started = false;
    this.#loadArticle(this.capturePersistedArticle());
    this.#recoveryListeners.forEach((listener) => listener());
    this.start();
    return true;
  };
  keepRecovery = () => {
    if (!this.#recoveryPending || this.#recoveryStatus !== 'conflict') return;
    this.#recoveryStore.retainSource();
    this.#recoveryPending = false;
    this.#recoveryListeners.forEach((listener) => listener());
    this.start();
  };
  documentChanged = (value: string) => {
    this.#publishMarkdown(value);
    return this.#recordChange();
  };
  articleElementsChanged = () => this.#recordChange();
  titleChanged = (value: string) => {
    this.model.setTitle(value);
    return this.#recordChange();
  };
  imageImported = (result: VideoDocumentEditorImageImport) => {
    this.model.addImportedImage(result.binding, result.media);
    return this.#recordChange();
  };
  coverChanged = (assetId: string | null) => {
    this.model.setCover(assetId);
    return this.#recordChange();
  };
  imageRemoved = (assetId: string) => {
    if (!this.#editorHandle || !this.model.removeImage(assetId)) return this.model.getSnapshot().draft.sequence;
    this.#editorHandle.removeImageAssets([assetId]);
    return this.#recordChange();
  };

  registerEditor = (
    handle: VideoDocumentWysiwygEditorHandle | null,
    previous: VideoDocumentWysiwygEditorHandle | null,
  ) => {
    if (!handle) {
      if (!previous || previous !== this.#editorHandle) return;
      this.#recordChange();
      const snapshot = previous.getPersistenceSnapshot();
      this.#elements = snapshot.articleElements;
      this.#anchors = snapshot.commentAnchors;
      this.#publishMarkdown(snapshot.markdown);
      this.#detachEditor();
      return;
    }
    this.#unsubscribeInput?.();
    this.#editorHandle = handle;
    const inputChanged = () => {
      const wasPending = this.model.getSnapshot().editorPending;
      this.model.setEditorPending(handle.isInputPending());
      if (wasPending !== handle.isInputPending())
        this.#trace(handle.isInputPending() ? 'article-input-pending' : 'article-input-settled');
      if (!handle.isInputPending()) this.#receiveQueuedArticle();
    };
    this.#unsubscribeInput = handle.subscribeInput(inputChanged);
    inputChanged();
    const snapshot = handle.getPersistenceSnapshot();
    this.#elements = snapshot.articleElements;
    this.#anchors = snapshot.commentAnchors;
  };

  restoreRevision = async (revision: ArticleRevisionDto) => {
    if (revision.articleId !== this.#options.article.id) throw new Error('Article revision identity mismatch');
    if (!(await this.flush('manual'))) return false;
    const document =
      revision.content.document ?? markdownBlockDocument(revision.content.markdown, revision.content.mediaBindings);
    if (!revision.content.document) hydrateArticleElementJsonIdentities(document.root, revision.elements);
    const content = editableArticleContentDto({ ...revision.content, schemaVersion: 2, document });
    if (!this.model.replaceDraft(content, articleEditorMediaFromContent(revision.content))) return false;
    this.#detachEditor();
    this.#document = content.document;
    this.#markdown = content.markdown;
    this.#elements = revision.elements;
    this.#markdownListeners.forEach((listener) => listener());
    this.#recordChange('RESTORE');
    return this.#coordinator.flush('manual', 'RESTORE');
  };
  flush = async (mode: ArticleSaveMode = 'manual') => {
    await this.#initialization;
    const saved = this.#recoveryPending ? true : await this.#coordinator.flush(mode);
    this.#trace('article-drain');
    return (await this.#recoveryStore.flush()) && saved;
  };
  flushForExit = async () => {
    await this.#initialization;
    const snapshot = this.#captureDocument();
    if (snapshot.document && blockDocumentImportIds(snapshot.document).length) {
      if (this.#editorHandle && !(await this.#editorHandle.whenRecoverable())) return false;
      if (!(await contentImagesRecoverable(snapshot.document))) return false;
      this.#recordChange();
      return this.#recoveryStore.flush();
    }
    const saved = await this.flush('auto');
    return saved || (await this.#recoveryStore.flush());
  };
  retry = () => this.flush('manual');
  start = () => {
    if (this.#started || this.#recoveryPending || this.#disposed) return;
    this.#started = true;
    if (this.#recoveredDraft && this.#recoveryAdopted) this.#recordChange();
    this.#receiveQueuedArticle();
  };
  dispose = () => {
    this.#disposed = true;
    this.#detachEditor();
    this.#coordinator.dispose();
    this.#recoveryStore.dispose();
    this.#acknowledgedListeners.clear();
    this.#markdownListeners.clear();
    this.#recoveryListeners.clear();
  };
}

export function createArticleEditorSessionRuntime(options: RuntimeOptions): ArticleEditorSessionRuntime {
  return new ArticleSession(options);
}
