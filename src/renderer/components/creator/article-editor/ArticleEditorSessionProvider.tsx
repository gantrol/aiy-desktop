import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector';
import type { ArticleDto, ArticleRevisionSaveInput, ArticleRevisionSaveResult } from '@/shared/contracts';
import {
  createArticleEditorSessionRuntime,
  type ArticleEditorSessionRuntime,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import type {
  ArticleEditorSessionState,
  ArticleSaveMode,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import { Button } from '@/renderer/components/ui/button';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { flushWorkspaceNavigation } from '@/renderer/components/workspace/workspace-drain';
import { flushCreatorInputRecoverySessions } from '@/renderer/components/creator/workflows/CreatorInputRecoverySession';
import { flushSocialPostSaveSessions } from '@/renderer/components/creator/SocialPostSaveSession';
import { CreatorInputRecoveryDialog } from '@/renderer/components/creator/screen/CreatorInputRecoveryDialog';

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

export function ArticleEditorSessionRegistryProvider({ children }: { children: ReactNode }) {
  const [draining, setDraining] = useState(false);
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
          void runtime.flushForExit().then((saved) => {
            const current = entriesRef.current.get(key);
            if (!saved || current !== latest || current.leases > 0) return;
            entriesRef.current.delete(key);
            runtime.dispose();
          });
        });
      },
      async flushAll() {
        const runtimes = [...new Set([...entriesRef.current.values()].map((entry) => entry.runtime))];
        const results = await Promise.all([
          ...runtimes.map((runtime) => runtime.flushForExit()),
          flushCreatorInputRecoverySessions(),
          flushSocialPostSaveSessions(),
        ]);
        const navigationSaved = await flushWorkspaceNavigation();
        return results.every(Boolean) && navigationSaved;
      },
    }),
    [],
  );
  useEffect(
    () =>
      window.desktopApi.onArticleEditorDrain?.(async (requested) => {
        if (!requested) {
          setDraining(false);
          return true;
        }
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setDraining(true);
        const saved = await registry.flushAll();
        if (!saved) setDraining(false);
        return saved;
      }),
    [registry],
  );
  return (
    <ArticleEditorSessionFlushContext.Provider value={registry.flushAll}>
      <ArticleEditorSessionRegistryContext.Provider value={registry}>
        <div className="contents" inert={draining}>
          {children}
        </div>
        <CreatorInputRecoveryDialog />
      </ArticleEditorSessionRegistryContext.Provider>
    </ArticleEditorSessionFlushContext.Provider>
  );
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
            <Button type="button" data-action="restore-article-draft" onClick={onAdopt}>
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
      createArticleEditorSessionRuntime({
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
  useEffect(
    () =>
      runtime.updateHandlers({
        onSave: stableSave,
        onSaved: stableSaved,
        onConflict: stableConflict,
        onError: stableError,
        onRecoveryError: stableRecoveryError,
      }),
    [runtime, stableSave, stableSaved, stableConflict, stableError, stableRecoveryError],
  );
  useEffect(() => runtime.receiveArticle(article), [article, runtime]);
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
      if (document.visibilityState === 'hidden') void runtime.flushForExit();
    };
    const flushBeforePageExit = () => void runtime.flushForExit();
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
          void runtime.flushForExit().finally(() => runtime.dispose());
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
