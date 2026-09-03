import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BootstrapDto,
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
import { useTermDetails } from '@/renderer/components/app/useTermDetails';
import {
  initialAppLocation,
  type AppLocation,
  type AiCenterLocation,
  type HistoryNavigationGuard,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { useAppDeepLinkNavigation } from '@/renderer/components/app/useAppDeepLinkNavigation';
import { useWorkspaceController } from '@/renderer/components/workspace/useWorkspaceController';
import { useWorkspaceAlbumContext } from '@/renderer/components/workspace/useWorkspaceAlbumContext';
import { AppWorkspaceGroup } from '@/renderer/components/workspace/AppWorkspaceGroup';
import { WorkspaceSplitLayout } from '@/renderer/components/workspace/WorkspaceSplitLayout';
import {
  activeLocation as workspaceTabLocation,
  findWorkspaceTab,
  type WorkspaceRuntimeGroup,
} from '@/renderer/components/workspace/workspace-state';
import { workspaceLocationCanSplit, workspaceLocationKey } from '@/renderer/components/workspace/workspace-location';
import { LocalSpaceTransitionOverlay } from '@/renderer/components/spaces/LocalSpaceTransitionOverlay';
import { Button } from '@/renderer/components/ui/button';
import { ToastViewport, useToastQueue } from '@/renderer/components/ui/toast';
import { useAppAssetMenuActions } from '@/renderer/components/media/useAppAssetMenuActions';
import { mergeIntakeResult } from '@/renderer/features/intake/applyIntakeResult';
import { generationReEditLocation } from '@/renderer/features/ai-center/generationReEditNavigation';
import { useCodexImagesNavigation } from '@/renderer/features/extensions/codexImageNavigation';
import { useTransitionShowcaseNavigation } from '@/renderer/features/extensions/transitionShowcaseNavigation';
import { useVideoDocumentTranscriptBackgroundTasks } from '@/renderer/features/video-documents/useVideoDocumentTranscriptBackgroundTasks';
import { useAppUpdateNotification } from '@/renderer/features/app-update/useAppUpdateNotification';
import { loadCreatorScreen } from '@/renderer/features/creator/lazyCreatorScreen';
import { useI18n } from '@/renderer/i18n/useI18n';
import { publishLanguagePluginState } from '@/renderer/i18n/languagePluginState';
import { mergeGenerationProjection, useGenerationProjectionEvents } from '@/renderer/generationProjectionRefresh';
import { createTrailingRefreshQueue, requestTrailingRefresh, synchronizeRefresh } from '@/renderer/startupRefreshQueue';
import { appGridRows } from '@/renderer/appPresentation';
import { useAppDataUpdates } from '@/renderer/useAppDataUpdates';
import { ArticleEditorSessionRegistryProvider } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useAppWorkspaceShortcuts } from '@/renderer/commands/useAppWorkspaceShortcuts';
import { AppRuntimeProviders } from '@/renderer/components/app/AppRuntimeProviders';

function newWorkspaceTabLocation(destination: AppLocation['view'] | AppLocation) {
  return typeof destination === 'string' ? { ...initialAppLocation, view: destination } : destination;
}

export function App() {
  const { locale, messages } = useI18n();
  const [data, setData] = useState<BootstrapDto | null>(null);
  const workspace = useWorkspaceController(data);
  const workspaceState = workspace.state;
  const navigateWorkspace = workspace.navigate;
  const goBackWorkspace = workspace.goBack;
  const goForwardWorkspace = workspace.goForward;
  const flushWorkspace = workspace.flush;
  const location = workspace.activeLocation ?? initialAppLocation;
  const activeTab = workspace.activeTab;
  const activeTabId = activeTab?.id ?? null;
  const workspaceAlbums = useWorkspaceAlbumContext(data?.spaceId ?? null, activeTabId);
  const navigateLocation = useCallback(
    (destination: AppLocation | ((current: AppLocation) => AppLocation)) => {
      if (activeTabId) navigateWorkspace(activeTabId, destination, 'push');
    },
    [activeTabId, navigateWorkspace],
  );
  const replaceLocation = useCallback(
    (destination: AppLocation | ((current: AppLocation) => AppLocation)) => {
      if (activeTabId) navigateWorkspace(activeTabId, destination, 'replace');
    },
    [activeTabId, navigateWorkspace],
  );
  const canGoBack = Boolean(activeTab && activeTab.history.index > 0);
  const canGoForward = Boolean(activeTab && activeTab.history.index < activeTab.history.entries.length - 1);
  const { view } = location;
  const visibleViews = useMemo(
    () =>
      workspaceState?.groups.map((group) => {
        const tab = group.tabs.find((candidate) => candidate.id === group.activeTabId) ?? group.tabs[0];
        return workspaceTabLocation(tab).view;
      }) ?? [view],
    [view, workspaceState],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [comparisonFullWindow, setComparisonFullWindow] = useState(false);
  const [creationPromptFullWindow, setCreationPromptFullWindow] = useState(false);
  useAppDeepLinkNavigation(navigateLocation, setSettingsOpen, setComparisonFullWindow, setCreationPromptFullWindow);
  const appFullWindow = comparisonFullWindow || creationPromptFullWindow;
  const [defaultPromptLocale, setDefaultPromptLocale] = useState<Locale | null>(() => {
    const stored = localStorage.getItem('aiy.prompt-locale.v1');
    if (stored === 'none') return null;
    return stored === 'zh' ? 'zh' : 'en';
  });
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
  const [error, setError] = useState('');
  const workspaceReady = Boolean(data && workspaceState?.spaceId === data.spaceId);
  const showLoadingState = !spaceTransition && (!data || !workspaceReady) && !error;
  const refreshRevision = useRef(0);
  const refreshQueueRef = useRef(createTrailingRefreshQueue<Locale>());
  const historyNavigationGuardsRef = useRef(new Map<string, HistoryNavigationGuard>());
  const articleLocationFlushersRef = useRef(new Map<string, () => void>());
  const setArticleLocationFlusher = useCallback((tabId: string, flush: (() => void) | null) => {
    if (flush) articleLocationFlushersRef.current.set(tabId, flush);
    else articleLocationFlushersRef.current.delete(tabId);
  }, []);
  const lastHistoryCommandRef = useRef<{ command: NavigationCommand; timestamp: number } | null>(null);
  const lastNotifiedTranscriptOperationIdRef = useRef<string | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  useEffect(() => {
    const flushBeforePageExit = () => {
      articleLocationFlushersRef.current.forEach((flush) => flush());
      void flushWorkspace();
    };
    window.addEventListener('pagehide', flushBeforePageExit);
    return () => window.removeEventListener('pagehide', flushBeforePageExit);
  }, [flushWorkspace]);
  const { messages: notifications, notify, dismiss: dismissNotification } = useToastQueue();
  useAppUpdateNotification({ settingsOpen, notify });
  const codexImagesNavigation = useCodexImagesNavigation(data?.extensions, view, replaceLocation);
  const transitionShowcaseNavigation = useTransitionShowcaseNavigation(data?.extensions, view, replaceLocation);

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
    views: visibleViews,
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

  const { updateArticle, updateImportedOutput } = useAppDataUpdates(setData, setDataRevision);

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
          articleLocationFlushersRef.current.forEach((flush) => flush());
          void flushWorkspace().catch((error) =>
            console.error('[workspace-layout] Failed to flush before switch', error),
          );
          refreshRevision.current += 1;
          setData((current) => {
            preTransitionDataRef.current = current;
            return null;
          });
          return;
        }
        if (transition.phase === 'PROGRESS') return;
        setError('');
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
    [applyLoadingPreviewTransition, flushWorkspace, loadData],
  );

  useEffect(() => {
    if (view !== 'creator') setCreationPromptFullWindow(false);
  }, [view]);

  const commitTabLocation = useCallback(
    (
      tabId: string,
      destination: AppLocation | ((current: AppLocation) => AppLocation),
      mode: NavigationMode = 'push',
    ) => {
      const state = workspaceState;
      if (!state) return;
      const found = findWorkspaceTab(state, tabId);
      if (!found) return;
      const next = typeof destination === 'function' ? destination(workspaceTabLocation(found.tab)) : destination;
      const nextKey = workspaceLocationKey(next);
      const candidateGroups = workspaceLocationCanSplit(next) ? [found.group] : state.groups;
      const duplicate = candidateGroups.some((group) =>
        group.tabs.some((tab) => tab.id !== tabId && workspaceLocationKey(workspaceTabLocation(tab)) === nextKey),
      );
      const apply = () => {
        articleLocationFlushersRef.current.get(tabId)?.();
        navigateWorkspace(tabId, next, mode);
      };
      if (duplicate && historyNavigationGuardsRef.current.get(tabId)?.('forward', apply)) return;
      apply();
    },
    [navigateWorkspace, workspaceState],
  );
  const commitLocation = useCallback(
    (destination: AppLocation | ((current: AppLocation) => AppLocation), mode: NavigationMode = 'push') => {
      if (activeTabId) commitTabLocation(activeTabId, destination, mode);
    },
    [activeTabId, commitTabLocation],
  );

  const goBackInTab = useCallback(
    (tabId: string) => {
      const found = workspaceState ? findWorkspaceTab(workspaceState, tabId) : null;
      if (!found || found.tab.history.index <= 0) return;
      const continueNavigation = () => {
        articleLocationFlushersRef.current.get(tabId)?.();
        setComparisonFullWindow(false);
        goBackWorkspace(tabId);
      };
      if (historyNavigationGuardsRef.current.get(tabId)?.('back', continueNavigation)) return;
      continueNavigation();
    },
    [goBackWorkspace, workspaceState],
  );

  const goForwardInTab = useCallback(
    (tabId: string) => {
      const found = workspaceState ? findWorkspaceTab(workspaceState, tabId) : null;
      if (!found || found.tab.history.index >= found.tab.history.entries.length - 1) return;
      const continueNavigation = () => {
        articleLocationFlushersRef.current.get(tabId)?.();
        setComparisonFullWindow(false);
        goForwardWorkspace(tabId);
      };
      if (historyNavigationGuardsRef.current.get(tabId)?.('forward', continueNavigation)) return;
      continueNavigation();
    },
    [goForwardWorkspace, workspaceState],
  );

  const goBack = useCallback(() => {
    if (activeTabId) goBackInTab(activeTabId);
  }, [activeTabId, goBackInTab]);

  const goForward = useCallback(() => {
    if (activeTabId) goForwardInTab(activeTabId);
  }, [activeTabId, goForwardInTab]);

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

  const setHistoryNavigationGuard = useCallback((tabId: string, guard: HistoryNavigationGuard | null) => {
    if (guard) historyNavigationGuardsRef.current.set(tabId, guard);
    else historyNavigationGuardsRef.current.delete(tabId);
  }, []);

  const startCreationInTab = useCallback(
    (tabId: string, albumId: string | null) => {
      setComparisonFullWindow(false);
      const requestId = ++creatorStartRevision.current;
      commitTabLocation(tabId, (current) => ({
        ...current,
        view: 'creator',
        creator: { surface: 'new-creation', albumId, requestId },
        materialsReturnContext: null,
      }));
    },
    [commitTabLocation],
  );

  const startCreation = useCallback(
    (albumId: string | null) => {
      if (!activeTabId) return;
      const guard = historyNavigationGuardsRef.current.get(activeTabId);
      const start = () => startCreationInTab(activeTabId, albumId);
      if (guard?.('forward', start)) return;
      start();
    },
    [activeTabId, startCreationInTab],
  );

  const useAssetInCreation = useCallback(
    async (assetId: string) => {
      const targetTabId = activeTabId;
      if (!targetTabId) return;
      const albumId =
        view === 'gallery'
          ? workspaceAlbums.galleryAlbumId
          : view === 'creator'
            ? workspaceAlbums.creatorAlbumId
            : null;
      const draft = await window.desktopApi.creationDraftStart({
        albumId,
        termPromptLocale: defaultPromptLocale ?? locale,
      });
      const referenceAssetIds = [...new Set([...draft.referenceAssets.map((asset) => asset.id), assetId])];
      if (referenceAssetIds.length > 8) throw new Error(messages.assetFile.referenceLimit);
      const savedDraft = await window.desktopApi.creationDraftSave({
        id: draft.id,
        expectedUpdatedAt: draft.updatedAt,
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
      commitTabLocation(targetTabId, (current) => ({
        ...current,
        view: 'creator',
        creator: { surface: 'creation-draft', draftId: savedDraft.id, requestId },
        materialsReturnContext: null,
      }));
    },
    [
      activeTabId,
      commitTabLocation,
      defaultPromptLocale,
      locale,
      messages.assetFile.referenceLimit,
      refresh,
      view,
      workspaceAlbums.creatorAlbumId,
      workspaceAlbums.galleryAlbumId,
    ],
  );

  const createDocumentFromVideo = useCallback(
    async (materialId: string, albumId: string | null) => {
      const targetTabId = activeTabId;
      if (!targetTabId) return;
      try {
        const document = await window.desktopApi.videoDocumentCreate({
          videoMaterialId: materialId,
          title: '',
          titleLocale: locale,
          albumId,
        });
        void refreshAlbums().catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
        commitTabLocation(targetTabId, (current) => ({
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
    [activeTabId, commitTabLocation, locale, notify, refreshAlbums],
  );

  const assetMenuActions = useAppAssetMenuActions({
    albums: data?.albums ?? [],
    breakdownAlbumId:
      view === 'gallery' ? workspaceAlbums.galleryAlbumId : view === 'creator' ? workspaceAlbums.creatorAlbumId : null,
    locale,
    notify,
    useInCreation: useAssetInCreation,
    createDocumentFromVideo,
    refreshLibrary: refresh,
    navigate: commitLocation,
  });

  const startNewCreationFromContext = useCallback(() => {
    const albumId =
      view === 'creator' ? workspaceAlbums.creatorAlbumId : view === 'gallery' ? workspaceAlbums.galleryAlbumId : null;
    startCreation(albumId);
  }, [startCreation, view, workspaceAlbums.creatorAlbumId, workspaceAlbums.galleryAlbumId]);

  useAppWorkspaceShortcuts({
    state: workspaceState,
    activateGroupByIndex: workspace.activateGroupByIndex,
    activateTabByIndex: workspace.activateTabByIndex,
    navigateHistory: invokeHistoryNavigation,
    startNew: startNewCreationFromContext,
  });

  function requestTabExit(tabId: string, action: () => void) {
    const guard = historyNavigationGuardsRef.current.get(tabId);
    if (guard?.('forward', action)) return;
    action();
  }

  function requestTabExits(tabIds: readonly string[], action: () => void, index = 0) {
    const tabId = tabIds[index];
    if (!tabId) return action();
    requestTabExit(tabId, () => requestTabExits(tabIds, action, index + 1));
  }

  function changeViewInTab(tabId: string, nextView: AppView) {
    const found = workspace.state ? findWorkspaceTab(workspace.state, tabId) : null;
    if (!found || workspaceTabLocation(found.tab).view === nextView) return;
    requestTabExit(tabId, () => {
      setComparisonFullWindow(false);
      commitTabLocation(tabId, (current) => ({ ...current, view: nextView, materialsReturnContext: null }));
    });
  }

  function changeView(nextView: AppView) {
    if (activeTabId) changeViewInTab(activeTabId, nextView);
  }

  function navigateAiCenter(aiCenter: AiCenterLocation, mode: NavigationMode = 'push') {
    if (!activeTabId) return;
    requestTabExit(activeTabId, () =>
      commitTabLocation(
        activeTabId,
        (current) => ({ ...current, view: 'aiCenter', aiCenter, materialsReturnContext: null }),
        mode,
      ),
    );
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

  function reEditGenerationInTab(tabId: string, runId: string) {
    const next = data && generationReEditLocation(data, runId, Date.now());
    if (!next)
      return void notify(
        locale === 'zh' ? '找不到该生成任务所属的创作' : 'The creation for this generation is unavailable',
      );
    setComparisonFullWindow(false);
    commitTabLocation(tabId, (current) => ({
      ...current,
      view: 'creator',
      creator: next,
      materialsReturnContext: null,
    }));
  }

  function reEditGeneration(runId: string) {
    if (activeTabId) requestTabExit(activeTabId, () => reEditGenerationInTab(activeTabId, runId));
  }

  function activateTab(group: WorkspaceRuntimeGroup, tabId: string) {
    if (tabId === group.activeTabId) {
      workspace.activateGroup(group.id);
      return;
    }
    requestTabExit(group.activeTabId, () => {
      articleLocationFlushersRef.current.get(group.activeTabId)?.();
      setComparisonFullWindow(false);
      setCreationPromptFullWindow(false);
      workspace.activateTab(group.id, tabId);
    });
  }

  function closeTab(tabId: string) {
    requestTabExit(tabId, () => {
      articleLocationFlushersRef.current.get(tabId)?.();
      workspace.closeTab(tabId);
    });
  }

  function closeOtherTabs(group: WorkspaceRuntimeGroup, tabId: string) {
    const closingTabIds = group.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id);
    requestTabExits(closingTabIds, () => {
      closingTabIds.forEach((closingTabId) => articleLocationFlushersRef.current.get(closingTabId)?.());
      workspace.closeOtherTabs(group.id, tabId);
    });
  }

  function resetLayout() {
    if (!workspace.state) return;
    const tabIds = workspace.state.groups.flatMap((group) => group.tabs.map((tab) => tab.id));
    requestTabExits(tabIds, () => {
      tabIds.forEach((tabId) => articleLocationFlushersRef.current.get(tabId)?.());
      workspace.reset();
    });
  }

  function mergeWorkspaceGroupsFrom(sourceGroup: WorkspaceRuntimeGroup) {
    const otherGroup = workspace.state?.groups.find((group) => group.id !== sourceGroup.id);
    const remountingTabIds = otherGroup?.tabs.map((tab) => tab.id) ?? [];
    requestTabExits(remountingTabIds, () => {
      remountingTabIds.forEach((tabId) => articleLocationFlushersRef.current.get(tabId)?.());
      workspace.mergeGroups(sourceGroup.id);
    });
  }

  function moveTabToOtherGroup(tabId: string) {
    requestTabExit(tabId, () => {
      articleLocationFlushersRef.current.get(tabId)?.();
      workspace.moveTabToOtherGroup(tabId);
    });
  }

  function changeGroupFullWindow(groupId: string, surface: 'comparison' | 'creation', open: boolean) {
    if (!open) {
      if (workspace.state?.activeGroupId !== groupId) return;
      if (surface === 'comparison') setComparisonFullWindow(false);
      else setCreationPromptFullWindow(false);
      return;
    }
    const apply = () => {
      workspace.activateGroup(groupId);
      if (surface === 'comparison') setComparisonFullWindow(true);
      else setCreationPromptFullWindow(true);
    };
    const otherGroup = workspace.state?.groups.find((group) => group.id !== groupId);
    requestTabExits(otherGroup ? [otherGroup.activeTabId] : [], apply);
  }

  function renderWorkspaceGroup(group: WorkspaceRuntimeGroup) {
    if (!data) return null;
    return (
      <AppWorkspaceGroup
        key={group.id}
        group={group}
        active={group.id === workspace.state?.activeGroupId}
        tabsVisible={!appFullWindow}
        data={data}
        dataRevision={dataRevision}
        locale={locale}
        defaultPromptLocale={defaultPromptLocale}
        comparisonFullWindow={comparisonFullWindow}
        creationPromptFullWindow={creationPromptFullWindow}
        loadingPreviews={loadingPreviews}
        codexImagesNavigation={codexImagesNavigation}
        transitionShowcaseNavigation={transitionShowcaseNavigation}
        documentNavigationRevision={documentNavigationRevision}
        articleEditorStates={workspace.state?.articleEditors ?? []}
        articleEditOwners={workspace.state?.articleEditOwners ?? []}
        onArticleEditorStateChange={workspace.updateArticleEditorState}
        onArticleLocationChange={workspace.updateArticleViewLocation}
        onArticleLocationNavigate={workspace.navigateArticleViewLocation}
        onRequestEditOwnership={workspace.claimArticleEditOwnership}
        onLocationFlushChange={setArticleLocationFlusher}
        onActivateGroup={() => workspace.activateGroup(group.id)}
        onActivateTab={(tabId) => activateTab(group, tabId)}
        onCloseTab={closeTab}
        onCloseOtherTabs={(tabId) => closeOtherTabs(group, tabId)}
        onReorderTab={(tabId, delta) => workspace.reorderTab(group.id, tabId, delta)}
        onNewTab={(sourceTabId, destination) => {
          articleLocationFlushersRef.current.get(sourceTabId)?.();
          workspace.openTab(newWorkspaceTabLocation(destination), group.id);
        }}
        onOpenBeside={(sourceTabId, nextView) => {
          articleLocationFlushersRef.current.get(sourceTabId)?.();
          workspace.openBeside(sourceTabId, { ...initialAppLocation, view: nextView });
        }}
        splitAxis={workspace.state?.arrangement.kind === 'split' ? workspace.state.arrangement.axis : null}
        onMergeGroups={() => mergeWorkspaceGroupsFrom(group)}
        onMoveTabToOtherGroup={moveTabToOtherGroup}
        onSplit={(sourceTabId, axis) => {
          articleLocationFlushersRef.current.get(sourceTabId)?.();
          workspace.split(sourceTabId, axis);
        }}
        onReset={resetLayout}
        onCommitLocation={commitTabLocation}
        onGoBack={goBackInTab}
        onHistoryNavigationGuardChange={setHistoryNavigationGuard}
        onComparisonFullWindowChange={(open) => changeGroupFullWindow(group.id, 'comparison', open)}
        onCreationPromptFullWindowChange={(open) => changeGroupFullWindow(group.id, 'creation', open)}
        onCreatorActiveAlbumChange={(tabId, albumId) => workspaceAlbums.setCreatorAlbum(tabId, albumId)}
        onGalleryActiveAlbumChange={(tabId, albumId) => workspaceAlbums.setGalleryAlbum(tabId, albumId)}
        refresh={refresh}
        refreshAlbums={refreshAlbums}
        onTermDetailsRequest={requestTermDetails}
        onImportedOutputSaved={updateImportedOutput}
        onArticleSaved={updateArticle}
        onApplyIntakeResult={applyIntakeResult}
        onVideoDocumentsChange={refreshDocumentNavigation}
        onRetryGeneration={retryGeneration}
        notify={notify}
      />
    );
  }

  return (
    <ArticleEditorSessionRegistryProvider>
      <AppRuntimeProviders assetMenuActions={assetMenuActions} spaceId={data?.spaceId ?? null} refresh={refresh}>
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
              menuDisabled={Boolean(spaceTransition) || !data}
              codexImagesVisible={codexImagesNavigation.visible}
              transitionShowcaseVisible={transitionShowcaseNavigation.visible}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              notify={notify}
              onNewCreation={startNewCreationFromContext}
              onViewChange={changeView}
              onSettingsOpen={() => setSettingsOpen(true)}
              onQuit={() => {
                articleLocationFlushersRef.current.forEach((flush) => flush());
                void workspace.flush().finally(() => window.desktopApi.appRequestQuit());
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
                spaceTransitioning={Boolean(spaceTransition) || !data}
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
              {workspaceReady &&
                workspace.activeGroup &&
                workspaceState &&
                (appFullWindow || workspaceState.arrangement.kind === 'single' ? (
                  renderWorkspaceGroup(workspace.activeGroup)
                ) : (
                  <WorkspaceSplitLayout
                    arrangement={workspaceState.arrangement}
                    childrenByGroupId={
                      new Map(workspaceState.groups.map((group) => [group.id, renderWorkspaceGroup(group)]))
                    }
                    onRatioCommit={workspace.setSplitRatio}
                  />
                ))}
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
            copyLabel={messages.app.generationErrors.copyDetails}
            copiedLabel={messages.app.generationErrors.copied}
            copyFailedLabel={messages.app.generationErrors.copyFailed}
            onDismiss={dismissNotification}
          />
        </main>
      </AppRuntimeProviders>
    </ArticleEditorSessionRegistryProvider>
  );
}
