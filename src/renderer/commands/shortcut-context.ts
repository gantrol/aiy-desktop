const hiddenContext = '[hidden], [inert], [aria-hidden="true"], [data-state="closed"]';

export function workspaceShortcutLayerOpen(root: ParentNode = document) {
  return [...root.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')].some(
    (element) => !element.closest(hiddenContext),
  );
}

export function focusWorkspaceTab(groupId: string, tabId: string) {
  const group = [...document.querySelectorAll<HTMLElement>('[data-workspace-group-id]')].find(
    (element) => element.dataset.workspaceGroupId === groupId,
  );
  const pane =
    group &&
    [...group.querySelectorAll<HTMLElement>('[data-workspace-tab-id]')].find(
      (element) => element.dataset.workspaceTabId === tabId && !element.closest(hiddenContext),
    );
  if (!group || !pane || workspaceShortcutLayerOpen()) return;
  const candidates = [
    ...pane.querySelectorAll<HTMLElement>('[data-workspace-last-focus]'),
    ...pane.querySelectorAll<HTMLElement>('[contenteditable="true"], input, textarea, button, [tabindex="0"]'),
    ...group.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]'),
  ];
  const target = candidates.find(
    (element) =>
      !element.closest(hiddenContext) && !element.matches(':disabled, [aria-disabled="true"], input[type="hidden"]'),
  );
  target?.focus({ preventScroll: true });
}
