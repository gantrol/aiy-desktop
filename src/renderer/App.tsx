import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BootstrapDto,
  ImportedCreationOutputDto,
  IntakeCommitIntent,
  IntakeCommitResult,
  Locale,
  LocalSpaceTransitionEvent,
  NavigationCommand,
} from '@/shared/contracts';
import { AppSidebar, type AppView } from '@/renderer/components/app/AppSidebar';
import {
  APP_LOADING_VARIANTS as loadingVariants,
  AppLoadingState,
  useAppLoadingPreviews,
} from '@/renderer/components/app/AppLoadingState';
import { AppTitleBar } from '@/renderer/components/app/AppTitleBar';
import { SettingsDialog } from '@/renderer/components/app/SettingsDialog';
import { AppWorkspaceViews } from '@/renderer/components/app/AppWorkspaceViews';
import { createWorkspaceLoadingBoundaries } from '@/renderer/components/app/appWorkspaceLoadingBoundaries';
import { useTermDetails } from '@/renderer/components/app/useTermDetails';
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
  type VideoDocumentsLocation,
} from '@/renderer/components/app/app-navigation';
import { useNavigationHistory } from '@/renderer/components/app/useNavigationHistory';
import { LocalSpaceTransitionOverlay } from '@/renderer/components/spaces/LocalSpaceTransitionOverlay';
import { Button } from '@/renderer/components/ui/button';
import { ToastViewport, useToastQueue } from '@/renderer/components/ui/toast';
import { AssetMenuActionsProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { mergeImportedOutput, mergeIntakeResult } from '@/renderer/features/intake/applyIntakeResult';
import { LibraryStartScreen } from '@/renderer/features/intake/lazyLibraryStartScreen';
import type { AiActivityRecord } from '@/renderer/features/ai-center/AiCenterScreen';
import { aiActivityNavigationTarget } from '@/renderer/features/ai-center/aiActivityNavigation';
import { generationReEditLocation } from '@/renderer/features/ai-center/generationReEditNavigation';
import { useCodexImagesNavigation } from '@/renderer/features/extensions/codexImageNavigation';
import { useTransitionShowcaseNavigation } from '@/renderer/features/extensions/transitionShowcaseNavigation';
import { useVideoDocumentTranscriptBackgroundTasks } from '@/renderer/features/video-documents/useVideoDocumentTranscriptBackgroundTasks';
import { useAppUpdateNotification } from '@/renderer/features/app-update/useAppUpdateNotification';
import { ContentManagementScreen } from '@/renderer/features/content-management/ContentManagementScreen';
import { loadCreatorScreen } from '@/renderer/features/creator/lazyCreatorScreen';
import { useI18n } from '@/renderer/i18n/useI18n';
import { publishLanguagePluginState } from '@/renderer/i18n/languagePluginState';
import { mergeGenerationProjection, useGenerationProjectionEvents } from '@/renderer/generationProjectionRefresh';
import { createTrailingRefreshQueue, requestTrailingRefresh, synchronizeRefresh } from '@/renderer/startupRefreshQueue';
import { appGridRows, appMaterialsReturnSummary, DEFAULT_MOUSE_NAVIGATION_BINDINGS } from '@/renderer/appPresentation';

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
  const preTransitionVisitedViewsRef = useRef<Set<AppView> | null>(null);
  visitedViews.current.add(view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [comparisonFullWindow, setComparisonFullWindow] = useState(false);
  const [creationPromptFullWindow, setCreationPromptFullWindow] = useState(false);
  const appFullWindow = comparisonFullWindow || creationPromptFullWindow;
  const [defaultPromptLocale, setDefaultPromptLocale] = useState<Locale | null>(() => {
    const stored = localStorage.getItem('aiy.prompt-locale.v1');
    if (stored === 'none') return null;
    return stored === 'zh' ? 'zh' : 'en';
  });
  const [data, setData] = useState<BootstrapDto | null>(null);
  const { tasks: transcriptBackgroundTasks, lastTerminal: lastTranscriptTerminal } =
    useVideoDocumentTranscriptBackgroundTasks();
  const [spaceTransition, setSpaceTransition] = useState<LocalSpaceTransitionEvent | null>(null);
  const preTransitionDataRef = useRef<BootstrapDto | null>(null);
  const {
    previews: loadingPreviews,
    requestInitial: requestInitialLoadingPreviews,
    applyTransition: applyLoadingPreviewTransition,
  } = useAppLoadingPreviews();
  const [dataRevision, setDataRevision] = useState(0);
  const [documentNavigationRevision, setDocumentNavigationRevision] = useState(0);
  const creatorStartRevision = useRef(0);
  const [creatorActiveAlbumId, setCreatorActiveAlbumId] = useState<string | null>(null);
  const [galleryActiveAlbumId, setGalleryActiveAlbumId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const showLoadingState = !spaceTransition && !data && !error;
  const refreshRevision = useRef(0);
  const refreshQueueRef = useRef(createTrailingRefreshQueue<Locale>());
  const historyNavigationGuardRef = useRef<HistoryNavigationGuard | null>(null);
  const lastHistoryCommandRef = useRef<{ command: NavigationCommand; timestamp: number } | null>(null);
  const lastNotifiedTranscriptOperationIdRef = useRef<string | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const { messages: notifications, notify, dismiss: dismissNotification } = useToastQueue();
  useAppUpdateNotification({ settingsOpen, notify });
  const codexImagesNavigation = useCodexImagesNavigation(data?.extensions, view, replaceLocation);
  const transitionShowcaseNavigation = useTransitionShowcaseNavigation(data?.extensions, view, replaceLocation);
  const workspaceLoadingBoundaries = useMemo(
    () => createWorkspaceLoadingBoundaries(loadingPreviews, view),
    [loadingPreviews, view],
  );

  const loadData = useCallback(async () => {
    const revision = ++refreshRevision.current;
    const requestedLocale = localeRef.current;
    try {
      setError('');
      const next = await window.desktopApi.bootstrap(requestedLocale);
      if (refreshRevision.current !== revision || localeRef.current !== requestedLocale) return false;
      publishLanguagePluginState(next.extensions ?? [], { reloadLanguagePacks: false });
      setData(next);
      setDataRevision((current) => current + 1);
      return true;
    } catch (reason) {
      if (refreshRevision.current !== revision || localeRef.current !== requestedLocale) return false;
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, []);
  const refresh = useCallback(() => requestTrailingRefresh(refreshQueueRef.current, loadData), [loadData]);

  const requestTermDetails = useTermDetails({
    data,
    view,
    refreshRevision,
    localeRef,
    setData,
    setDataRevision,
    notify,
  });

  const refreshAlbums = useCallback(async () => {
    const albums = await window.desktopApi.albumsList(localeRef.current);
    setData((current) => (current ? { ...current, albums } : current));
    setDataRevision((current) => current + 1);
    setDocumentNavigationRevision((current) => current + 1);
  }, []);

  const updateImportedOutput = useCallback((output: ImportedCreationOutputDto) => {
    setData((current) => mergeImportedOutput(current, output));
    setDataRevision((current) => current + 1);
  }, []);

  const refreshDocumentNavigation = useCallback(() => setDocumentNavigationRevision((current) => current + 1), []);

  useEffect(() => {
    if (!lastTranscriptTerminal) return;
    if (lastNotifiedTranscriptOperationIdRef.current === lastTranscriptTerminal.operationId) return;
    lastNotifiedTranscriptOperationIdRef.current = lastTranscriptTerminal.operationId;
    if (lastTranscriptTerminal.status === 'succeeded') {
      refreshDocumentNavigation();
      notify(messages.videoDocuments.transcript.recognition.completed);
      return;
    }
    if (lastTranscriptTerminal.code !== 'CANCELLED') {
      notify(messages.videoDocuments.transcript.recognition.errors[lastTranscriptTerminal.code]);
    }
  }, [lastTranscriptTerminal, messages.videoDocuments.transcript.recognition, notify, refreshDocumentNavigation]);

  const applyIntakeResult = useCallback((result: IntakeCommitResult) => {
    setData((current) => mergeIntakeResult(current, result));
    setDataRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    requestInitialLoadingPreviews();
    void loadCreatorScreen().catch(() => undefined);
    void synchronizeRefresh(refreshQueueRef.current, locale, loadData);
  }, [loadData, locale, requestInitialLoadingPreviews]);
  useEffect(() => {
    localStorage.setItem('aiy.prompt-locale.v1', defaultPromptLocale ?? 'none');
  }, [defaultPromptLocale]);
  useGenerationProjectionEvents({
    refreshAll: refresh,
    waitForFullRefresh: () => refreshQueueRef.current.running ?? Promise.resolve(),
    readLocale: () => localeRef.current,
    readFullRefreshRevision: () => refreshRevision.current,
    load: (requestedLocale) => window.desktopApi.generationProjection(requestedLocale),
    applyTasks: (tasks) => setData((current) => (current ? { ...current, generationTasks: tasks } : current)),
    apply: (projection) => {
      setData((current) => mergeGenerationProjection(current, projection));
      setDataRevision((current) => current + 1);
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : String(reason)),
  });
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
        applyLoadingPreviewTransition(transition);
        if (transition.phase === 'FAILED') {
          const previousVisitedViews = preTransitionVisitedViewsRef.current;
          if (previousVisitedViews) visitedViews.current = previousVisitedViews;
          preTransitionVisitedViewsRef.current = null;
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
          preTransitionVisitedViewsRef.current = new Set(visitedViews.current);
          visitedViews.current = new Set([view]);
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
          preTransitionVisitedViewsRef.current = null;
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
    [applyLoadingPreviewTransition, loadData, view],
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

  const createDocumentFromVideo = useCallback(
    async (materialId: string, albumId: string | null) => {
      try {
        const document = await window.desktopApi.videoDocumentCreate({
          videoMaterialId: materialId,
          title: '',
          titleLocale: locale,
          albumId,
        });
        void refreshAlbums().catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
        commitLocation((current) => ({
          ...current,
          view: 'documents',
          documents: {
            collection: document.albumId ? { kind: 'album', albumId: document.albumId } : { kind: 'unfiled' },
            documentId: document.id,
          },
          materialsReturnContext: { destination: 'documents', documentId: document.id, title: document.title },
        }));
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [commitLocation, locale, notify, refreshAlbums],
  );

  const assetMenuActions = useMemo(
    () => ({
      albums: data?.albums ?? [],
      notify,
      useInCreation: useAssetInCreation,
      createDocumentFromVideo,
      refreshLibrary: refresh,
    }),
    [createDocumentFromVideo, data?.albums, notify, refresh, useAssetInCreation],
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

  const returnSummary = appMaterialsReturnSummary(materialsReturnContext, data, locale);

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

  function navigateVideoDocuments(documents: VideoDocumentsLocation, mode: NavigationMode = 'push') {
    setComparisonFullWindow(false);
    setCreationPromptFullWindow(false);
    commitLocation(
      (current) => ({
        ...current,
        view: 'documents',
        documents,
        materialsReturnContext:
          current.materialsReturnContext?.destination === 'documents' &&
          documents.documentId === current.materialsReturnContext.documentId
            ? current.materialsReturnContext
            : null,
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
    const target = aiActivityNavigationTarget(record, data);
    if (target?.view === 'documents') navigateVideoDocuments(target.location);
    if (target?.view === 'creator') navigateCreator(target.location);
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

  async function cancelTranscriptRecognition(operationId: string) {
    await window.desktopApi.videoDocumentTranscriptRecognitionCancel(operationId);
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
      <main className={`grid h-full min-h-0 overflow-hidden bg-background ${appGridRows(appFullWindow)}`}>
        {!appFullWindow && (
          <AppTitleBar
            workerStatus={data?.modelWorker ?? null}
            codexHealth={data?.codex ?? null}
            generationTasks={data?.generationTasks ?? []}
            transcriptBackgroundTasks={transcriptBackgroundTasks}
            imageGenerationRoutes={data?.imageGenerationRoutes ?? []}
            assistantRuns={data?.assistantRuns ?? []}
            agentTasks={data?.agentTasks ?? []}
            series={data?.series ?? []}
            view={view}
            menuDisabled={Boolean(spaceTransition)}
            codexImagesVisible={codexImagesNavigation.visible}
            transitionShowcaseVisible={transitionShowcaseNavigation.visible}
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
            onTranscriptRecognitionCancel={cancelTranscriptRecognition}
            onGenerationRetry={retryGeneration}
            onGenerationReEdit={reEditGeneration}
          />
        )}
        <div className="flex min-h-0 overflow-hidden">
          <div className={appFullWindow ? 'hidden' : 'contents'}>
            <AppSidebar
              spaceName={spaceTransition?.space.name ?? data?.spaceName ?? messages.app.libraryFallback}
              spaceCoverUrl={spaceTransition?.space.coverUrl ?? data?.spaceCoverUrl ?? null}
              spaceTransitioning={Boolean(spaceTransition)}
              libraryBusy={Boolean(data?.generationTasks.length || transcriptBackgroundTasks.length)}
              codexImagesVisible={codexImagesNavigation.visible}
              transitionShowcaseVisible={transitionShowcaseNavigation.visible}
              view={view}
              onViewChange={changeView}
              onSettingsOpen={() => setSettingsOpen(true)}
              notify={notify}
            />
          </div>
          <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {spaceTransition && <LocalSpaceTransitionOverlay transition={spaceTransition} />}
            {showLoadingState && <AppLoadingState previews={loadingPreviews} variant={loadingVariants[view]} />}
            {error && (
              <div className="flex size-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <strong className="text-foreground">{messages.app.unavailable}</strong>
                <small className="max-w-lg text-center">{error}</small>
                <Button variant="outline" onClick={() => void refresh()}>
                  {messages.app.retry}
                </Button>
              </div>
            )}
            {data &&
              data.libraryEmpty &&
              view === 'creator' &&
              workspaceLoadingBoundaries.creator(
                <LibraryStartScreen
                  onCommitted={(result) => void finishIntake(result.intent, result)}
                  onContentPackImported={refresh}
                  notify={notify}
                />,
              )}
            {data && (
              <AppWorkspaceViews
                view={view}
                visitedViews={visitedViews.current}
                data={data}
                dataRevision={dataRevision}
                locale={locale}
                defaultPromptLocale={defaultPromptLocale}
                location={location}
                comparisonFullWindow={comparisonFullWindow}
                creationPromptFullWindow={creationPromptFullWindow}
                materialsReturnContext={materialsReturnContext}
                returnSummary={returnSummary}
                codexImagesNavigation={codexImagesNavigation}
                transitionShowcaseNavigation={transitionShowcaseNavigation}
                loadingBoundaries={workspaceLoadingBoundaries}
                onReturnToMaterials={returnToMaterials}
                documentNavigationRevision={documentNavigationRevision}
                onCreatorNavigate={navigateCreator}
                onComparisonFullWindowChange={setComparisonFullWindow}
                onCreationPromptFullWindowChange={setCreationPromptFullWindow}
                onOpenCreatorMaterial={openCreatorMaterial}
                onConfigureExtension={manageAiPlugins}
                onCreatorActiveAlbumChange={setCreatorActiveAlbumId}
                refresh={refresh}
                refreshAlbums={refreshAlbums}
                onTermDetailsRequest={requestTermDetails}
                onImportedOutputSaved={updateImportedOutput}
                notify={notify}
                onVideoDocumentsChange={refreshDocumentNavigation}
                onVideoDocumentsNavigate={navigateVideoDocuments}
                onDictionaryNavigate={navigateDictionary}
                onNavigateBack={goBack}
                onHistoryNavigationGuardChange={setHistoryNavigationGuard}
                onOpenDictionaryCreation={(seriesId, assetId, versionId) =>
                  navigateCreator({
                    surface: 'existing-creation',
                    seriesId,
                    assetId,
                    ...(versionId ? { versionId } : {}),
                  })
                }
                onGalleryNavigate={navigateGallery}
                onOpenGalleryResult={openGalleryResult}
                onOpenGalleryTerm={openGalleryTerm}
                onGalleryIntakeCommitted={finishGalleryIntake}
                onGalleryActiveAlbumChange={setGalleryActiveAlbumId}
                onExtensionsNavigate={navigateExtensions}
                onOpenImportedCreation={openImportedCreation}
                onAiCenterNavigate={navigateAiCenter}
                onLocateAiActivity={locateAiActivity}
                onReEditGeneration={reEditGeneration}
                onRetryGeneration={retryGeneration}
              />
            )}
            {data && view === 'contentManagement' && (
              <ContentManagementScreen
                active
                canNavigateBack={canGoBack}
                onNavigateBack={goBack}
                onContentChange={refresh}
                notify={notify}
              />
            )}
          </section>
        </div>
        <SettingsDialog
          promptLocale={defaultPromptLocale}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onPromptLocaleChange={setDefaultPromptLocale}
          onAiFeatureModelsOpen={() => navigateAiCenter({ tab: 'capabilities', recordId: null })}
          onContentManagementOpen={() => changeView('contentManagement')}
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
