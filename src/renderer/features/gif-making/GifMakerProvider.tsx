import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { BootstrapDto, TermListItem } from '@/shared/contracts';
import {
  gifErrorCode,
  newGifManifest,
  type GifDocumentDetail,
  type GifAdoptionTarget,
} from '@/shared/contracts/gif-making';
import type { CreatorLocation, CreatorOpenTabTarget, NavigationMode } from '@/renderer/components/app/app-navigation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

const GifMaker = lazy(() => import('@/renderer/features/gif-making/GifMaker'));
export type AnimationLocation = Extract<CreatorLocation, { surface: 'animation' }>;
export interface GifLaunchInput {
  forceNew?: boolean;
  title?: string;
  initialPrompt?: string;
  sourceDocumentId?: string;
  targetAlbumId?: string | null;
  adoptionTarget?: GifAdoptionTarget;
  documentId?: string;
  assetId?: string;
  assetIds?: string[];
  seriesId?: string | null;
}
interface GifSession {
  container: HTMLDivElement;
  editor: GifDocumentDetail;
  motion: GifDocumentDetail;
}
interface Presentation {
  owner: symbol;
  data: BootstrapDto;
  openWork(target: CreatorOpenTabTarget): void;
  route: AnimationLocation;
  navigate(location: CreatorLocation, mode?: NavigationMode): void;
  close(): void;
}
const GifRuntimeContext = createContext<{
  resolve(input: GifLaunchInput): Promise<AnimationLocation | null>;
  ensure(id: string): Promise<GifSession>;
  present(id: string, owner: symbol, value: Presentation | null): void;
  available: boolean;
} | null>(null);
const GifNavigationContext = createContext<{
  isCurrent(): boolean;
  navigate(location: CreatorLocation, mode?: NavigationMode): void;
} | null>(null);
const GifWorkspaceContext = createContext<ReactNode>(null);

/** Editors outlive their visible tab. Hiding a view never cancels a model job. */
export function GifMakerProvider({
  spaceId,
  terms,
  refresh,
  notify,
  children,
}: {
  spaceId: string | null;
  terms: TermListItem[];
  refresh(): Promise<unknown>;
  notify(message: string): void;
  children: ReactNode;
}) {
  const { messages } = useI18n();
  const labels = messages.creator.gifMaker;
  const [sessions, setSessions] = useState<Map<string, GifSession>>(() => new Map());
  const [presentations, setPresentations] = useState<Map<string, Presentation>>(() => new Map());
  const pending = useRef(new Map<string, Promise<GifSession>>());
  const resume = useRef(new Map<string, AnimationLocation>());
  const savedWorkspace = useRef(new Map<string, string>());
  const sessionRef = useRef(sessions);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refreshSavedWork = useStableCallback(async () => {
    try {
      await refresh();
      return true;
    } catch {
      notify(messages.creator.workNavigation.savedRefreshFailed);
      return false;
    }
  });
  const ensure = useCallback((id: string): Promise<GifSession> => {
    const existing = sessionRef.current.get(id);
    if (existing) return Promise.resolve(existing);
    const loading = pending.current.get(id);
    if (loading) return loading;
    const operation = (async () => {
      const { editor, motion } = await window.desktopApi.gifWorkspaceOpen(id);
      const container = document.createElement('div');
      container.className = 'h-full min-h-0 w-full';
      const session = { editor, motion, container };
      if (alive.current) {
        sessionRef.current = new Map(sessionRef.current).set(id, session);
        setSessions(sessionRef.current);
      }
      return session;
    })().finally(() => pending.current.delete(id));
    pending.current.set(id, operation);
    return operation;
  }, []);
  const resolve = useStableCallback(async (input: GifLaunchInput): Promise<AnimationLocation | null> => {
    if (!spaceId) return null;
    try {
      if ((input.initialPrompt?.length ?? 0) > 4000) throw new Error('GIF_LIMIT');
      let id = input.documentId;
      const ids = [...new Set(input.assetIds ?? (input.assetId ? [input.assetId] : []))];
      if (!id && !input.forceNew && ids.length === 1)
        id = (await window.desktopApi.gifFindForAsset(ids[0], 'GIF', input.seriesId ?? null)) ?? undefined;
      if (!id) {
        if (ids.length > 120) throw new Error('GIF_LIMIT');
        const resolved = ids.length
          ? await window.desktopApi.materialImageAssetsResolve({
              targets: ids.map((imageAssetId) => ({ kind: 'IMAGE_ASSET' as const, imageAssetId })),
            })
          : [];
        const assets = ids.map((assetId) => resolved.find((asset) => asset.id === assetId));
        if (assets.some((asset) => !asset)) throw new Error('GIF_ASSET_UNAVAILABLE');
        if (assets.some((asset) => !['image/png', 'image/jpeg', 'image/webp'].includes(asset!.mimeType)))
          throw new Error('GIF_ANIMATED_SOURCE');
        const seriesId = input.seriesId ?? null;
        const manifest = newGifManifest();
        if (assets.length > 1) {
          Object.assign(manifest, newGifManifest(assets[0]));
          manifest.frames = assets.map((asset) => ({
            id: crypto.randomUUID(),
            assetId: asset!.id,
            durationMs: 100,
            sourceRect: null,
          }));
        }
        const editor = await window.desktopApi.gifWorkspaceCreate({
          id: crypto.randomUUID(),
          motionId: crypto.randomUUID(),
          seriesId,
          title: input.title ?? '',
          sourceDocumentId: input.sourceDocumentId,
          targetAlbumId: input.targetAlbumId,
          motionDraft: input.initialPrompt
            ? {
                prompt: input.initialPrompt,
                mode: 'WHOLE',
                region: null,
                feather: 0.1,
                durationMs: 1200,
                modelKey: '',
                quality: 'medium',
                generationMode: 'FRAMES',
                returnMode: 'CONTINUE',
                plan: null,
              }
            : null,
          motionManifest: newGifManifest(assets[0]),
          manifest,
        });
        id = editor.id;
        await refreshSavedWork();
      }
      const session = await ensure(id);
      return {
        surface: 'animation',
        documentId: id,
        seriesId: session.editor.document.seriesId,
        title: session.editor.document.title || labels.untitled,
        step: session.editor.document.manifest.frames.length ? 'edit' : 'generate',
        ...session.editor.workspace,
        ...resume.current.get(id),
        adoptionTarget: input.adoptionTarget,
      };
    } catch (reason) {
      notify(labels.errors[gifErrorCode(reason)]);
      return null;
    }
  });
  const present = useCallback((id: string, owner: symbol, value: Presentation | null) => {
    if (value) {
      resume.current.set(id, value.route);
      const { step, frameId, candidateId } = value.route;
      const state = { step, ...(frameId ? { frameId } : {}), ...(candidateId ? { candidateId } : {}) };
      const serialized = JSON.stringify(state);
      if (savedWorkspace.current.get(id) !== serialized) {
        savedWorkspace.current.set(id, serialized);
        void window.desktopApi.gifWorkspaceSave(id, state).catch(() => savedWorkspace.current.delete(id));
      }
    }
    setPresentations((previous) => {
      if (!value && previous.get(id)?.owner !== owner) return previous;
      const next = new Map(previous);
      if (value) next.set(id, value);
      else next.delete(id);
      return next;
    });
  }, []);
  const runtime = useMemo(
    () => ({ resolve, ensure, present, available: Boolean(spaceId) }),
    [resolve, ensure, present, spaceId],
  );
  return (
    <GifRuntimeContext.Provider value={runtime}>
      {children}
      {spaceId &&
        [...sessions].map(([id, session]) => {
          const presentation = presentations.get(id);
          return createPortal(
            <Suspense fallback={null}>
              <GifMaker
                data={presentation?.data}
                notify={notify}
                onOpenWork={(target) => presentation?.openWork(target)}
                spaceId={spaceId}
                terms={terms}
                seriesId={session.editor.document.seriesId}
                initialAssets={session.editor.assets}
                initialDocument={session.editor}
                motionDocument={session.motion}
                visible={Boolean(presentation)}
                route={presentation?.route}
                onNavigate={(location, mode) => presentation?.navigate(location, mode)}
                onOpen={async (input) => {
                  const location = await resolve({
                    ...input,
                    adoptionTarget: input.adoptionTarget ?? presentation?.route.adoptionTarget,
                  });
                  if (location) presentation?.navigate(location);
                }}
                onClose={() => presentation?.close()}
                onExported={async () => {
                  await refreshSavedWork();
                }}
                onRefresh={refreshSavedWork}
                onOpenGroup={(postId) => presentation?.navigate({ surface: 'social-post', postId })}
              />
            </Suspense>,
            session.container,
            id,
          );
        })}
    </GifRuntimeContext.Provider>
  );
}

export function useGifMakerLauncher() {
  const runtime = useContext(GifRuntimeContext);
  const navigation = useContext(GifNavigationContext);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const open = useStableCallback(async (input: GifLaunchInput = {}) => {
    if (!runtime || !navigation?.isCurrent() || lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const location = await runtime.resolve(input);
      if (location) navigation.navigate(location);
    } finally {
      lock.current = false;
      setPending(false);
    }
  });
  return runtime && navigation ? { open, isCurrent: navigation.isCurrent, busy: pending || !runtime.available } : null;
}

interface GifWorkspaceScopeProps {
  data: BootstrapDto;
  onOpenWork(target: CreatorOpenTabTarget): void;
  active: boolean;
  focused: boolean;
  navigationKey: string;
  route: AnimationLocation | null;
  onNavigate(location: CreatorLocation, mode?: NavigationMode): void;
  onClose(): void;
  children: ReactNode;
}

export function GifWorkspaceScope({ children, ...props }: GifWorkspaceScopeProps) {
  const { active, navigationKey, onNavigate } = props;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const atLocation = useStableCallback((key: string) => mounted.current && active && navigationKey === key);
  const navigateTo = useStableCallback(onNavigate);
  const value = useMemo(() => {
    const isCurrent = () => atLocation(navigationKey);
    return {
      isCurrent,
      navigate: (location: CreatorLocation, mode?: NavigationMode) => {
        if (isCurrent()) navigateTo(location, mode);
      },
    };
  }, [atLocation, navigateTo, navigationKey]);
  return (
    <GifNavigationContext.Provider value={value}>
      <GifWorkspaceContext.Provider value={props.route ? <GifWorkspaceSurface {...props} /> : null}>
        {children}
      </GifWorkspaceContext.Provider>
    </GifNavigationContext.Provider>
  );
}

export function useGifWorkspace() {
  return useContext(GifWorkspaceContext);
}

function GifWorkspaceSurface({
  data,
  onOpenWork,
  active,
  focused,
  route,
  onClose,
}: Omit<GifWorkspaceScopeProps, 'children'>) {
  const runtime = useContext(GifRuntimeContext);
  const navigation = useContext(GifNavigationContext);
  const labels = useI18n().messages.creator.gifMaker;
  const host = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => Symbol('gif-workspace'));
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; container: HTMLDivElement } | null>(null);
  const closeView = useStableCallback(onClose);
  const openWorkView = useStableCallback(onOpenWork);
  const routeKey = JSON.stringify(route);
  const documentId = route?.documentId;
  useEffect(() => {
    if (!runtime || !active || !documentId) return;
    let cancelled = false;
    let attached: HTMLDivElement | undefined;
    const target = host.current;
    setError(null);
    setLoaded(null);
    void runtime
      .ensure(documentId)
      .then((session) => {
        if (cancelled || !target) return;
        attached = session.container;
        setLoaded({ id: documentId, container: attached });
      })
      .catch((reason) => {
        if (!cancelled) setError(labels.errors[gifErrorCode(reason)]);
      });
    return () => {
      cancelled = true;
      if (attached?.parentElement === target) attached?.remove();
      runtime.present(documentId, owner, null);
    };
  }, [runtime, active, documentId, labels.errors, owner]);
  useEffect(() => {
    const target = host.current;
    if (!runtime || !navigation || !active || !route || loaded?.id !== route.documentId || !target) return;
    if (loaded.container.parentElement !== target) {
      if (loaded.container.isConnected && !focused) return;
      target.append(loaded.container);
    }
    const ownsView = () => navigation.isCurrent() && loaded.container.parentElement === target;
    runtime.present(route.documentId, owner, {
      owner,
      route,
      navigate: (location, mode) => {
        if (ownsView()) navigation.navigate(location, mode);
      },
      close: () => {
        if (ownsView()) closeView();
      },
      data,
      openWork: (target) => {
        if (ownsView()) openWorkView(target);
      },
    });
    // Preserve the mounted DOM and input focus when selection or title changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, active, focused, routeKey, loaded, navigation, closeView, data, openWorkView, owner]);
  return (
    <div className="relative size-full min-h-0" ref={host}>
      {error && (
        <div role="alert" className="p-4">
          {error}
        </div>
      )}
    </div>
  );
}
