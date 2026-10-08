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
import { ArticleEditorRecoveryDecision } from '@/renderer/components/creator/article-editor/ArticleEditorRecoveryDecision';
import { useI18n } from '@/renderer/i18n/useI18n';
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
}

const ArticleEditorSessionContext = createContext<ArticleEditorSessionRuntime | null>(null);

interface SessionRegistryEntry {
  leases: number;
  runtime: ArticleEditorSessionRuntime;
}

interface ArticleEditorSessionRegistry {
  find(spaceId: string, articleId: string): ArticleEditorSessionRuntime | undefined;
  subscribe(listener: () => void): () => void;
  getOrCreate(key: string, create: () => ArticleEditorSessionRuntime): ArticleEditorSessionRuntime;
  retain(key: string, runtime: ArticleEditorSessionRuntime): void;
  release(key: string, runtime: ArticleEditorSessionRuntime): void;
  flushAll(): Promise<boolean>;
}

const ArticleEditorSessionRegistryContext = createContext<ArticleEditorSessionRegistry | null>(null);
const ArticleEditorSessionFlushContext = createContext<() => Promise<boolean>>(async () => true);

/** Read access never creates an editor or takes ownership of its save queue. */
export function useArticleEditorSessions() {
  return useContext(ArticleEditorSessionRegistryContext);
}

export function ArticleEditorSessionRegistryProvider({ children }: { children: ReactNode }) {
  const [draining, setDraining] = useState(false);
  const entriesRef = useRef(new Map<string, SessionRegistryEntry>());
  const listeners = useRef(new Set<() => void>());
  const registry = useMemo<ArticleEditorSessionRegistry>(
    () => ({
      find: (spaceId, articleId) => entriesRef.current.get(`${spaceId}:${articleId}`)?.runtime,
      subscribe(listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      getOrCreate(key, create) {
        const existing = entriesRef.current.get(key);
        if (existing) return existing.runtime;
        const runtime = create();
        entriesRef.current.set(key, { leases: 0, runtime });
        queueMicrotask(() => listeners.current.forEach((listener) => listener()));
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
            listeners.current.forEach((listener) => listener());
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

export function ArticleEditorSessionProvider({ article, children, notify, onSave, onSaved, spaceId }: Props) {
  const copy = useI18n().messages.creator.articleRecovery;
  const stableNotify = useStableCallback(notify);
  const stableSave = useStableCallback(onSave);
  const stableSaved = useStableCallback(onSaved);
  const stableConflict = useStableCallback(() => stableNotify(copy.changedElsewhere));
  const stableError = useStableCallback((mode: ArticleSaveMode, detail: string) =>
    stableNotify((mode === 'auto' ? copy.autosaveFailed : copy.saveFailed)(detail)),
  );
  const stableRecoveryError = useStableCallback(() => stableNotify(copy.recoveryFailed));
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
          onAdopt={() => {
            runtime.adoptRecovery();
            stableNotify(copy.restored);
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
