import { useEffect, useRef } from 'react';
import type { NavigationCommand } from '@/shared/contracts';
import { DEFAULT_MOUSE_NAVIGATION_BINDINGS } from '@/renderer/appPresentation';
import {
  appShortcutCommands,
  commandMatchesShortcut,
  isWorkspaceShortcut,
  shortcutEventAvailable,
} from '@/renderer/commands/app-shortcuts';
import { focusWorkspaceTab, workspaceShortcutLayerOpen } from '@/renderer/commands/shortcut-context';
import { workspaceShortcutTarget } from '@/renderer/commands/workspace-shortcut-target';
import type { WorkspaceRuntimeState } from '@/renderer/components/workspace/workspace-state';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Props {
  state: WorkspaceRuntimeState | null;
  enabled: boolean;
  activateTab(groupId: string, tabId: string, committed: () => void): void;
  activateGroup(groupId: string, committed: () => void): void;
  closeTab(tabId: string, committed: () => void): void;
  newTab(sourceTabId: string): void;
  navigateHistory(command: NavigationCommand): void;
  startNew(): void;
  openSearch(): void;
}

function browserNavigation(event: KeyboardEvent): NavigationCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'BrowserBack' || event.code === 'BrowserBack' || event.keyCode === 166) return 'back';
  if (event.key === 'BrowserForward' || event.code === 'BrowserForward' || event.keyCode === 167) return 'forward';
  return null;
}

export function useAppWorkspaceShortcuts(props: Props) {
  const frames = useRef(new Set<number>());
  const mounted = useRef(false);
  const restoreFocus = useStableCallback((spaceId: string, groupId?: string, tabId?: string) => {
    const state = props.state;
    if (!mounted.current || !props.enabled || state?.spaceId !== spaceId) return;
    const group = state.groups.find((candidate) => candidate.id === state.activeGroupId);
    if (!group || (groupId && group.id !== groupId) || (tabId && group.activeTabId !== tabId)) return;
    // A close should recover lost focus, never steal it from a surviving control.
    if (!tabId && document.activeElement !== document.body && document.activeElement?.isConnected) return;
    focusWorkspaceTab(group.id, group.activeTabId);
  });
  const handleKeyDown = useStableCallback((event: KeyboardEvent) => {
    const { state } = props;
    if (!props.enabled || !state || event.repeat || !shortcutEventAvailable(event) || workspaceShortcutLayerOpen())
      return;
    const navigation = browserNavigation(event);
    if (navigation) {
      event.preventDefault();
      props.navigateHistory(navigation);
      return;
    }
    const command = appShortcutCommands.find(
      (candidate) =>
        isWorkspaceShortcut(candidate) && commandMatchesShortcut(event, window.desktopApi.appPlatform, candidate.id),
    );
    if (!command) return;
    const target = workspaceShortcutTarget(state, command.id);
    if (!target && command.group === 'workspace') return;
    event.preventDefault();
    if (command.id === 'app.new') return props.startNew();
    if (command.id === 'app.search') return props.openSearch();
    if (command.id === 'navigation.back') return props.navigateHistory('back');
    if (command.id === 'navigation.forward') return props.navigateHistory('forward');
    if (!target) return;
    if (target.kind === 'new') return props.newTab(target.tabId);
    const committed = () => {
      if (!mounted.current) return;
      const frame = requestAnimationFrame(() => {
        frames.current.delete(frame);
        if (target.kind === 'close') restoreFocus(state.spaceId);
        else restoreFocus(state.spaceId, target.groupId, target.tabId);
      });
      frames.current.add(frame);
    };
    if (target.kind === 'close') props.closeTab(target.tabId, committed);
    else if (target.kind === 'group') props.activateGroup(target.groupId, committed);
    else props.activateTab(target.groupId, target.tabId, committed);
  });
  const handleMouseNavigation = useStableCallback((event: MouseEvent) => {
    if (!props.enabled || !props.state || event.defaultPrevented || workspaceShortcutLayerOpen()) return;
    const command = DEFAULT_MOUSE_NAVIGATION_BINDINGS.get(event.button);
    if (!command) return;
    event.preventDefault();
    props.navigateHistory(command);
  });
  useEffect(() => {
    mounted.current = true;
    const scheduled = frames.current;
    window.addEventListener('keydown', handleKeyDown);
    // Bubble phase gives the focused surface the first chance to consume the event.
    window.addEventListener('mouseup', handleMouseNavigation);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mouseup', handleMouseNavigation);
      scheduled.forEach(cancelAnimationFrame);
      scheduled.clear();
    };
  }, [handleKeyDown, handleMouseNavigation]);
}
