import { useEffect } from 'react';
import type { NavigationCommand } from '@/shared/contracts';
import { DEFAULT_MOUSE_NAVIGATION_BINDINGS } from '@/renderer/appPresentation';
import { commandMatchesShortcut } from '@/renderer/commands/app-shortcuts';
import { activeWorkspaceGroup, type WorkspaceRuntimeState } from '@/renderer/components/workspace/workspace-state';

function focusWorkspaceGroup(groupId: string) {
  const root = [...document.querySelectorAll<HTMLElement>('[data-workspace-group-id]')].find(
    (candidate) => candidate.dataset.workspaceGroupId === groupId,
  );
  if (!root) return;
  const target =
    root.querySelector<HTMLElement>('[data-workspace-last-focus]') ??
    root.querySelector<HTMLElement>('[data-slot="video-document-wysiwyg-editor"] [contenteditable="true"]') ??
    root.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
  target?.focus({ preventScroll: true });
}

export function useAppWorkspaceShortcuts({
  state,
  activateGroupByIndex,
  activateTabByIndex,
  navigateHistory,
  startNew,
}: {
  state: WorkspaceRuntimeState | null;
  activateGroupByIndex(index: number): void;
  activateTabByIndex(index: number): void;
  navigateHistory(command: NavigationCommand): void;
  startNew(): void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || document.querySelector('[role="dialog"]')) return;
      const command: NavigationCommand | null =
        event.key === 'BrowserBack' || event.code === 'BrowserBack' || event.keyCode === 166
          ? 'back'
          : event.key === 'BrowserForward' || event.code === 'BrowserForward' || event.keyCode === 167
            ? 'forward'
            : commandMatchesShortcut(event, window.desktopApi.appPlatform, 'navigation.back')
              ? 'back'
              : commandMatchesShortcut(event, window.desktopApi.appPlatform, 'navigation.forward')
                ? 'forward'
                : null;
      if (command) {
        event.preventDefault();
        navigateHistory(command);
        return;
      }
      if (commandMatchesShortcut(event, window.desktopApi.appPlatform, 'app.new')) {
        event.preventDefault();
        startNew();
        return;
      }
      for (let index = 1; index <= 9; index += 1) {
        if (!commandMatchesShortcut(event, window.desktopApi.appPlatform, `workspace.tab.${index}`)) continue;
        const group = state ? activeWorkspaceGroup(state) : null;
        if (!group?.tabs[index - 1]) return;
        event.preventDefault();
        activateTabByIndex(index - 1);
        window.requestAnimationFrame(() => focusWorkspaceGroup(group.id));
        return;
      }
      for (let index = 1; index <= 2; index += 1) {
        if (!commandMatchesShortcut(event, window.desktopApi.appPlatform, `workspace.group.${index}`)) continue;
        const groupId =
          state?.arrangement.kind === 'split'
            ? state.arrangement.groupIds[index - 1]
            : index === 1
              ? state?.arrangement.groupId
              : undefined;
        if (!groupId) return;
        event.preventDefault();
        activateGroupByIndex(index - 1);
        window.requestAnimationFrame(() => focusWorkspaceGroup(groupId));
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activateGroupByIndex, activateTabByIndex, navigateHistory, startNew, state]);

  useEffect(() => {
    const handleMouseNavigation = (event: MouseEvent) => {
      const command = DEFAULT_MOUSE_NAVIGATION_BINDINGS.get(event.button);
      if (!command) return;
      event.preventDefault();
      navigateHistory(command);
    };
    window.addEventListener('mouseup', handleMouseNavigation, true);
    return () => window.removeEventListener('mouseup', handleMouseNavigation, true);
  }, [navigateHistory]);
}
