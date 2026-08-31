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
import type { AppView } from '@/renderer/components/app/AppSidebar';
import {
  appLocationToWorkspaceTarget,
  normalizeWorkspaceTarget,
  workspaceLocationKey,
} from '@/renderer/components/workspace/workspace-location';

const MAX_HISTORY_ENTRIES = 100;
const MAX_TABS_PER_GROUP = 24;

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
  ].slice(0, MAX_TABS_PER_GROUP);
  return {
    ...state,
    activeGroupId: activeGroup.id,
    arrangement: { kind: 'single', groupId: activeGroup.id },
    groups: [{ ...activeGroup, tabs }],
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
  };
}

export function restoreWorkspaceState(data: BootstrapDto): WorkspaceRuntimeState {
  const snapshot = data.workspaceLayout;
  if (!snapshot || snapshot.spaceId !== data.spaceId) return createDefaultWorkspaceState(data.spaceId);

  const groups: WorkspaceRuntimeGroup[] = [];
  for (const group of snapshot.state.groups) {
    const tabs: WorkspaceRuntimeTab[] = [];
    for (const tab of group.tabs) {
      const entries = (
        tab.history?.length
          ? tab.history.map((entry) =>
              navigationEntry(normalizeWorkspaceTarget(entry.target, data), entry.articleLocation, entry.id),
            )
          : [navigationEntry(normalizeWorkspaceTarget(tab.target, data))]
      ).slice(-MAX_HISTORY_ENTRIES);
      const index = Math.min(tab.historyIndex ?? entries.length - 1, entries.length - 1);
      tabs.push({
        id: tab.id,
        history: { entries, index },
        visitedViews: [...new Set(entries.map((entry) => entry.location.view))],
      });
    }
    if (!tabs.length) continue;
    groups.push({
      id: group.id,
      activeTabId: tabs.some((tab) => tab.id === group.activeTabId) ? group.activeTabId : tabs[0].id,
      tabs,
    });
  }
  if (!groups.length) return createDefaultWorkspaceState(data.spaceId, snapshot.revision);

  const activeGroupId = groups.some((group) => group.id === snapshot.state.activeGroupId)
    ? snapshot.state.activeGroupId
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
    groups,
    articleEditors: snapshot.state.articleEditors,
    articleEditOwners: snapshot.state.articleEditOwners,
  });
}

export function persistedWorkspaceState(state: WorkspaceRuntimeState): WorkspaceLayoutStateDto {
  return {
    activeGroupId: state.activeGroupId,
    arrangement: state.arrangement,
    groups: state.groups.map((group) => ({
      id: group.id,
      activeTabId: group.activeTabId,
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
  const nextKey = workspaceLocationKey(nextLocation);
  const duplicate = found.group.tabs.find(
    (tab) => tab.id !== tabId && workspaceLocationKey(activeLocation(tab)) === nextKey,
  );
  if (duplicate) return activateWorkspaceTab(state, found.group.id, duplicate.id);
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
  return withTab(state, tabId, (tab) => {
    const index = Math.min(Math.max(tab.history.index + delta, 0), tab.history.entries.length - 1);
    return index === tab.history.index ? tab : { ...tab, history: { ...tab.history, index } };
  });
}

export function activateWorkspaceTab(state: WorkspaceRuntimeState, groupId: string, tabId: string) {
  const currentGroup = state.groups.find((group) => group.id === groupId);
  if (!currentGroup?.tabs.some((tab) => tab.id === tabId)) return state;
  if (state.activeGroupId === groupId && currentGroup.activeTabId === tabId) return state;
  return {
    ...state,
    activeGroupId: groupId,
    groups: state.groups.map((group) =>
      group.id === groupId && group.tabs.some((tab) => tab.id === tabId) ? { ...group, activeTabId: tabId } : group,
    ),
  };
}

export function activateWorkspaceGroup(state: WorkspaceRuntimeState, groupId: string) {
  if (state.activeGroupId === groupId || !state.groups.some((group) => group.id === groupId)) return state;
  return { ...state, activeGroupId: groupId };
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

export function openWorkspaceTab(
  state: WorkspaceRuntimeState,
  location: AppLocation,
  requestedGroupId?: string,
  reuseExisting = true,
) {
  const targetKey = workspaceLocationKey(location);
  const groupId = requestedGroupId ?? state.activeGroupId;
  const targetGroup = state.groups.find((group) => group.id === groupId);
  if (!targetGroup || targetGroup.tabs.length >= 24) return state;
  const existing = reuseExisting
    ? targetGroup.tabs.find((tab) => workspaceLocationKey(activeLocation(tab)) === targetKey)
    : undefined;
  if (existing) return activateWorkspaceTab(state, targetGroup.id, existing.id);
  const tab = runtimeTab(location);
  return {
    ...state,
    activeGroupId: groupId,
    groups: state.groups.map((group) =>
      group.id === groupId ? { ...group, activeTabId: tab.id, tabs: [...group.tabs, tab] } : group,
    ),
  };
}

export function openWorkspaceTabBeside(state: WorkspaceRuntimeState, location: AppLocation): WorkspaceRuntimeState {
  const sourceGroup = activeWorkspaceGroup(state);
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
      groups: [remainingGroup],
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

export function splitWorkspace(state: WorkspaceRuntimeState, axis: 'columns' | 'rows'): WorkspaceRuntimeState {
  if (state.groups.length === 2) {
    return state.arrangement.kind === 'split' ? { ...state, arrangement: { ...state.arrangement, axis } } : state;
  }
  const sourceTab = activeWorkspaceTab(state);
  const sourceEntry = activeNavigationEntry(sourceTab);
  const secondGroupId = identity('group');
  const secondTab = runtimeTab(sourceEntry.location, identity('tab'), sourceEntry.articleLocation);
  return {
    ...state,
    activeGroupId: secondGroupId,
    arrangement: { kind: 'split', axis, ratio: 5_000, groupIds: [state.groups[0].id, secondGroupId] },
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
  if (targetGroup.tabs.length >= 24) return state;
  if (found.group.tabs.length === 1) {
    const tabs = [...targetGroup.tabs, found.tab];
    return {
      ...state,
      activeGroupId: targetGroup.id,
      arrangement: singleArrangement(targetGroup.id),
      groups: [{ ...targetGroup, activeTabId: found.tab.id, tabs }],
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
        return { ...group, activeTabId: tabId, tabs: [...group.tabs, found.tab] };
      }
      return group;
    }),
  };
}

export function mergeWorkspaceGroups(state: WorkspaceRuntimeState) {
  if (state.groups.length !== 2) return state;
  const activeGroup = activeWorkspaceGroup(state);
  const otherGroup = state.groups.find((group) => group.id !== activeGroup.id)!;
  if (activeGroup.tabs.length + otherGroup.tabs.length > 24) return state;
  const tabs = [...activeGroup.tabs, ...otherGroup.tabs];
  return {
    ...state,
    activeGroupId: activeGroup.id,
    arrangement: singleArrangement(activeGroup.id),
    groups: [{ ...activeGroup, tabs }],
  };
}

export function resetWorkspace(state: WorkspaceRuntimeState) {
  return createDefaultWorkspaceState(state.spaceId, state.revision);
}
