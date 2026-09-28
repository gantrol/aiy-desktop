import type { AppCommandId } from '@/renderer/commands/app-shortcuts';
import { activeWorkspaceGroup, type WorkspaceRuntimeState } from '@/renderer/components/workspace/workspace-state';

export type WorkspaceShortcutTarget =
  | { kind: 'activate'; groupId: string; tabId: string }
  | { kind: 'group'; groupId: string; tabId: string }
  | { kind: 'close'; tabId: string }
  | { kind: 'new'; tabId: string };

export function workspaceShortcutTarget(
  state: WorkspaceRuntimeState,
  id: AppCommandId,
): WorkspaceShortcutTarget | null {
  const group = activeWorkspaceGroup(state);
  if (id === 'workspace.new-tab') return { kind: 'new', tabId: group.activeTabId };
  if (id === 'workspace.close-tab') return { kind: 'close', tabId: group.activeTabId };
  if (id.startsWith('workspace.group.')) {
    const index = Number(id.slice('workspace.group.'.length)) - 1;
    const groupIds = state.arrangement.kind === 'split' ? state.arrangement.groupIds : [state.arrangement.groupId];
    const target = state.groups.find((candidate) => candidate.id === groupIds[index]);
    return target ? { kind: 'group', groupId: target.id, tabId: target.activeTabId } : null;
  }
  let index: number;
  if (id === 'workspace.next-tab' || id === 'workspace.previous-tab') {
    if (group.tabs.length < 2) return null;
    const current = group.tabs.findIndex((tab) => tab.id === group.activeTabId);
    const delta = id === 'workspace.next-tab' ? 1 : -1;
    index = (current + delta + group.tabs.length) % group.tabs.length;
  } else if (id.startsWith('workspace.tab.')) {
    index = Number(id.slice('workspace.tab.'.length)) - 1;
  } else {
    return null;
  }
  const tab = group.tabs[index];
  return tab ? { kind: 'activate', groupId: group.id, tabId: tab.id } : null;
}
