import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { HistoryNavigationGuard } from '@/renderer/components/app/app-navigation';
import type { useWorkspaceController } from '@/renderer/components/workspace/useWorkspaceController';
import { findWorkspaceTab, type WorkspaceRuntimeGroup } from '@/renderer/components/workspace/workspace-state';

interface Options {
  workspace: ReturnType<typeof useWorkspaceController>;
  guards: RefObject<Map<string, HistoryNavigationGuard>>;
  flushers: RefObject<Map<string, () => void>>;
  fullWindow: boolean;
  clearFullWindow(): void;
}

/** Mouse and keyboard use the same exit/flush/mutation boundary. */
export function useWorkspaceActions(options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);
  const { workspace, guards, flushers, clearFullWindow } = options;

  function requestTabExit(tabId: string, action: () => void) {
    const spaceId = workspace.state?.spaceId;
    if (!spaceId) return;
    const apply = () => {
      const current = latest.current.workspace.state;
      if (current?.spaceId === spaceId && findWorkspaceTab(current, tabId)) action();
    };
    if (guards.current.get(tabId)?.('forward', apply)) return;
    apply();
  }

  function requestTabExits(tabIds: readonly string[], action: () => void) {
    const topology = (state: typeof workspace.state) =>
      JSON.stringify(state?.groups.map((group) => [group.id, group.tabs.map((tab) => tab.id)]));
    const expected = topology(workspace.state);
    const advance = (index: number) => {
      if (topology(latest.current.workspace.state) !== expected) return;
      const tabId = tabIds[index];
      if (tabId) requestTabExit(tabId, () => advance(index + 1));
      else action();
    };
    advance(0);
  }

  function activateGroup(groupId: string, committed?: () => void) {
    if (!workspace.state?.groups.some((group) => group.id === groupId)) return;
    const apply = () => {
      const current = latest.current.workspace.state;
      if (!current?.groups.some((group) => group.id === groupId)) return;
      if (current.activeGroupId !== groupId) clearFullWindow();
      workspace.activateGroup(groupId);
      committed?.();
    };
    const current = workspace.activeTab;
    if (options.fullWindow && current && workspace.state.activeGroupId !== groupId) {
      requestTabExit(current.id, apply);
    } else apply();
  }

  function activateTab(group: WorkspaceRuntimeGroup, tabId: string, committed?: () => void) {
    if (!group.tabs.some((tab) => tab.id === tabId)) return;
    if (tabId === group.activeTabId) return activateGroup(group.id, committed);
    requestTabExit(group.activeTabId, () => {
      const current = latest.current.workspace.state;
      const target = current && findWorkspaceTab(current, tabId);
      if (!target || target.group.id !== group.id || target.group.activeTabId !== group.activeTabId) return;
      flushers.current.get(group.activeTabId)?.();
      clearFullWindow();
      workspace.activateTab(group.id, tabId);
      committed?.();
    });
  }

  function setGroupTabsCollapsed(groupId: string, collapsed: boolean) {
    if (!collapsed) return activateGroup(groupId);
    const group = workspace.state?.groups.find((candidate) => candidate.id === groupId);
    if (!group || workspace.state?.arrangement.kind !== 'split') return;
    requestTabExit(group.activeTabId, () => {
      const current = latest.current.workspace;
      const target = current.state?.groups.find((candidate) => candidate.id === groupId);
      if (!target || target.activeTabId !== group.activeTabId) return;
      flushers.current.get(group.activeTabId)?.();
      clearFullWindow();
      current.setGroupTabsCollapsed(groupId, true);
    });
  }

  function closeTab(tabId: string, committed?: () => void) {
    requestTabExit(tabId, () => {
      flushers.current.get(tabId)?.();
      if (latest.current.workspace.activeTab?.id === tabId) clearFullWindow();
      workspace.closeTab(tabId);
      committed?.();
    });
  }

  function closeOtherTabs(group: WorkspaceRuntimeGroup, tabId: string) {
    const closing = group.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id);
    requestTabExits(closing, () => {
      closing.forEach((id) => flushers.current.get(id)?.());
      workspace.closeOtherTabs(group.id, tabId);
    });
  }

  function resetLayout() {
    if (!workspace.state) return;
    const tabIds = workspace.state.groups.flatMap((group) => group.tabs.map((tab) => tab.id));
    requestTabExits(tabIds, () => {
      tabIds.forEach((id) => flushers.current.get(id)?.());
      clearFullWindow();
      workspace.reset();
    });
  }

  function mergeWorkspaceGroupsFrom(sourceGroup: WorkspaceRuntimeGroup) {
    const other = workspace.state?.groups.find((group) => group.id !== sourceGroup.id);
    const remounting = other?.tabs.map((tab) => tab.id) ?? [];
    requestTabExits(remounting, () => {
      remounting.forEach((id) => flushers.current.get(id)?.());
      workspace.mergeGroups(sourceGroup.id);
    });
  }

  function moveTabToOtherGroup(tabId: string) {
    requestTabExit(tabId, () => {
      flushers.current.get(tabId)?.();
      workspace.moveTabToOtherGroup(tabId);
    });
  }

  return {
    requestTabExit,
    requestTabExits,
    activateGroup,
    activateTab,
    setGroupTabsCollapsed,
    closeTab,
    closeOtherTabs,
    resetLayout,
    mergeWorkspaceGroupsFrom,
    moveTabToOtherGroup,
  };
}
