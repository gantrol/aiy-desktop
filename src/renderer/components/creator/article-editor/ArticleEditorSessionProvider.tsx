import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector';
import type {
  ArticleCheckBlockInput,
  ArticleCommentAnchorUpdateInput,
  ArticleContentInput,
  ArticleDto,
  ArticleElementPlacementInput,
  ArticleRevisionDto,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
} from '@/shared/contracts';
import { articleCommentAnchorUpdates } from '@/shared/contracts/article';
import type {
  VideoDocumentEditorImageImport,
  VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import { AutoSaveCoordinator } from '@/renderer/components/creator/article-editor/AutoSaveCoordinator';
import {
  ArticleEditorRecoveryStore,
  type ArticleEditorRecoveredDraft,
  type ArticleEditorRecoveryResult,
} from '@/renderer/components/creator/article-editor/articleEditorRecovery';
import type {
  ArticleEditorSessionState,
  ArticleSaveMode,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import {
  articleEditorMediaFromContent,
  articleEditorSnapshot,
  editableArticleContentDto,
} from '@/renderer/components/creator/article-editor/articleEditorSnapshot';
import { ArticleEditorSessionModel } from '@/renderer/components/creator/article-editor/ArticleEditorSessionModel';
import { Button } from '@/renderer/components/ui/button';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type ArticleEditorRecoveryStatus = ArticleEditorRecoveryResult['kind'] | 'loading';

interface ArticleEditorSessionRuntime {
  model: ArticleEditorSessionModel;
  recovery: ArticleEditorRecoveryStatus;
  recoveryUpdatedAt: number | null;
  capturePersistedArticle(): ArticleDto;
  captureSnapshot(): ArticleContentInput;
  getEditorSessionIdentity(): string;
  getMarkdownProjection(): string;
  getArticleCheckBlocksProjection(): readonly ArticleCheckBlockInput[];
  getArticleElementsProjection(): readonly ArticleElementPlacementInput[];
  getArticleCommentAnchorsProjection(): readonly ArticleCommentAnchorUpdateInput[];
  getRecoveryPending(): boolean;
  getRecoveryStatus(): ArticleEditorRecoveryStatus;
  subscribeMarkdownProjection(listener: () => void): () => void;
  subscribeRecovery(listener: () => void): () => void;
  subscribeAcknowledged(listener: (article: ArticleDto, request: ArticleRevisionSaveInput) => void): () => void;
  adoptRecovery(): void;
  discardRecovery(): Promise<boolean>;
  keepRecovery(): void;
  documentChanged(markdown: string): number;
  articleElementsChanged(): number;
  titleChanged(title: string): number;
  imageImported(result: VideoDocumentEditorImageImport): number;
  registerEditor(
    handle: VideoDocumentWysiwygEditorHandle | null,
    previousHandle: VideoDocumentWysiwygEditorHandle | null,
  ): void;
  restoreRevision(revision: ArticleRevisionDto): Promise<boolean>;
  flush(mode?: ArticleSaveMode): Promise<boolean>;
  retry(): Promise<boolean>;
  start(): void;
  dispose(): void;
}

type ArticleRevisionConflict = Extract<ArticleRevisionSaveResult, { status: 'CONFLICT' }>;

interface Props {
  article: ArticleDto;
  children: ReactNode;
  notify(message: string): void;
  onSave(input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult>;
  onSaved(article: ArticleDto): void;
  spaceId: string;
  zh: boolean;
}

const ArticleEditorSessionContext = createContext<ArticleEditorSessionRuntime | null>(null);

interface SessionRegistryEntry {
  leases: number;
  runtime: ArticleEditorSessionRuntime;
}

interface ArticleEditorSessionRegistry {
  getOrCreate(key: string, create: () => ArticleEditorSessionRuntime): ArticleEditorSessionRuntime;
  retain(key: string, runtime: ArticleEditorSessionRuntime): void;
  release(key: string, runtime: ArticleEditorSessionRuntime): void;
  flushAll(): Promise<boolean>;
}

const ArticleEditorSessionRegistryContext = createContext<ArticleEditorSessionRegistry | null>(null);
const ArticleEditorSessionFlushContext = createContext<() => Promise<boolean>>(async () => true);

function createSessionSeed(article: ArticleDto, sessionEpoch: string, draft: ArticleEditorRecoveredDraft | null) {
  return {
    model: new ArticleEditorSessionModel(article, {
      epoch: sessionEpoch,
      ...(draft ? { initialDraft: { content: draft.content, media: draft.media } } : {}),
    }),
    markdown: draft?.content.markdown ?? article.content.markdown,
    elements: (draft?.elements ?? article.elements).map((element) => ({ ...element })),
    commentAnchors: (draft?.commentAnchors ?? articleCommentAnchorUpdates(article.comments)).map((item) => ({
      ...item,
      anchor: { ...item.anchor },
    })),
  };
}

async function loadRecovery(
  recoveryStore: ArticleEditorRecoveryStore,
  article: ArticleDto,
  onError: () => void,
): Promise<ArticleEditorRecoveryResult> {
  try {
    return await recoveryStore.load(article);
  } catch {
    onError();
    return { kind: 'none' };
  }
}

function cloneArticleCommentAnchors(items: readonly ArticleCommentAnchorUpdateInput[]) {
  return items.map((item) => ({ ...item, anchor: { ...item.anchor } }));
}

function createDeferredOnce(callback: () => void) {
  let reported = false;
  return () => {
    if (reported) return;
    reported = true;
    queueMicrotask(callback);
  };
}

function removeUnboundEditorImages(handle: VideoDocumentWysiwygEditorHandle | null, model: ArticleEditorSessionModel) {
  return (
    handle?.removeUnboundImages(model.getSnapshot().draft.metadata.mediaBindings.map((binding) => binding.path)) ??
    false
  );
}

export function ArticleEditorSessionRegistryProvider({ children }: { children: ReactNode }) {
  const entriesRef = useRef(new Map<string, SessionRegistryEntry>());
  const registry = useMemo<ArticleEditorSessionRegistry>(
    () => ({
      getOrCreate(key, create) {
        const existing = entriesRef.current.get(key);
        if (existing) return existing.runtime;
        const runtime = create();
        entriesRef.current.set(key, { leases: 0, runtime });
        return runtime;
      },
      retain(key, runtime) {
        const entry = entriesRef.current.get(key);
        if (entry?.runtime === runtime) entry.leases += 1;
      },
      release(key, runtime) {
        const entry = entriesRef.current.get(key);
        if (!entry || entry.runtime !== runtime) return;
        entry.leases = Math.max(0, entry.leases - 1);
        queueMicrotask(() => {
          const latest = entriesRef.current.get(key);
          if (!latest || latest.runtime !== runtime || latest.leases > 0) return;
          entriesRef.current.delete(key);
          void runtime.flush('auto').finally(() => runtime.dispose());
        });
      },
      async flushAll() {
        const runtimes = [...new Set([...entriesRef.current.values()].map((entry) => entry.runtime))];
        const results = await Promise.all(runtimes.map((runtime) => runtime.flush('auto')));
        return results.every(Boolean);
      },
    }),
    [],
  );
  return (
    <ArticleEditorSessionFlushContext.Provider value={registry.flushAll}>
      <ArticleEditorSessionRegistryContext.Provider value={registry}>
        {children}
      </ArticleEditorSessionRegistryContext.Provider>
    </ArticleEditorSessionFlushContext.Provider>
  );
}

function createRuntime({
  article,
  onConflict,
  onError,
  onRecoveryError,
  onSave,
  onSaved,
  spaceId,
}: {
  article: ArticleDto;
  onConflict(conflict: ArticleRevisionConflict): void;
  onError(mode: ArticleSaveMode, detail: string): void;
  onRecoveryError(): void;
  onSave(input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult>;
  onSaved(article: ArticleDto): void;
  spaceId: string;
}): ArticleEditorSessionRuntime {
  const sessionEpoch = globalThis.crypto.randomUUID();
  const reportRecoveryError = createDeferredOnce(onRecoveryError);
  const recoveryStore = new ArticleEditorRecoveryStore(spaceId, article.id, sessionEpoch, reportRecoveryError);
  let recoveredDraft: ArticleEditorRecoveredDraft | null = null;
  let recoveryStatus: ArticleEditorRecoveryStatus = 'loading';
  let recoveryUpdatedAt: number | null = null;
  const initialSeed = createSessionSeed(article, sessionEpoch, null);
  let model = initialSeed.model;
  let persistedArticle = article;
  let editorHandle: VideoDocumentWysiwygEditorHandle | null = null;
  let markdownProjection = initialSeed.markdown;
  let latestElements = initialSeed.elements;
  let latestCommentAnchors: ArticleCommentAnchorUpdateInput[] = initialSeed.commentAnchors;
  let recoveryPending = true;
  let recoveryAdopted = false;
  let started = false;
  let disposed = false;
  let editorSessionRevision = 0;
  const markdownProjectionListeners = new Set<() => void>();
  const recoveryListeners = new Set<() => void>();
  const acknowledgedListeners = new Set<(article: ArticleDto, request: ArticleRevisionSaveInput) => void>();
  const captureSnapshot = () => {
    const editorSnapshot = editorHandle?.getPersistenceSnapshot();
    return articleEditorSnapshot(model.getSnapshot().draft.metadata, editorSnapshot?.markdown ?? markdownProjection);
  };
  const captureCommentAnchors = () => editorHandle?.getArticleCommentAnchors() ?? latestCommentAnchors;
  const createCoordinator = () =>
    new AutoSaveCoordinator({
      session: model,
      readSnapshot: captureSnapshot,
      readElements: () => editorHandle?.getPersistenceSnapshot().articleElements ?? latestElements,
      readCommentAnchors: captureCommentAnchors,
      prepareForSave: () => removeUnboundEditorImages(editorHandle, model),
      onDraftCaptured(draft) {
        const state = model.getSnapshot();
        latestElements = draft.elements ?? [];
        latestCommentAnchors = draft.commentAnchors ?? [];
        if (
          !recoveryStore.record({
            draftSeq: draft.draftSeq,
            baseRevisionId: state.persisted.revisionId,
            baseContentHash: state.persisted.contentHash,
            content: draft.content,
            media: state.draft.media,
            elements: latestElements,
            commentAnchors: latestCommentAnchors,
          })
        ) {
          reportRecoveryError();
        }
      },
      async persist(input) {
        if (!recoveryStore.markPending(input)) reportRecoveryError();
        if (!(await recoveryStore.flush())) reportRecoveryError();
        return onSave(input);
      },
      onAcknowledged(savedArticle, request) {
        if (!recoveryStore.acknowledge(request, savedArticle)) reportRecoveryError();
        persistedArticle = savedArticle;
        onSaved(savedArticle);
        acknowledgedListeners.forEach((listener) => listener(savedArticle, request));
      },
      onConflict,
      onError,
    });
  let coordinator = createCoordinator();
  const recordChange = (snapshot: ArticleContentInput) => coordinator.noteChange(snapshot);
  const start = () => {
    if (started || recoveryPending) return;
    started = true;
    if (recoveredDraft && recoveryAdopted) recordChange(recoveredDraft.content);
  };
  const resetSession = (draft: typeof recoveredDraft) => {
    coordinator.dispose();
    const next = createSessionSeed(article, sessionEpoch, draft);
    model = next.model;
    persistedArticle = article;
    editorHandle = null;
    markdownProjection = next.markdown;
    latestElements = next.elements;
    latestCommentAnchors = next.commentAnchors;
    coordinator = createCoordinator();
    markdownProjectionListeners.forEach((listener) => listener());
  };
  const resetToPersistedArticle = () => resetSession(null);
  const initialization = loadRecovery(recoveryStore, article, reportRecoveryError).then((result) => {
    if (disposed) return;
    recoveryStatus = result.kind;
    recoveryUpdatedAt = result.kind === 'none' ? null : result.updatedAt;
    recoveredDraft = result.kind === 'restored' || result.kind === 'resumed' ? result.draft : null;
    if (recoveredDraft) resetSession(recoveredDraft);
    recoveryAdopted = result.kind === 'resumed';
    recoveryPending = result.kind === 'restored' || result.kind === 'conflict';
    recoveryListeners.forEach((listener) => listener());
    if (!recoveryPending) start();
  });
  return {
    get model() {
      return model;
    },
    get recovery() {
      return recoveryStatus;
    },
    get recoveryUpdatedAt() {
      return recoveryUpdatedAt;
    },
    capturePersistedArticle: () => persistedArticle,
    captureSnapshot,
    getEditorSessionIdentity: () => `${article.id}:${sessionEpoch}:load:${editorSessionRevision}`,
    getMarkdownProjection: () => markdownProjection,
    getArticleCheckBlocksProjection: () => editorHandle?.getArticleCheckBlocks() ?? [],
    getArticleElementsProjection: () => latestElements.map((element) => ({ ...element })),
    getArticleCommentAnchorsProjection: () =>
      latestCommentAnchors.map((item) => ({ ...item, anchor: { ...item.anchor } })),
    getRecoveryPending: () => recoveryPending,
    getRecoveryStatus: () => (recoveryPending ? recoveryStatus : 'none'),
    subscribeMarkdownProjection(listener) {
      markdownProjectionListeners.add(listener);
      return () => markdownProjectionListeners.delete(listener);
    },
    subscribeRecovery(listener) {
      recoveryListeners.add(listener);
      return () => recoveryListeners.delete(listener);
    },
    subscribeAcknowledged(listener) {
      acknowledgedListeners.add(listener);
      return () => acknowledgedListeners.delete(listener);
    },
    adoptRecovery() {
      if (!recoveryPending || !recoveredDraft) return;
      recoveryAdopted = true;
      recoveryPending = false;
      recoveryListeners.forEach((listener) => listener());
      start();
    },
    async discardRecovery() {
      if (!recoveryPending) return true;
      if (!(await recoveryStore.clear())) return false;
      recoveryAdopted = false;
      recoveryPending = false;
      started = false;
      resetToPersistedArticle();
      recoveryListeners.forEach((listener) => listener());
      start();
      return true;
    },
    keepRecovery() {
      if (!recoveryPending || recoveryStatus !== 'conflict') return;
      recoveryPending = false;
      recoveryListeners.forEach((listener) => listener());
      start();
    },
    documentChanged(markdown) {
      if (markdownProjection !== markdown) {
        markdownProjection = markdown;
        markdownProjectionListeners.forEach((listener) => listener());
      }
      return recordChange(articleEditorSnapshot(model.getSnapshot().draft.metadata, markdown));
    },
    articleElementsChanged() {
      return recordChange(captureSnapshot());
    },
    titleChanged(title) {
      model.setTitle(title);
      return recordChange(captureSnapshot());
    },
    imageImported(result) {
      model.addImportedImage(result.binding, result.media);
      return recordChange(captureSnapshot());
    },
    registerEditor(handle, previousHandle) {
      if (!handle) {
        if (!previousHandle || editorHandle !== previousHandle) return;
        removeUnboundEditorImages(previousHandle, model);
        const snapshot = previousHandle.getPersistenceSnapshot();
        latestElements = snapshot.articleElements.map((element) => ({ ...element }));
        latestCommentAnchors = cloneArticleCommentAnchors(previousHandle.getArticleCommentAnchors());
        editorHandle = null;
        return;
      }
      editorHandle = handle;
      removeUnboundEditorImages(handle, model);
      const snapshot = handle.getPersistenceSnapshot();
      latestElements = snapshot.articleElements.map((element) => ({ ...element }));
      latestCommentAnchors = handle.getArticleCommentAnchors().map((item) => ({ ...item, anchor: { ...item.anchor } }));
    },
    async restoreRevision(revision) {
      if (revision.articleId !== article.id) throw new Error('Article revision identity mismatch');
      if (recoveryPending || !(await coordinator.flush('manual'))) return false;

      const content = editableArticleContentDto(revision.content);
      const commentAnchors = captureCommentAnchors().map((item) => ({ ...item, anchor: { ...item.anchor } }));
      if (!model.replaceDraft(content, articleEditorMediaFromContent(revision.content))) return false;

      editorHandle = null;
      markdownProjection = content.markdown;
      latestElements = revision.elements.map((element) => ({ ...element }));
      latestCommentAnchors = commentAnchors;
      editorSessionRevision += 1;
      markdownProjectionListeners.forEach((listener) => listener());
      return coordinator.flush('manual', 'RESTORE');
    },
    async flush(mode) {
      await initialization;
      const saved = recoveryPending ? true : await coordinator.flush(mode);
      const recovered = await recoveryStore.flush();
      return saved && recovered;
    },
    async retry() {
      await initialization;
      if (recoveryPending) return false;
      const saved = await coordinator.retry();
      const recovered = await recoveryStore.flush();
      return saved && recovered;
    },
    start,
    dispose() {
      disposed = true;
      coordinator.dispose();
      recoveryStore.dispose();
      acknowledgedListeners.clear();
      markdownProjectionListeners.clear();
      recoveryListeners.clear();
    },
  };
}

function ArticleEditorRecoveryDecision({
  runtime,
  zh,
  onAdopt,
}: {
  runtime: ArticleEditorSessionRuntime;
  zh: boolean;
  onAdopt(): void;
}) {
  if (runtime.recovery === 'loading') {
    return (
      <div
        data-article-editor-recovery-loading
        role="status"
        aria-label={zh ? '正在检查本地草稿' : 'Checking local drafts'}
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background"
      >
        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  const conflicted = runtime.recovery === 'conflict';
  const recoveredAt = runtime.recoveryUpdatedAt
    ? new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(
        runtime.recoveryUpdatedAt,
      )
    : null;
  return (
    <div
      data-article-editor-recovery
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background p-6"
    >
      <div className="flex max-w-lg flex-col items-center gap-5 text-center">
        <strong className="text-lg font-semibold">
          {conflicted
            ? zh
              ? `发现${recoveredAt ? ` ${recoveredAt}` : ''}的旧版本本地草稿`
              : `Local draft from an older revision${recoveredAt ? ` · ${recoveredAt}` : ''}`
            : zh
              ? `发现${recoveredAt ? ` ${recoveredAt}` : ''}的未保存草稿`
              : `Unsaved draft found${recoveredAt ? ` · ${recoveredAt}` : ''}`}
        </strong>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void runtime.discardRecovery()}>
            {zh ? '丢弃草稿' : 'Discard draft'}
          </Button>
          {conflicted ? (
            <Button type="button" onClick={() => runtime.keepRecovery()}>
              {zh ? '保留副本并继续' : 'Keep copy and continue'}
            </Button>
          ) : (
            <Button type="button" onClick={onAdopt}>
              {zh ? '恢复草稿' : 'Restore draft'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ArticleEditorSessionProvider({ article, children, notify, onSave, onSaved, spaceId, zh }: Props) {
  const stableNotify = useStableCallback(notify);
  const stableSave = useStableCallback(onSave);
  const stableSaved = useStableCallback(onSaved);
  const stableConflict = useStableCallback(() =>
    stableNotify(zh ? '文章已在其他位置更新，当前草稿未被覆盖' : 'The article changed elsewhere; your draft was kept'),
  );
  const stableError = useStableCallback((mode: ArticleSaveMode, detail: string) =>
    stableNotify(
      mode === 'auto'
        ? zh
          ? `文章自动保存失败：${detail}`
          : `Could not autosave the article: ${detail}`
        : zh
          ? `文章保存失败：${detail}`
          : `Could not save the article: ${detail}`,
    ),
  );
  const stableRecoveryError = useStableCallback(() =>
    stableNotify(
      zh
        ? '文章本地恢复副本写入失败；本次会话仍会继续自动保存'
        : 'The local article recovery copy could not be written; autosave will continue for this session',
    ),
  );
  const registry = useContext(ArticleEditorSessionRegistryContext);
  const registryKey = `${spaceId}:${article.id}`;
  const runtimeRef = useRef<ArticleEditorSessionRuntime | null>(null);
  const lifecycleRevisionRef = useRef(0);
  if (!runtimeRef.current) {
    const create = () =>
      createRuntime({
        article,
        onConflict: stableConflict,
        onError: stableError,
        onRecoveryError: stableRecoveryError,
        onSave: stableSave,
        onSaved: stableSaved,
        spaceId,
      });
    runtimeRef.current = registry ? registry.getOrCreate(registryKey, create) : create();
  }
  const runtime = runtimeRef.current;
  const recoveryStatus = useSyncExternalStore(
    runtime.subscribeRecovery,
    runtime.getRecoveryStatus,
    runtime.getRecoveryStatus,
  );
  const recoveryPending = recoveryStatus !== 'none';
  useEffect(() => {
    lifecycleRevisionRef.current += 1;
    registry?.retain(registryKey, runtime);
    runtime.start();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void runtime.flush('auto');
    };
    const flushBeforePageExit = () => void runtime.flush('auto');
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushBeforePageExit);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushBeforePageExit);
      if (registry) registry.release(registryKey, runtime);
      else {
        const disposalRevision = ++lifecycleRevisionRef.current;
        queueMicrotask(() => {
          if (lifecycleRevisionRef.current !== disposalRevision) return;
          void runtime.flush('auto').finally(() => runtime.dispose());
        });
      }
    };
  }, [registry, registryKey, runtime]);
  return (
    <ArticleEditorSessionContext.Provider value={runtime}>
      {recoveryPending ? (
        <ArticleEditorRecoveryDecision
          runtime={runtime}
          zh={zh}
          onAdopt={() => {
            runtime.adoptRecovery();
            stableNotify(zh ? '已恢复上次未完成的文章修改' : 'Recovered unfinished article edits');
          }}
        />
      ) : (
        children
      )}
    </ArticleEditorSessionContext.Provider>
  );
}

export function useArticleEditorSession() {
  const runtime = useContext(ArticleEditorSessionContext);
  if (!runtime) throw new Error('ArticleEditorSessionProvider is missing');
  return runtime;
}

export function useArticleEditorSessionFlush() {
  return useContext(ArticleEditorSessionFlushContext);
}

export function useArticleEditorSessionSelector<Selection>(selector: (state: ArticleEditorSessionState) => Selection) {
  const model = useArticleEditorSession().model;
  return useSyncExternalStoreWithSelector(model.subscribe, model.getSnapshot, model.getSnapshot, selector);
}

/** Read-only projection for auxiliary views; it is never used to initialize or overwrite the editor engine. */
export function useArticleEditorMarkdownProjection() {
  const session = useArticleEditorSession();
  return useSyncExternalStore(
    session.subscribeMarkdownProjection,
    session.getMarkdownProjection,
    session.getMarkdownProjection,
  );
}
