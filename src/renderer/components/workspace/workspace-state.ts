import type {
  ArticleEditorLocationDto,
  BootstrapDto,
  WorkspaceArrangementDto,
  WorkspaceArticleEditOwnerDto,
  WorkspaceArticleEditorStateDto,
  WorkspaceLayoutStateDto,
} from '@/shared/contracts';
import {
  initialAppLocation,
  sameAppLocation,
  type AppLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import type { AppView } from '@/renderer/components/app/app-navigation';
import type { WorkspaceVisualResumeDto } from '@/shared/contracts/workspace-layout';
import { rememberVisualWorkspace } from '@/renderer/components/workspace/workspace-visual-resume';
import {
  appLocationToWorkspaceTarget,
  normalizeWorkspaceTarget,
  workspaceLocationCanSplit,
} from '@/renderer/components/workspace/workspace-location';

const MAX_HISTORY_ENTRIES = 100;
const MAX_TABS_PER_GROUP = 24;

export type WorkspaceReferencePlacement = 'current' | 'tab' | 'beside';

export interface WorkspaceNavigationEntry {
  id: string;
  location: AppLocation;
  articleLocation: ArticleEditorLocationDto | null;
}

interface WorkspaceHistory {
  entries: WorkspaceNavigationEntry[];
  index: number;
}

export interface WorkspaceRuntimeTab {
  id: string;
  history: WorkspaceHistory;
  visitedViews: AppView[];
}

export interface WorkspaceRuntimeGroup {
  id: string;
  activeTabId: string;
  tabsCollapsed?: boolean;
  tabs: WorkspaceRuntimeTab[];
}

export interface WorkspaceRuntimeState {
  spaceId: string;
  revision: number;
  activeGroupId: string;
  arrangement: WorkspaceArrangementDto;
  groups: WorkspaceRuntimeGroup[];
  articleEditors: WorkspaceArticleEditorStateDto[];
  articleEditOwners: WorkspaceArticleEditOwnerDto[];
  visualWorkspaces: WorkspaceVisualResumeDto[];
}

function identity(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function navigationEntry(
  location: AppLocation,
  articleLocation: ArticleEditorLocationDto | null = null,
  id = identity('location'),
): WorkspaceNavigationEntry {
  return { id, location, articleLocation };
}

function runtimeTab(
  location: AppLocation = initialAppLocation,
  id = identity('tab'),
  articleLocation: ArticleEditorLocationDto | null = null,
): WorkspaceRuntimeTab {
  return {
    id,
    history: { entries: [navigationEntry(location, articleLocation)], index: 0 },
    visitedViews: [location.view],
  };
}

export function activeLocation(tab: WorkspaceRuntimeTab) {
  return activeNavigationEntry(tab).location;
}

export function rememberActiveVisualWorkspace(state: WorkspaceRuntimeState) {
  const visualWorkspaces = rememberVisualWorkspace(state.visualWorkspaces, activeLocation(activeWorkspaceTab(state)));
  return visualWorkspaces === state.visualWorkspaces ? state : { ...state, visualWorkspaces };
}

export function activeNavigationEntry(tab: WorkspaceRuntimeTab) {
  return tab.history.entries[tab.history.index];
}

export function findWorkspaceTab(state: WorkspaceRuntimeState, tabId: string) {
  for (const group of state.groups) {
    const tab = group.tabs.find((candidate) => candidate.id === tabId);
    if (tab) return { group, tab };
  }
  return null;
}

export function activeWorkspaceGroup(state: WorkspaceRuntimeState) {
  return state.groups.find((group) => group.id === state.activeGroupId) ?? state.groups[0];
}

export function activeWorkspaceTab(state: WorkspaceRuntimeState) {
  const group = activeWorkspaceGroup(state);
  return group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
}

export function collapseWorkspaceGroups(state: WorkspaceRuntimeState): WorkspaceRuntimeState {
  const activeGroup = activeWorkspaceGroup(state);
  const alreadySingle =
    state.groups.length === 1 &&
    state.activeGroupId === activeGroup.id &&
    state.arrangement.kind === 'single' &&
    state.arrangement.groupId === activeGroup.id;
  if (alreadySingle) return state;

  const tabs = [
    ...activeGroup.tabs,
    ...state.groups.filter((group) => group.id !== activeGroup.id).flatMap((group) => group.tabs),
  ];
  if (tabs.length > MAX_TABS_PER_GROUP) return state;
  return {
    ...state,
    activeGroupId: activeGroup.id,
    arrangement: { kind: 'single', groupId: activeGroup.id },
    groups: [{ ...activeGroup, tabsCollapsed: false, tabs }],
  };
}

export function createDefaultWorkspaceState(spaceId: string, revision = 0): WorkspaceRuntimeState {
  const groupId = identity('group');
  const tab = runtimeTab();
  return {
    spaceId,
    revision,
    activeGroupId: groupId,
    arrangement: { kind: 'single', groupId },
    groups: [{ id: groupId, activeTabId: tab.id, tabs: [tab] }],
    articleEditors: [],
    articleEditOwners: [],
    visualWorkspaces: [],
  };
}

export function restoreWorkspaceState(data: BootstrapDto): WorkspaceRuntimeState {
  const snapshot = data.workspaceLayout;
  if (!snapshot || snapshot.spaceId !== data.spaceId) return createDefaultWorkspaceState(data.spaceId);

  const groups: WorkspaceRuntimeGroup[] = [];
  for (const group of snapshot.state.groups) {
    const tabs: WorkspaceRuntimeTab[] = [];
    let activeTabId: string | null = null;
    for (const tab of group.tabs) {
      const entries = (
        tab.history?.length
          ? tab.history.map((entry) =>
              navigationEntry(normalizeWorkspaceTarget(entry.target, data), entry.articleLocation, entry.id),
            )
          : [navigationEntry(normalizeWorkspaceTarget(tab.target, data))]
      ).slice(-MAX_HISTORY_ENTRIES);
      const index = Math.min(tab.historyIndex ?? entries.length - 1, entries.length - 1);
      const restoredTab = {
        id: tab.id,
        history: { entries, index },
        // Back/forward history survives a restart, but mounted views are scoped
        // to the current renderer session. Recreating every historical surface
        // here makes React pre-render pages the user cannot currently see.
        visitedViews: [entries[index]!.location.view],
      };
      // Tab identity owns its history even when another tab displays the same content.
      tabs.push(restoredTab);
      if (tab.id === group.activeTabId) activeTabId = tab.id;
    }
    if (!tabs.length) continue;
    groups.push({
      id: group.id,
      activeTabId: activeTabId ?? tabs[0].id,
      tabsCollapsed: group.tabsCollapsed ?? false,
      tabs,
    });
  }
  if (!groups.length) return createDefaultWorkspaceState(data.spaceId, snapshot.revision);

  const requestedActiveGroupId = snapshot.state.activeGroupId;
  const activeGroupId = groups.some((group) => group.id === requestedActiveGroupId)
    ? requestedActiveGroupId
    : groups[0].id;
  const arrangedGroupIds =
    snapshot.state.arrangement.kind === 'split'
      ? snapshot.state.arrangement.groupIds
      : [snapshot.state.arrangement.groupId];
  const arrangement: WorkspaceArrangementDto =
    groups.length === 2 && arrangedGroupIds.every((groupId) => groups.some((group) => group.id === groupId))
      ? {
          kind: 'split',
          axis: snapshot.state.arrangement.kind === 'split' ? snapshot.state.arrangement.axis : 'columns',
          ratio: snapshot.state.arrangement.kind === 'split' ? snapshot.state.arrangement.ratio : 5_000,
          groupIds: [arrangedGroupIds[0], arrangedGroupIds[1]],
        }
      : { kind: 'single', groupId: groups[0].id };
  return normalizeWorkspaceArticleEditOwners({
    spaceId: data.spaceId,
    revision: snapshot.revision,
    activeGroupId,
    arrangement,
    groups: groups.map((group) =>
      arrangement.kind === 'single' || group.id === activeGroupId ? { ...group, tabsCollapsed: false } : group,
    ),
    articleEditors: snapshot.state.articleEditors,
    articleEditOwners: snapshot.state.articleEditOwners,
    visualWorkspaces: (snapshot.state.visualWorkspaces ?? []).filter((entry) =>
      data.derivedVisuals?.some((visual) => visual.id === entry.visualId && visual.promptSeriesId === entry.seriesId),
    ),
  });
}

export function persistedWorkspaceState(state: WorkspaceRuntimeState): WorkspaceLayoutStateDto {
  return {
    activeGroupId: state.activeGroupId,
    arrangement: state.arrangement,
    groups: state.groups.map((group) => ({
      id: group.id,
      activeTabId: group.activeTabId,
      ...(group.tabsCollapsed ? { tabsCollapsed: true } : {}),
      tabs: group.tabs.map((tab) => ({
        id: tab.id,
        target: appLocationToWorkspaceTarget(activeLocation(tab)),
        history: tab.history.entries.map((entry) => ({
          id: entry.id,
          target: appLocationToWorkspaceTarget(entry.location),
          articleLocation: entry.articleLocation,
        })),
        historyIndex: tab.history.index,
      })),
    })),
    articleEditors: state.articleEditors,
    articleEditOwners: state.articleEditOwners,
    visualWorkspaces: state.visualWorkspaces,
  };
}

function withTab(
  state: WorkspaceRuntimeState,
  tabId: string,
  update: (tab: WorkspaceRuntimeTab) => WorkspaceRuntimeTab,
) {
  return {
    ...state,
    groups: state.groups.map((group) => ({
      ...group,
      tabs: group.tabs.map((tab) => (tab.id === tabId ? update(tab) : tab)),
    })),
  };
}

export function navigateWorkspaceTab(
  state: WorkspaceRuntimeState,
  tabId: string,
  destination: AppLocation | ((current: AppLocation) => AppLocation),
  mode: NavigationMode,
) {
  const found = findWorkspaceTab(state, tabId);
  if (!found) return state;
  const currentLocation = activeLocation(found.tab);
  const nextLocation = typeof destination === 'function' ? destination(currentLocation) : destination;
  return withTab(state, tabId, (tab) => {
    const current = activeLocation(tab);
    const next = nextLocation;
    if (sameAppLocation(current, next)) return tab;
    const visitedViews = tab.visitedViews.includes(next.view) ? tab.visitedViews : [...tab.visitedViews, next.view];
    if (mode === 'replace') {
      const entries = [...tab.history.entries];
      entries[tab.history.index] = { ...entries[tab.history.index], location: next, articleLocation: null };
      return { ...tab, history: { ...tab.history, entries }, visitedViews };
    }
    const entries = [...tab.history.entries.slice(0, tab.history.index + 1), navigationEntry(next)].slice(
      -MAX_HISTORY_ENTRIES,
    );
    return { ...tab, history: { entries, index: entries.length - 1 }, visitedViews };
  });
}

function articleIdAtLocation(location: AppLocation) {
  return location.view === 'creator' && location.creator.surface === 'article' ? location.creator.articleId : null;
}

export function normalizeWorkspaceArticleEditOwners(state: WorkspaceRuntimeState) {
  const tabsByArticle = new Map<string, string[]>();
  for (const group of state.groups) {
    for (const tab of group.tabs) {
      const articleId = articleIdAtLocation(activeLocation(tab));
      if (articleId) tabsByArticle.set(articleId, [...(tabsByArticle.get(articleId) ?? []), tab.id]);
    }
  }
  const owners = new Map(state.articleEditOwners.map((owner) => [owner.articleId, owner.tabId]));
  const activeTab = activeWorkspaceTab(state);
  const activeArticleId = articleIdAtLocation(activeLocation(activeTab));
  const articleEditOwners = [...tabsByArticle].map(([articleId, tabIds]) => ({
    articleId,
    tabId: tabIds.includes(owners.get(articleId) ?? '')
      ? owners.get(articleId)!
      : articleId === activeArticleId && tabIds.includes(activeTab.id)
        ? activeTab.id
        : tabIds[0],
  }));
  if (
    articleEditOwners.length === state.articleEditOwners.length &&
    articleEditOwners.every(
      (owner, index) =>
        owner.articleId === state.articleEditOwners[index]?.articleId &&
        owner.tabId === state.articleEditOwners[index]?.tabId,
    )
  ) {
    return state;
  }
  return { ...state, articleEditOwners };
}

export function claimWorkspaceArticleEditOwnership(state: WorkspaceRuntimeState, articleId: string, tabId: string) {
  const found = findWorkspaceTab(state, tabId);
  if (!found || articleIdAtLocation(activeLocation(found.tab)) !== articleId) return state;
  const activated = activateWorkspaceTab(state, found.group.id, tabId);
  return {
    ...activated,
    articleEditOwners: [
      ...activated.articleEditOwners.filter((owner) => owner.articleId !== articleId),
      { articleId, tabId },
    ],
  };
}

export function updateWorkspaceArticleLocation(
  state: WorkspaceRuntimeState,
  tabId: string,
  articleId: string,
  location: ArticleEditorLocationDto,
) {
  return withTab(state, tabId, (tab) => {
    const current = activeNavigationEntry(tab);
    if (articleIdAtLocation(current.location) !== articleId) return tab;
    if (
      current.articleLocation?.elementId === location.elementId &&
      current.articleLocation.blockId === location.blockId &&
      current.articleLocation.referenceId === location.referenceId &&
      current.articleLocation.outlineFocusId === location.outlineFocusId &&
      current.articleLocation.relativeOffset === location.relativeOffset &&
      current.articleLocation.viewportOffset === location.viewportOffset
    ) {
      return tab;
    }
    const entries = [...tab.history.entries];
    entries[tab.history.index] = { ...current, articleLocation: location };
    return { ...tab, history: { ...tab.history, entries } };
  });
}

export function navigateWorkspaceArticleLocation(
  state: WorkspaceRuntimeState,
  tabId: string,
  articleId: string,
  location: ArticleEditorLocationDto,
) {
  const found = findWorkspaceTab(state, tabId);
  if (!found || articleIdAtLocation(activeLocation(found.tab)) !== articleId) return state;
  return withTab(state, tabId, (tab) => {
    const entries = [
      ...tab.history.entries.slice(0, tab.history.index + 1),
      navigationEntry(activeLocation(tab), location),
    ].slice(-MAX_HISTORY_ENTRIES);
    return { ...tab, history: { entries, index: entries.length - 1 } };
  });
}

export function navigateWorkspaceHistory(state: WorkspaceRuntimeState, tabId: string, delta: -1 | 1) {
  const found = findWorkspaceTab(state, tabId);
  if (!found) return state;
  const index = Math.min(Math.max(found.tab.history.index + delta, 0), found.tab.history.entries.length - 1);
  if (index === found.tab.history.index) return state;
  return withTab(state, tabId, (tab) => ({ ...tab, history: { ...tab.history, index } }));
}

/** Reference navigation retains the caller's journey without taking over another tab. */
export function navigateWorkspaceReference(
  state: WorkspaceRuntimeState,
  sourceTabId: string,
  articleId: string,
  blockId: string | null,
  options: {
    placement: WorkspaceReferencePlacement;
    originArticleId?: string;
    originBlockId?: string;
    referenceId?: string;
  },
) {
  const source = findWorkspaceTab(state, sourceTabId);
  if (!source) return state;
  const origin = activeNavigationEntry(source.tab);
  const originLocation =
    options.originArticleId === articleIdAtLocation(origin.location) && options.originBlockId
      ? { elementId: options.originBlockId, blockId: options.originBlockId, relativeOffset: 0 }
      : origin.articleLocation;
  const location: AppLocation = { ...initialAppLocation, view: 'creator', creator: { surface: 'article', articleId } };
  const active = activateWorkspaceTab(state, source.group.id, sourceTabId);
  const navigated =
    options.placement === 'beside'
      ? openWorkspaceTabBeside(active, sourceTabId, location)
      : options.placement === 'tab'
        ? openWorkspaceTab(active, location, source.group.id)
        : active;
  const destination = activeWorkspaceTab(navigated);
  if (options.placement !== 'current' && destination.id === sourceTabId) throw new Error('REFERENCE_WORKSPACE_FULL');
  const targetLocation = blockId
    ? { elementId: blockId, blockId, relativeOffset: 0, referenceId: options.referenceId }
    : null;
  const positioned = withTab(navigated, destination.id, (tab) => {
    const entries = [
      ...source.tab.history.entries.slice(0, source.tab.history.index),
      navigationEntry(origin.location, originLocation),
      navigationEntry(location, targetLocation),
    ].slice(-MAX_HISTORY_ENTRIES);
    return {
      ...tab,
      visitedViews: [...new Set([...tab.visitedViews, location.view])],
      history: { entries, index: entries.length - 1 },
    };
  });
  return normalizeWorkspaceArticleEditOwners(positioned);
}

export function activateWorkspaceTab(state: WorkspaceRuntimeState, groupId: string, tabId: string) {
  const currentGroup = state.groups.find((group) => group.id === groupId);
  if (!currentGroup?.tabs.some((tab) => tab.id === tabId)) return state;
  if (state.activeGroupId === groupId && currentGroup.activeTabId === tabId && !currentGroup.tabsCollapsed)
    return state;
  return {
    ...state,
    activeGroupId: groupId,
    groups: state.groups.map((group) =>
      group.id === groupId ? { ...group, activeTabId: tabId, tabsCollapsed: false } : group,
    ),
  };
}

/** Fold one split pane without changing its tabs, edit ownership or saved split ratio. */
export function setWorkspaceGroupTabsCollapsed(state: WorkspaceRuntimeState, groupId: string, collapsed: boolean) {
  const current = state.groups.find((group) => group.id === groupId);
  if (!current || Boolean(current.tabsCollapsed) === collapsed) return state;
  const other = state.groups.find((group) => group.id !== groupId);
  if (collapsed && (state.arrangement.kind !== 'split' || !other)) return state;
  return {
    ...state,
    activeGroupId: collapsed ? other!.id : groupId,
    groups: state.groups.map((group) => ({ ...group, tabsCollapsed: group.id === groupId && collapsed })),
  };
}

export function activateWorkspaceGroup(state: WorkspaceRuntimeState, groupId: string) {
  const group = state.groups.find((candidate) => candidate.id === groupId);
  return group ? activateWorkspaceTab(state, groupId, group.activeTabId) : state;
}

export function activateWorkspaceGroupByIndex(state: WorkspaceRuntimeState, index: number) {
  const orderedIds = state.arrangement.kind === 'split' ? [...state.arrangement.groupIds] : [state.arrangement.groupId];
  const groupId = orderedIds[index];
  return groupId ? activateWorkspaceGroup(state, groupId) : state;
}

export function activateWorkspaceTabByIndex(state: WorkspaceRuntimeState, index: number) {
  const group = activeWorkspaceGroup(state);
  const tab = group.tabs[index];
  return tab ? activateWorkspaceTab(state, group.id, tab.id) : state;
}

export function openWorkspaceTab(state: WorkspaceRuntimeState, location: AppLocation, requestedGroupId?: string) {
  const groupId = requestedGroupId ?? state.activeGroupId;
  const targetGroup = state.groups.find((group) => group.id === groupId);
  if (!targetGroup) return state;
  if (targetGroup.tabs.length >= MAX_TABS_PER_GROUP) return state;
  const tab = runtimeTab(location);
  return {
    ...state,
    activeGroupId: groupId,
    groups: state.groups.map((group) =>
      group.id === groupId
        ? { ...group, activeTabId: tab.id, tabsCollapsed: false, tabs: [...group.tabs, tab] }
        : group,
    ),
  };
}

export function openWorkspaceTabBeside(
  state: WorkspaceRuntimeState,
  sourceTabId: string,
  location: AppLocation,
): WorkspaceRuntimeState {
  const source = findWorkspaceTab(state, sourceTabId);
  if (!source) return state;
  const sourceGroup = source.group;
  if (state.groups.length === 2) {
    const targetGroup = state.groups.find((group) => group.id !== sourceGroup.id);
    return targetGroup ? openWorkspaceTab(state, location, targetGroup.id) : state;
  }
  const secondGroupId = identity('group');
  const secondTab = runtimeTab(location);
  return {
    ...state,
    activeGroupId: secondGroupId,
    arrangement: {
      kind: 'split',
      axis: 'columns',
      ratio: 6_000,
      groupIds: [sourceGroup.id, secondGroupId],
    },
    groups: [...state.groups, { id: secondGroupId, activeTabId: secondTab.id, tabs: [secondTab] }],
  };
}

function singleArrangement(groupId: string): WorkspaceArrangementDto {
  return { kind: 'single', groupId };
}

export function closeWorkspaceTab(state: WorkspaceRuntimeState, tabId: string) {
  const found = findWorkspaceTab(state, tabId);
  if (!found) return state;
  const group = found.group;
  if (group.tabs.length === 1 && state.groups.length === 1) {
    const replacement = runtimeTab();
    return {
      ...state,
      groups: [{ ...group, activeTabId: replacement.id, tabs: [replacement] }],
    };
  }
  if (group.tabs.length === 1) {
    const remainingGroup = state.groups.find((candidate) => candidate.id !== group.id)!;
    return {
      ...state,
      activeGroupId: remainingGroup.id,
      arrangement: singleArrangement(remainingGroup.id),
      groups: [{ ...remainingGroup, tabsCollapsed: false }],
    };
  }
  const index = group.tabs.findIndex((tab) => tab.id === tabId);
  const tabs = group.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId = group.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)].id : group.activeTabId;
  return {
    ...state,
    groups: state.groups.map((candidate) =>
      candidate.id === group.id ? { ...candidate, activeTabId, tabs } : candidate,
    ),
  };
}

export function closeOtherWorkspaceTabs(state: WorkspaceRuntimeState, groupId: string, tabId: string) {
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id !== groupId) return group;
      const tab = group.tabs.find((candidate) => candidate.id === tabId);
      return tab ? { ...group, activeTabId: tabId, tabs: [tab] } : group;
    }),
  };
}

export function reorderWorkspaceTab(state: WorkspaceRuntimeState, groupId: string, tabId: string, delta: -1 | 1) {
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.id !== groupId) return group;
      const index = group.tabs.findIndex((tab) => tab.id === tabId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= group.tabs.length) return group;
      const tabs = [...group.tabs];
      [tabs[index], tabs[nextIndex]] = [tabs[nextIndex], tabs[index]];
      return { ...group, tabs };
    }),
  };
}

export function splitWorkspace(
  state: WorkspaceRuntimeState,
  sourceTabId: string,
  axis: 'columns' | 'rows',
): WorkspaceRuntimeState {
  if (state.groups.length === 2) {
    return state.arrangement.kind === 'split'
      ? {
          ...state,
          arrangement: { ...state.arrangement, axis },
          groups: state.groups.map((group) => ({ ...group, tabsCollapsed: false })),
        }
      : state;
  }
  const source = findWorkspaceTab(state, sourceTabId);
  if (!source) return state;
  const sourceEntry = activeNavigationEntry(source.tab);
  if (!workspaceLocationCanSplit(sourceEntry.location)) return state;
  const secondGroupId = identity('group');
  const secondTab = runtimeTab(sourceEntry.location, identity('tab'), sourceEntry.articleLocation);
  return {
    ...state,
    activeGroupId: secondGroupId,
    arrangement: { kind: 'split', axis, ratio: 5_000, groupIds: [source.group.id, secondGroupId] },
    groups: [...state.groups, { id: secondGroupId, activeTabId: secondTab.id, tabs: [secondTab] }],
  };
}

export function setWorkspaceSplitRatio(state: WorkspaceRuntimeState, ratio: number) {
  if (state.arrangement.kind !== 'split') return state;
  const normalized = Math.min(Math.max(Math.round(ratio), 2_500), 7_500);
  return normalized === state.arrangement.ratio
    ? state
    : { ...state, arrangement: { ...state.arrangement, ratio: normalized } };
}

export function moveWorkspaceTabToOtherGroup(state: WorkspaceRuntimeState, tabId: string) {
  if (state.groups.length !== 2) return state;
  const found = findWorkspaceTab(state, tabId);
  if (!found) return state;
  const targetGroup = state.groups.find((group) => group.id !== found.group.id)!;
  if (targetGroup.tabs.length >= MAX_TABS_PER_GROUP) return state;
  if (found.group.tabs.length === 1) {
    const tabs = [...targetGroup.tabs, found.tab];
    return {
      ...state,
      activeGroupId: targetGroup.id,
      arrangement: singleArrangement(targetGroup.id),
      groups: [{ ...targetGroup, activeTabId: found.tab.id, tabsCollapsed: false, tabs }],
    };
  }
  const sourceTabs = found.group.tabs.filter((tab) => tab.id !== tabId);
  const sourceActiveTabId =
    found.group.activeTabId === tabId ? sourceTabs[Math.max(0, sourceTabs.length - 1)].id : found.group.activeTabId;
  return {
    ...state,
    activeGroupId: targetGroup.id,
    groups: state.groups.map((group) => {
      if (group.id === found.group.id) return { ...group, activeTabId: sourceActiveTabId, tabs: sourceTabs };
      if (group.id === targetGroup.id) {
        return { ...group, activeTabId: tabId, tabsCollapsed: false, tabs: [...group.tabs, found.tab] };
      }
      return group;
    }),
  };
}

export function mergeWorkspaceGroups(state: WorkspaceRuntimeState, sourceGroupId: string) {
  if (state.groups.length !== 2) return state;
  const activeGroup = state.groups.find((group) => group.id === sourceGroupId) ?? activeWorkspaceGroup(state);
  const otherGroup = state.groups.find((group) => group.id !== activeGroup.id)!;
  const tabs = [...activeGroup.tabs, ...otherGroup.tabs];
  if (tabs.length > MAX_TABS_PER_GROUP) return state;
  return {
    ...state,
    activeGroupId: activeGroup.id,
    arrangement: singleArrangement(activeGroup.id),
    groups: [{ ...activeGroup, tabsCollapsed: false, tabs }],
  };
}

export function resetWorkspace(state: WorkspaceRuntimeState) {
  return createDefaultWorkspaceState(state.spaceId, state.revision);
}
