import type { Input, WebContents } from 'electron';
import type { DesktopPlatform } from '@/shared/contracts';
import { appShortcutCommands, isWorkspaceShortcut, matchesShortcut } from '@/shared/app-shortcuts';

/** Only renderer-owned commands bypass the default menu's accelerators. */
export function workspaceOwnsNativeShortcut(input: Input, platform: DesktopPlatform) {
  const key = {
    key: input.key,
    code: input.code,
    ctrlKey: input.control,
    metaKey: input.meta,
    altKey: input.alt,
    shiftKey: input.shift,
  };
  return appShortcutCommands.some(
    (command) =>
      isWorkspaceShortcut(command) && command.bindings[platform]?.some((binding) => matchesShortcut(key, binding)),
  );
}

export function installWorkspaceMenuShortcuts(webContents: WebContents, platform: DesktopPlatform) {
  webContents.on('before-input-event', (_event, input) => {
    // Do not prevent the input event: the focused renderer surface decides whether
    // the command is allowed (IME, overlay, input guard and active space).
    webContents.setIgnoreMenuShortcuts(workspaceOwnsNativeShortcut(input, platform));
  });
}
