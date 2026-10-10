import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArticleEditorLocationDto, BootstrapDto, WorkspaceArticleEditorStateDto } from '@/shared/contracts';
import type { AppLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import { useWorkspaceTabOpening } from '@/renderer/components/workspace/useWorkspaceTabOpening';
import { useWorkspaceDiagnostics } from '@/renderer/components/workspace/useWorkspaceDiagnostics';
import {
  activateWorkspaceGroup,
  activateWorkspaceGroupByIndex,
  activateWorkspaceTab,
  activateWorkspaceTabByIndex,
  activeNavigationEntry,
  activeLocation,
  activeWorkspaceGroup,
  activeWorkspaceTab,
  closeWorkspaceTab,
  closeWorkspaceTabs,
  findWorkspaceTab,
  navigateWorkspaceHistory,
  navigateWorkspaceArticleLocation,
  navigateWorkspaceReference,
  navigateWorkspaceTab,
  mergeWorkspaceGroups,
  moveWorkspaceTabToOtherGroup,
  persistedWorkspaceState,
  reorderWorkspaceTab,
  rememberActiveVisualWorkspace,
  resetWorkspace,
  restoreWorkspaceState,
  setWorkspaceGroupTabsCollapsed,
  setWorkspaceTabPinned,
  setWorkspaceSplitRatio,
  splitWorkspace,
  updateWorkspaceArticleLocation,
  type WorkspaceRuntimeState,
  type WorkspaceTabCloseScope,
  type WorkspaceTabMove,
} from '@/renderer/components/workspace/workspace-state';

interface PersistenceContext {
  epoch: number;
  spaceId: string;
  revision: number;
  acknowledgedKey: string;
  saving: Promise<void> | null;
}

export function useWorkspaceController(data: BootstrapDto | null) {
  const [state, setState] = useState<WorkspaceRuntimeState | null>(null);
  const stateRef = useRef<WorkspaceRuntimeState | null>(null);
  useWorkspaceDiagnostics(state);
  const persistenceRef = useRef<PersistenceContext | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const saveLatest = useCallback(async () => {
    const context = persistenceRef.current;
    if (!context) return;
    if (context.saving) return context.saving;
    const epoch = context.epoch;
    const task = (async () => {
      for (;;) {
        const currentContext = persistenceRef.current;
        const currentState = stateRef.current;
        if (!currentContext || !currentState || currentContext.epoch !== epoch) return;
        const persisted = persistedWorkspaceState(currentState);
        const key = JSON.stringify(persisted);
        if (key === currentContext.acknowledgedKey) return;
        const result = await window.desktopApi.workspaceLayoutSave({
          spaceId: currentContext.spaceId,
          expectedRevision: currentContext.revision,
          state: persisted,
        });
        const latestContext = persistenceRef.current;
        if (!latestContext || latestContext.epoch !== epoch) return;
        if (result.status === 'saved') {
          latestContext.revision = result.snapshot.revision;
          // Acknowledge the submitted snapshot. Schema parsing can reorder the
          // reply's object keys without changing its content, causing endless writes.
          latestContext.acknowledgedKey = key;
          setState((current) =>
            current?.spaceId === result.snapshot.spaceId ? { ...current, revision: result.snapshot.revision } : current,
          );
        } else {
          latestContext.revision = result.snapshot?.revision ?? 0;
          latestContext.acknowledgedKey = result.snapshot ? JSON.stringify(result.snapshot.state) : '';
        }
      }
    })();
    context.saving = task.finally(() => {
      const latest = persistenceRef.current;
      if (latest?.epoch === epoch) latest.saving = null;
    });
    return context.saving;
  }, []);

  const flush = useCallback(() => {
    if (saveTimerRef.current !== null) {
      globalThis.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return saveLatest();
  }, [saveLatest]);

  useEffect(() => {
    if (!data || stateRef.current?.spaceId === data.spaceId) return;
    const previous = persistenceRef.current;
    const restored = rememberActiveVisualWorkspace(restoreWorkspaceState(data));
    stateRef.current = restored;
    persistenceRef.current = {
      epoch: (previous?.epoch ?? 0) + 1,
      spaceId: data.spaceId,
      revision: restored.revision,
      acknowledgedKey: data.workspaceLayout ? JSON.stringify(data.workspaceLayout.state) : '',
      saving: null,
    };
    setState(restored);
  }, [data]);

  useEffect(() => {
    stateRef.current = state;
    const context = persistenceRef.current;
    if (!state || !context || context.spaceId !== state.spaceId) return;
    if (saveTimerRef.current !== null) globalThis.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = globalThis.setTimeout(() => {
      saveTimerRef.current = null;
      void saveLatest().catch((error) => console.error('[workspace-layout] Failed to persist layout', error));
    }, 180);
    return () => {
      if (saveTimerRef.current === null) return;
      globalThis.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [saveLatest, state]);

  const update = useCallback((operation: (current: WorkspaceRuntimeState) => WorkspaceRuntimeState) => {
    const current = stateRef.current;
    if (!current) return;
    const next = rememberActiveVisualWorkspace(operation(current));
    if (next === current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const navigate = useCallback(
    (
      tabId: string,
      destination: AppLocation | ((current: AppLocation) => AppLocation),
      mode: NavigationMode = 'push',
    ) => {
      update((current) => navigateWorkspaceTab(current, tabId, destination, mode));
    },
    [update],
  );
  const goBack = useCallback(
    (tabId: string) => update((current) => navigateWorkspaceHistory(current, tabId, -1)),
    [update],
  );
  const goForward = useCallback(
    (tabId: string) => update((current) => navigateWorkspaceHistory(current, tabId, 1)),
    [update],
  );
  const tabOpening = useWorkspaceTabOpening(stateRef, persistenceRef, update);
  const activateGroup = useCallback(
    (groupId: string) => update((current) => activateWorkspaceGroup(current, groupId)),
    [update],
  );
  const activateTab = useCallback(
    (groupId: string, tabId: string) => update((current) => activateWorkspaceTab(current, groupId, tabId)),
    [update],
  );
  const activateGroupByIndex = useCallback(
    (index: number) => update((current) => activateWorkspaceGroupByIndex(current, index)),
    [update],
  );
  const activateTabByIndex = useCallback(
    (index: number) => update((current) => activateWorkspaceTabByIndex(current, index)),
    [update],
  );
  const closeTab = useCallback((tabId: string) => update((current) => closeWorkspaceTab(current, tabId)), [update]);
  const reorderTab = useCallback(
    (groupId: string, tabId: string, move: WorkspaceTabMove) =>
      update((current) => reorderWorkspaceTab(current, groupId, tabId, move)),
    [update],
  );
  const setTabPinned = useCallback(
    (tabId: string, pinned: boolean) => update((current) => setWorkspaceTabPinned(current, tabId, pinned)),
    [update],
  );
  const closeTabs = useCallback(
    (groupId: string, tabId: string, scope: WorkspaceTabCloseScope) =>
      update((current) => closeWorkspaceTabs(current, groupId, tabId, scope)),
    [update],
  );
  const reset = useCallback(() => update(resetWorkspace), [update]);
  const split = useCallback(
    (sourceTabId: string, axis: 'columns' | 'rows') => update((current) => splitWorkspace(current, sourceTabId, axis)),
    [update],
  );
  const mergeGroups = useCallback(
    (sourceGroupId: string) => update((current) => mergeWorkspaceGroups(current, sourceGroupId)),
    [update],
  );
  const setGroupTabsCollapsed = useCallback(
    (groupId: string, collapsed: boolean) =>
      update((current) => setWorkspaceGroupTabsCollapsed(current, groupId, collapsed)),
    [update],
  );
  const setSplitRatio = useCallback(
    (ratio: number) => update((current) => setWorkspaceSplitRatio(current, ratio)),
    [update],
  );
  const moveTabToOtherGroup = useCallback(
    (tabId: string) => update((current) => moveWorkspaceTabToOtherGroup(current, tabId)),
    [update],
  );
  const updateArticleEditorState = useCallback(
    (
      articleId: string,
      operation: (current: WorkspaceArticleEditorStateDto | null) => WorkspaceArticleEditorStateDto | null,
    ) =>
      update((current) => {
        const existing = current.articleEditors.find((candidate) => candidate.articleId === articleId) ?? null;
        const next = operation(existing);
        if (next === existing) return current;
        const retained = current.articleEditors.filter((candidate) => candidate.articleId !== articleId);
        return {
          ...current,
          articleEditors: next ? [...retained.slice(-23), next] : retained,
        };
      }),
    [update],
  );
  const updateArticleViewLocation = useCallback(
    (tabId: string, articleId: string, location: ArticleEditorLocationDto) =>
      update((current) => {
        const positioned = updateWorkspaceArticleLocation(current, tabId, articleId, location);
        const existing = positioned.articleEditors.find((candidate) => candidate.articleId === articleId) ?? null;
        if (
          existing?.resumeLocation?.elementId === location.elementId &&
          existing.resumeLocation.relativeOffset === location.relativeOffset &&
          existing.resumeLocation.outlineFocusId === location.outlineFocusId &&
          existing.resumeLocation.viewportOffset === location.viewportOffset
        ) {
          return positioned;
        }
        const next = existing
          ? { ...existing, resumeLocation: location }
          : { articleId, resumeLocation: location, editTrail: [] };
        const retained = positioned.articleEditors.filter((candidate) => candidate.articleId !== articleId);
        return { ...positioned, articleEditors: [...retained.slice(-23), next] };
      }),
    [update],
  );
  const navigateArticleViewLocation = useCallback(
    (tabId: string, articleId: string, location: ArticleEditorLocationDto) =>
      update((current) => navigateWorkspaceArticleLocation(current, tabId, articleId, location)),
    [update],
  );
  const navigateReference = useCallback(
    (
      sourceTabId: string,
      articleId: string,
      blockId: string | null,
      options: Parameters<typeof navigateWorkspaceReference>[4],
    ) => update((current) => navigateWorkspaceReference(current, sourceTabId, articleId, blockId, options)),
    [update],
  );

  return {
    state,
    activeGroup: state ? activeWorkspaceGroup(state) : null,
    activeTab: state ? activeWorkspaceTab(state) : null,
    activeLocation: state ? activeLocation(activeWorkspaceTab(state)) : null,
    activeEntry: state ? activeNavigationEntry(activeWorkspaceTab(state)) : null,
    flush,
    navigate,
    goBack,
    goForward,
    ...tabOpening,
    activateGroup,
    activateTab,
    activateGroupByIndex,
    activateTabByIndex,
    closeTab,
    closeTabs,
    setTabPinned,
    reorderTab,
    reset,
    split,
    mergeGroups,
    setGroupTabsCollapsed,
    setSplitRatio,
    moveTabToOtherGroup,
    updateArticleEditorState,
    updateArticleViewLocation,
    navigateArticleViewLocation,
    navigateReference,
    findTab(tabId: string) {
      return state ? findWorkspaceTab(state, tabId) : null;
    },
  };
}
