import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  BootstrapDto,
  ImportedCreationOutputDto,
  IntakeCommitIntent,
  IntakeCommitResult,
  Locale,
  LocalSpaceTransitionEvent,
  NavigationCommand,
} from '@/shared/contracts';
import { resolveTermTitle } from '@/shared/term-localization';
import { AppSidebar, type AppView } from '@/renderer/components/app/AppSidebar';
import { AppTitleBar } from '@/renderer/components/app/AppTitleBar';
import { ReturnToMaterialsBar } from '@/renderer/components/app/ReturnToMaterialsBar';
import { SettingsDialog } from '@/renderer/components/app/SettingsDialog';
import {
  initialAppLocation,
  sameAppLocation,
  type AppLocation,
  type AiCenterLocation,
  type CreatorLocation,
  type DictionaryLocation,
  type ExtensionsLocation,
  type GalleryLocation,
  type HistoryNavigationGuard,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { useNavigationHistory } from '@/renderer/components/app/useNavigationHistory';
import { LocalSpaceTransitionOverlay } from '@/renderer/components/spaces/LocalSpaceTransitionOverlay';
import { Button } from '@/renderer/components/ui/button';
import { ToastViewport, useToastQueue } from '@/renderer/components/ui/toast';
import { AssetMenuActionsProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { LibraryStartScreen } from '@/renderer/features/intake/LibraryStartScreen';
import { mergeImportedOutput, mergeIntakeResult } from '@/renderer/features/intake/applyIntakeResult';
import type { AiActivityRecord } from '@/renderer/features/ai-center/AiCenterScreen';
import { generationReEditLocation } from '@/renderer/features/ai-center/generationReEditNavigation';
import { useCodexImagesNavigation } from '@/renderer/features/extensions/codexImageNavigation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { publishLanguagePluginState } from '@/renderer/i18n/languagePluginState';

const CreatorScreen = lazy(() =>
  import('@/renderer/components/CreatorScreen').then((module) => ({ default: module.CreatorScreen })),
);
const DictionaryScreen = lazy(() =>
  import('@/renderer/components/DictionaryScreen').then((module) => ({ default: module.DictionaryScreen })),
);
const GalleryScreen = lazy(() =>
  import('@/renderer/components/GalleryScreen').then((module) => ({ default: module.GalleryScreen })),
);
const ExtensionCenterScreen = lazy(() => import('@/renderer/features/extensions/ExtensionCenterScreen'));
const AiCenterScreen = lazy(() =>
  import('@/renderer/features/ai-center/AiCenterScreen').then((module) => ({ default: module.AiCenterScreen })),
);

// These are logical XButton inputs delivered by Chromium after mouse-driver remapping, not raw physical-button reads; keep the mapping explicit so it can become user-configurable.
const DEFAULT_MOUSE_NAVIGATION_BINDINGS = new Map<number, NavigationCommand>([
  [3, 'back'],
  [4, 'forward'],
]);

function ScreenBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="size-full bg-background" />}>{children}</Suspense>;
}

export function App() {
  const { locale, messages } = useI18n();
  const {
    current: location,
    navigate: navigateLocation,
    replace: replaceLocation,
    goBack: navigateBack,
    goForward: navigateForward,
    canGoBack,
    canGoForward,
  } = useNavigationHistory(initialAppLocation, sameAppLocation);
  const { view, materialsReturnContext } = location;
  const visitedViews = useRef(new Set<AppView>());
  visitedViews.current.add(view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [comparisonFullWindow, setComparisonFullWindow] = useState(false);
  const [creationPromptFullWindow, setCreationPromptFullWindow] = useState(false);
  const [defaultPromptLocale, setDefaultPromptLocale] = useState<Locale | null>(() => {
    const stored = localStorage.getItem('aiy.prompt-locale.v1');
    if (stored === 'none') return null;
    return stored === 'zh' ? 'zh' : 'en';
  });
  const [data, setData] = useState<BootstrapDto | null>(null);
  const [spaceTransition, setSpaceTransition] = useState<LocalSpaceTransitionEvent | null>(null);
  const preTransitionDataRef = useRef<BootstrapDto | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const creatorStartRevision = useRef(0);
  const [creatorActiveAlbumId, setCreatorActiveAlbumId] = useState<string | null>(null);
  const [galleryActiveAlbumId, setGalleryActiveAlbumId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const refreshRevision = useRef(0);
  const refreshQueueRef = useRef<{ requested: boolean; running: Promise<void> | null }>({
    requested: false,
    running: null,
  });
  const historyNavigationGuardRef = useRef<HistoryNavigationGuard | null>(null);
  const lastHistoryCommandRef = useRef<{ command: NavigationCommand; timestamp: number } | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const { messages: notifications, notify, dismiss: dismissNotification } = useToastQueue();
  const codexImagesNavigation = useCodexImagesNavigation(data?.extensions, view, replaceLocation);

  const loadData = useCallback(async () => {
    const revision = ++refreshRevision.current;
    const requestedLocale = localeRef.current;
    try {
      setError('');
      const next = await window.desktopApi.bootstrap(requestedLocale);
      if (refreshRevision.current !== revision || localeRef.current !== requestedLocale) return false;
      publishLanguagePluginState(next.extensions ?? []);
      setData(next);
      setDataRevision((current) => current + 1);
      return true;
    } catch (reason) {
      if (refreshRevision.current !== revision || localeRef.current !== requestedLocale) return false;
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, []);
  const refresh = useCallback(() => {
    const queue = refreshQueueRef.current;
    queue.requested = true;
    if (!queue.running) {
      queue.running = (async () => {
        try {
          while (queue.requested) {
            queue.requested = false;
            await loadData();
          }
        } finally {
          queue.running = null;
        }
      })();
    }
    return queue.running;
  }, [loadData]);

  const refreshAlbums = useCallback(async () => {
    const albums = await window.desktopApi.albumsList();
    setData((current) => (current ? { ...current, albums } : current));
    setDataRevision((current) => current + 1);
  }, []);

  const updateImportedOutput = useCallback((output: ImportedCreationOutputDto) => {
    setData((current) => mergeImportedOutput(current, output));
    setDataRevision((current) => current + 1);
  }, []);

  const applyIntakeResult = useCallback((result: IntakeCommitResult) => {
    setData((current) => mergeIntakeResult(current, result));
    setDataRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    void refresh();
  }, [locale, refresh]);
  useEffect(() => {
    localStorage.setItem('aiy.prompt-locale.v1', defaultPromptLocale ?? 'none');
  }, [defaultPromptLocale]);
  useEffect(
    () =>
      window.desktopApi.onGenerationChanged((event) => {
        setData((current) => (current ? { ...current, generationTasks: event.tasks } : current));
        // Reload bootstrap for an empty-run worker snapshot so its image-generation route catalog stays in sync with task updates.
        if (event.terminal || !event.runId) void refresh();
      }),
    [refresh],
  );
  useEffect(
    () =>
      window.desktopApi.onModelWorkerChanged((status) => {
        setData((current) => (current ? { ...current, modelWorker: status } : current));
      }),
    [],
  );
  useEffect(
    () =>
      window.desktopApi.onLocalSpaceTransition((transition) => {
        if (transition.phase === 'FAILED') {
          setData(preTransitionDataRef.current);
          preTransitionDataRef.current = null;
          setSpaceTransition(null);
          return;
        }
        setSpaceTransition(transition);
        setSettingsOpen(false);
        setComparisonFullWindow(false);
        setCreationPromptFullWindow(false);
        if (transition.phase === 'STARTING') {
          refreshRevision.current += 1;
          setData((current) => {
            preTransitionDataRef.current = current;
            return null;
          });
          return;
        }
        if (transition.phase === 'PROGRESS') return;
        setError('');
        setCreatorActiveAlbumId(null);
        setGalleryActiveAlbumId(null);
        void loadData().then((loaded) => {
          preTransitionDataRef.current = null;
          if (!loaded) {
            setSpaceTransition((current) => (current?.space.id === transition.space.id ? null : current));
            return;
          }
          setSpaceTransition((current) =>
            current?.space.id === transition.space.id
              ? { ...current, phase: 'COMPLETED', stage: 'READY', progress: 100 }
              : current,
          );
          window.setTimeout(() => {
            setSpaceTransition((current) => (current?.space.id === transition.space.id ? null : current));
          }, 220);
        });
      }),
    [loadData],
  );

  useEffect(() => {
    if (view !== 'creator') setCreationPromptFullWindow(false);
  }, [view]);

  const commitLocation = useCallback(
    (destination: AppLocation | ((current: AppLocation) => AppLocation), mode: NavigationMode = 'push') => {
      if (mode === 'replace') replaceLocation(destination);
      else navigateLocation(destination);
    },
    [navigateLocation, replaceLocation],
  );

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    const continueNavigation = () => {
      setComparisonFullWindow(false);
      navigateBack();
    };
    if (historyNavigationGuardRef.current?.('back', continueNavigation)) return;
    continueNavigation();
  }, [canGoBack, navigateBack]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    const continueNavigation = () => {
      setComparisonFullWindow(false);
      navigateForward();
    };
    if (historyNavigationGuardRef.current?.('forward', continueNavigation)) return;
    continueNavigation();
  }, [canGoForward, navigateForward]);

  const invokeHistoryNavigation = useCallback(
    (command: NavigationCommand) => {
      if (document.querySelector('[role="dialog"]')) return;
      const timestamp = performance.now();
      const previous = lastHistoryCommandRef.current;
      if (previous?.command === command && timestamp - previous.timestamp < 120) return;
      lastHistoryCommandRef.current = { command, timestamp };
      if (command === 'back') goBack();
      else goForward();
    },
    [goBack, goForward],
  );

  useEffect(() => window.desktopApi.onNavigationCommand(invokeHistoryNavigation), [invokeHistoryNavigation]);

  const setHistoryNavigationGuard = useCallback((guard: HistoryNavigationGuard | null) => {
    historyNavigationGuardRef.current = guard;
  }, []);

  const returnToMaterials = useCallback(() => {
    setComparisonFullWindow(false);
    if (canGoBack) {
      navigateBack();
      return;
    }
    navigateLocation((current) => ({ ...current, view: 'gallery', materialsReturnContext: null }));
  }, [canGoBack, navigateBack, navigateLocation]);

  const startCreation = useCallback(
    (albumId: string | null) => {
      setComparisonFullWindow(false);
      const requestId = ++creatorStartRevision.current;
      if (data?.libraryEmpty) {
        void window.desktopApi
          .creationDraftStart({ albumId, termPromptLocale: defaultPromptLocale ?? locale })
          .then(async () => {
            commitLocation(
              (current) => ({
                ...current,
                view: 'creator',
                creator: { surface: 'new-creation', albumId, requestId },
                materialsReturnContext: null,
              }),
              'replace',
            );
            await refresh();
          })
          .catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
      } else {
        commitLocation((current) => ({
          ...current,
          view: 'creator',
          creator: { surface: 'new-creation', albumId, requestId },
          materialsReturnContext: null,
        }));
      }
    },
    [commitLocation, data?.libraryEmpty, defaultPromptLocale, locale, notify, refresh],
  );

  const useAssetInCreation = useCallback(
    async (assetId: string) => {
      const albumId = view === 'gallery' ? galleryActiveAlbumId : view === 'creator' ? creatorActiveAlbumId : null;
      const draft = await window.desktopApi.creationDraftStart({
        albumId,
        termPromptLocale: defaultPromptLocale ?? locale,
      });
      const referenceAssetIds = [...new Set([...draft.referenceAssets.map((asset) => asset.id), assetId])];
      if (referenceAssetIds.length > 8) throw new Error(messages.assetFile.referenceLimit);
      const savedDraft = await window.desktopApi.creationDraftSave({
        id: draft.id,
        targetAlbumId: draft.targetAlbumId,
        title: draft.title,
        text: draft.text,
        promptNodes: draft.promptNodes,
        referenceAssetIds,
        termPromptLocale: draft.termPromptLocale,
        termIds: draft.termIds,
        wordPaletteReferences: draft.wordPaletteReferences,
        dictionaryScope: draft.dictionaryScope,
        canvasPresetKey: draft.canvasPresetKey,
        quality: draft.quality,
        selectedModelKeys: draft.selectedModelKeys,
        repeatCount: draft.repeatCount,
        modelTargets: draft.modelTargets,
      });
      await refresh();
      setComparisonFullWindow(false);
      setCreationPromptFullWindow(false);
      const requestId = ++creatorStartRevision.current;
      commitLocation((current) => ({
        ...current,
        view: 'creator',
        creator: { surface: 'new-creation', albumId: savedDraft.targetAlbumId, requestId },
        materialsReturnContext: null,
      }));
    },
    [
      commitLocation,
      creatorActiveAlbumId,
      defaultPromptLocale,
      galleryActiveAlbumId,
      locale,
      messages.assetFile.referenceLimit,
      refresh,
      view,
    ],
  );

  const assetMenuActions = useMemo(
    () => ({
      albums: data?.albums ?? [],
      useInCreation: useAssetInCreation,
      refreshLibrary: refresh,
    }),
    [data?.albums, refresh, useAssetInCreation],
  );

  const startNewCreationFromContext = useCallback(() => {
    const albumId = view === 'creator' ? creatorActiveAlbumId : view === 'gallery' ? galleryActiveAlbumId : null;
    startCreation(albumId);
  }, [creatorActiveAlbumId, galleryActiveAlbumId, startCreation, view]);

  useEffect(() => {
    const handleNewCreation = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'n'
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      startNewCreationFromContext();
    };
    window.addEventListener('keydown', handleNewCreation);
    return () => window.removeEventListener('keydown', handleNewCreation);
  }, [startNewCreationFromContext]);

  useEffect(() => {
    const handleHistoryNavigation = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const command: NavigationCommand | null =
        event.key === 'BrowserBack' || event.code === 'BrowserBack' || event.keyCode === 166
          ? 'back'
          : event.key === 'BrowserForward' || event.code === 'BrowserForward' || event.keyCode === 167
            ? 'forward'
            : event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowLeft'
              ? 'back'
              : event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowRight'
                ? 'forward'
                : null;
      if (!command) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      invokeHistoryNavigation(command);
    };
    window.addEventListener('keydown', handleHistoryNavigation);
    return () => window.removeEventListener('keydown', handleHistoryNavigation);
  }, [invokeHistoryNavigation]);

  useEffect(() => {
    const handleMouseNavigation = (event: MouseEvent) => {
      const command = DEFAULT_MOUSE_NAVIGATION_BINDINGS.get(event.button);
      if (!command) return;
      // Chromium may otherwise apply its own back/forward action after mouseup.
      event.preventDefault();
      invokeHistoryNavigation(command);
    };
    window.addEventListener('mouseup', handleMouseNavigation, true);
    return () => window.removeEventListener('mouseup', handleMouseNavigation, true);
  }, [invokeHistoryNavigation]);

  const returnSummary =
    materialsReturnContext?.destination === 'creator'
      ? (() => {
          const series = data?.series.find((item) => item.id === materialsReturnContext.seriesId);
          if (!series) return '';
          return series.title;
        })()
      : materialsReturnContext?.destination === 'dictionary'
        ? (() => {
            const term = data?.terms.find((item) => item.id === materialsReturnContext.termId);
            if (!term) return '';
            return resolveTermTitle(term, locale);
          })()
        : '';

  function changeView(nextView: AppView) {
    if (nextView === view) return;
    setComparisonFullWindow(false);
    navigateLocation((current) => ({
      ...current,
      view: nextView,
      materialsReturnContext: null,
    }));
  }

  function navigateCreator(creator: CreatorLocation, mode: NavigationMode = 'push') {
    commitLocation(
      (current) => ({
        ...current,
        view: 'creator',
        creator,
        materialsReturnContext: null,
      }),
      mode,
    );
  }

  async function openImportedCreation(seriesId: string, assetId: string | null) {
    await refresh();
    navigateCreator({ surface: 'existing-creation', seriesId, assetId });
  }

  function navigateDictionary(dictionary: DictionaryLocation, mode: NavigationMode = 'push') {
    commitLocation(
      (current) => ({
        ...current,
        view: 'dictionary',
        dictionary,
        materialsReturnContext: null,
      }),
      mode,
    );
  }

  function navigateGallery(gallery: GalleryLocation, mode: NavigationMode = 'push') {
    commitLocation(
      (current) => ({
        ...current,
        view: 'gallery',
        gallery,
        materialsReturnContext: null,
      }),
      mode,
    );
  }

  function navigateExtensions(extensions: ExtensionsLocation, mode: NavigationMode = 'push') {
    commitLocation(
      (current) => ({
        ...current,
        view: 'packs',
        extensions,
        materialsReturnContext: null,
      }),
      mode,
    );
  }

  function navigateAiCenter(aiCenter: AiCenterLocation, mode: NavigationMode = 'push') {
    commitLocation(
      (current) => ({
        ...current,
        view: 'aiCenter',
        aiCenter,
        materialsReturnContext: null,
      }),
      mode,
    );
  }

  function locateAiActivity(record: AiActivityRecord) {
    setComparisonFullWindow(false);
    if (record.kind === 'ASSISTANT' && record.run.creationId) {
      navigateCreator({ surface: 'idea-creation', creationId: record.run.creationId });
      return;
    }
    if (record.sourceSeries) {
      const assetId = record.kind === 'GENERATION' ? (record.run.asset?.id ?? null) : null;
      navigateCreator({ surface: 'existing-creation', seriesId: record.sourceSeries.id, assetId });
      return;
    }
    const scope =
      record.kind === 'ASSISTANT' ? record.run.scope : record.kind === 'EXPERIMENT' ? record.batch.scope : null;
    if (scope?.kind === 'DRAFT' && data?.creationDraft?.id === scope.id) {
      navigateCreator({ surface: 'new-creation', albumId: data.creationDraft.targetAlbumId });
    }
  }

  const manageAiPlugins = (pluginId: string | null = null) =>
    navigateExtensions({ tab: 'plugins', pluginId, packId: null });

  function openGalleryResult(seriesId: string, assetId: string) {
    setComparisonFullWindow(false);
    navigateLocation((current) => ({
      ...current,
      view: 'creator',
      creator: { surface: 'existing-creation', seriesId, assetId },
      materialsReturnContext: { destination: 'creator', seriesId },
    }));
  }

  function openGalleryTerm(termId: string) {
    setComparisonFullWindow(false);
    navigateLocation((current) => ({
      ...current,
      view: 'dictionary',
      dictionary: { surface: 'detail', termId, browseContext: null },
      materialsReturnContext: { destination: 'dictionary', termId },
    }));
  }

  function openCreatorMaterial(materialId: string) {
    setComparisonFullWindow(false);
    navigateLocation((current) => ({
      ...current,
      view: 'gallery',
      materialsReturnContext: null,
      gallery: {
        collection: { kind: 'all' },
        selectedMaterialKey: null,
        requestedMaterialId: materialId,
      },
    }));
  }

  async function finishIntake(intent: IntakeCommitIntent, result?: IntakeCommitResult) {
    setComparisonFullWindow(false);
    const creatorLocation: CreatorLocation | null =
      intent === 'START_CREATION'
        ? {
            surface: 'new-creation',
            albumId: result?.draft?.targetAlbumId ?? null,
            requestId: ++creatorStartRevision.current,
          }
        : null;
    navigateLocation((current) => ({
      ...current,
      view: intent === 'START_CREATION' ? 'creator' : 'gallery',
      creator: creatorLocation ?? current.creator,
      gallery:
        intent === 'IMPORT'
          ? {
              collection: { kind: 'all' },
              selectedMaterialKey: null,
              requestedMaterialId: result?.imageMaterialIds[0] ?? result?.materialIds[0] ?? null,
            }
          : current.gallery,
    }));
    // The commit result already carries everything the screens need. Reloading
    // the whole bootstrap here is what made an import feel like a freeze.
    if (result) {
      applyIntakeResult(result);
      return;
    }
    await refresh();
  }

  async function finishGalleryIntake(result: IntakeCommitResult) {
    if (result.intent === 'START_CREATION') {
      await finishIntake(result.intent, result);
      return;
    }
    applyIntakeResult(result);
  }

  async function cancelGeneration(runId: string) {
    await window.desktopApi.generationCancel(runId);
    await refresh();
  }

  async function retryGeneration(runId: string) {
    await window.desktopApi.generationRetry(runId);
    await refresh();
  }

  function reEditGeneration(runId: string) {
    const next = data && generationReEditLocation(data, runId, Date.now());
    if (!next)
      return void notify(
        locale === 'zh' ? '找不到该生成任务所属的创作' : 'The creation for this generation is unavailable',
      );
    setComparisonFullWindow(false);
    navigateCreator(next);
  }

  return (
    <AssetMenuActionsProvider value={assetMenuActions}>
      <main
        className={
          creationPromptFullWindow
            ? 'grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-background'
            : 'grid h-full min-h-0 grid-rows-[36px_minmax(0,1fr)] overflow-hidden bg-background'
        }
      >
        {!creationPromptFullWindow && (
          <AppTitleBar
            workerStatus={data?.modelWorker ?? null}
            codexHealth={data?.codex ?? null}
            generationTasks={data?.generationTasks ?? []}
            imageGenerationRoutes={data?.imageGenerationRoutes ?? []}
            assistantRuns={data?.assistantRuns ?? []}
            agentTasks={data?.agentTasks ?? []}
            series={data?.series ?? []}
            view={view}
            menuDisabled={Boolean(spaceTransition)}
            codexImagesVisible={codexImagesNavigation.visible}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            notify={notify}
            onNewCreation={startNewCreationFromContext}
            onViewChange={changeView}
            onSettingsOpen={() => setSettingsOpen(true)}
            onQuit={() => {
              void window.desktopApi.appRequestQuit();
            }}
            onGoBack={goBack}
            onGoForward={goForward}
            onGenerationCancel={cancelGeneration}
            onGenerationRetry={retryGeneration}
            onGenerationReEdit={reEditGeneration}
          />
        )}
        <div className="flex min-h-0 overflow-hidden">
          <div className={comparisonFullWindow || creationPromptFullWindow ? 'hidden' : 'contents'}>
            <AppSidebar
              spaceName={spaceTransition?.space.name ?? data?.spaceName ?? messages.app.libraryFallback}
              spaceCoverUrl={spaceTransition?.space.coverUrl ?? data?.spaceCoverUrl ?? null}
              spaceTransitioning={Boolean(spaceTransition)}
              libraryBusy={Boolean(data?.generationTasks.length)}
              codexImagesVisible={codexImagesNavigation.visible}
              view={view}
              onViewChange={changeView}
              onSettingsOpen={() => setSettingsOpen(true)}
              notify={notify}
            />
          </div>
          <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {spaceTransition && <LocalSpaceTransitionOverlay transition={spaceTransition} />}
            {!data && !error && (
              <div className="grid size-full place-items-center text-muted-foreground">{messages.app.loading}</div>
            )}
            {error && (
              <div className="flex size-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <strong className="text-foreground">{messages.app.unavailable}</strong>
                <small className="max-w-lg text-center">{error}</small>
                <Button variant="outline" onClick={() => void refresh()}>
                  {messages.app.retry}
                </Button>
              </div>
            )}
            {data && data.libraryEmpty && view === 'creator' && (
              <LibraryStartScreen
                onCommitted={(result) => void finishIntake(result.intent, result)}
                onContentPackImported={refresh}
                notify={notify}
              />
            )}
            {data && !data.libraryEmpty && visitedViews.current.has('creator') && (
              <div className={view === 'creator' ? 'flex size-full min-h-0 flex-col' : 'hidden'}>
                {materialsReturnContext?.destination === 'creator' &&
                  !comparisonFullWindow &&
                  !creationPromptFullWindow && (
                    <ReturnToMaterialsBar
                      label={messages.gallery.screen.backToMaterials}
                      summary={returnSummary}
                      onReturn={returnToMaterials}
                    />
                  )}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ScreenBoundary>
                    <CreatorScreen
                      data={data}
                      locale={locale}
                      defaultPromptLocale={defaultPromptLocale}
                      active={view === 'creator'}
                      location={location.creator}
                      comparisonFullWindow={comparisonFullWindow}
                      promptFullWindow={creationPromptFullWindow}
                      onNavigate={navigateCreator}
                      onComparisonFullWindowChange={setComparisonFullWindow}
                      onPromptFullWindowChange={setCreationPromptFullWindow}
                      onOpenMaterial={openCreatorMaterial}
                      onConfigureExtension={manageAiPlugins}
                      onActiveAlbumChange={setCreatorActiveAlbumId}
                      refresh={refresh}
                      refreshAlbums={refreshAlbums}
                      onImportedOutputSaved={updateImportedOutput}
                      notify={notify}
                    />
                  </ScreenBoundary>
                </div>
              </div>
            )}
            {data && visitedViews.current.has('dictionary') && (
              <div className={view === 'dictionary' ? 'flex size-full min-h-0 flex-col' : 'hidden'}>
                {materialsReturnContext?.destination === 'dictionary' && (
                  <ReturnToMaterialsBar
                    label={messages.gallery.screen.backToMaterials}
                    summary={returnSummary}
                    onReturn={returnToMaterials}
                  />
                )}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ScreenBoundary>
                    <DictionaryScreen
                      data={data}
                      active={view === 'dictionary'}
                      location={location.dictionary}
                      onNavigate={navigateDictionary}
                      onNavigateBack={goBack}
                      onHistoryNavigationGuardChange={setHistoryNavigationGuard}
                      refresh={refresh}
                      notify={notify}
                    />
                  </ScreenBoundary>
                </div>
              </div>
            )}
            {data && visitedViews.current.has('gallery') && (
              <div className={view === 'gallery' ? 'size-full' : 'hidden'}>
                <ScreenBoundary>
                  <GalleryScreen
                    libraryKey={data.spaceName}
                    dataRevision={dataRevision}
                    active={view === 'gallery'}
                    location={location.gallery}
                    onNavigate={navigateGallery}
                    onNavigateBack={goBack}
                    terms={data.terms}
                    facets={data.facets}
                    series={data.series}
                    onOpenResult={openGalleryResult}
                    onOpenTerm={openGalleryTerm}
                    onIntakeCommitted={finishGalleryIntake}
                    onActiveAlbumChange={setGalleryActiveAlbumId}
                    refresh={refresh}
                    notify={notify}
                  />
                </ScreenBoundary>
              </div>
            )}
            {data && (visitedViews.current.has('packs') || visitedViews.current.has('codexImages')) && (
              <div className={view === 'packs' || view === 'codexImages' ? 'size-full' : 'hidden'}>
                <ScreenBoundary>
                  <ExtensionCenterScreen
                    activeSurface={view === 'codexImages' ? 'discovery' : view === 'packs' ? 'center' : null}
                    extensions={data.extensions ?? []}
                    location={location.extensions}
                    onNavigate={navigateExtensions}
                    onExtensionsChange={refresh}
                    codexImagesNavigation={codexImagesNavigation}
                    onOpenCreation={openImportedCreation}
                    notify={notify}
                  />
                </ScreenBoundary>
              </div>
            )}
            {data && visitedViews.current.has('aiCenter') && (
              <div className={view === 'aiCenter' ? 'size-full' : 'hidden'}>
                <ScreenBoundary>
                  <AiCenterScreen
                    active={view === 'aiCenter'}
                    data={data}
                    locale={locale}
                    location={location.aiCenter}
                    onNavigate={navigateAiCenter}
                    onLocate={locateAiActivity}
                    onReEditGeneration={reEditGeneration}
                    onManagePlugins={manageAiPlugins}
                    onRetryGeneration={retryGeneration}
                    refresh={refresh}
                    notify={notify}
                  />
                </ScreenBoundary>
              </div>
            )}
          </section>
        </div>
        <SettingsDialog
          promptLocale={defaultPromptLocale}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onPromptLocaleChange={setDefaultPromptLocale}
          onAiFeatureModelsOpen={() => navigateAiCenter({ tab: 'capabilities', recordId: null })}
        />
        <ToastViewport
          messages={notifications}
          label={messages.app.notifications}
          closeLabel={messages.common.close}
          onDismiss={dismissNotification}
        />
      </main>
    </AssetMenuActionsProvider>
  );
}
