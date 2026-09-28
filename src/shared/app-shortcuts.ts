import type { DesktopPlatform } from '@/shared/contracts';

export type ShortcutGroup = 'general' | 'navigation' | 'workspace' | 'editing' | 'comments' | 'media';
export type FixedAppCommandId =
  | 'app.new'
  | 'app.search'
  | 'workspace.new-tab'
  | 'workspace.close-tab'
  | 'workspace.next-tab'
  | 'workspace.previous-tab'
  | 'document.save'
  | 'document.find'
  | 'document.replace'
  | 'navigation.back'
  | 'navigation.forward'
  | 'edit.previous-location'
  | 'edit.next-location'
  | 'comment.quick-add';

export type AppCommandId =
  FixedAppCommandId | `workspace.tab.${number}` | `workspace.group.${number}` | `format.heading.${number}`;

export interface ShortcutBinding {
  key: string;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export interface ShortcutCommand {
  id: AppCommandId;
  group: ShortcutGroup;
  scope: 'app' | 'activeGroup' | 'workspace' | 'editor' | 'article' | 'articleSelection' | 'richText';
  bindings: Partial<Record<DesktopPlatform, readonly ShortcutBinding[]>>;
}

const allPlatforms = (binding: ShortcutBinding) => ({
  darwin: [binding],
  linux: [binding],
  win32: [binding],
});

const mod = (key: string, extra: Omit<ShortcutBinding, 'key' | 'ctrl' | 'meta'> = {}) => ({
  darwin: [{ key, meta: true, ...extra }],
  linux: [{ key, ctrl: true, ...extra }],
  win32: [{ key, ctrl: true, ...extra }],
});

const command = (
  id: AppCommandId,
  group: ShortcutGroup,
  scope: ShortcutCommand['scope'],
  bindings: ShortcutCommand['bindings'],
): ShortcutCommand => ({ id, group, scope, bindings });

const fixedCommands: ShortcutCommand[] = [
  command('app.new', 'general', 'app', mod('n')),
  command('app.search', 'general', 'app', mod('f', { shift: true })),
  command('workspace.new-tab', 'workspace', 'activeGroup', mod('t')),
  command('workspace.close-tab', 'workspace', 'activeGroup', mod('w')),
  command('workspace.next-tab', 'workspace', 'activeGroup', allPlatforms({ key: 'Tab', ctrl: true })),
  command('workspace.previous-tab', 'workspace', 'activeGroup', allPlatforms({ key: 'Tab', ctrl: true, shift: true })),
  command('document.save', 'general', 'editor', mod('s')),
  command('document.find', 'editing', 'editor', mod('f')),
  command('document.replace', 'editing', 'editor', {
    darwin: [{ key: 'f', meta: true, alt: true }],
    linux: [{ key: 'h', ctrl: true }],
    win32: [{ key: 'h', ctrl: true }],
  }),
  command('navigation.back', 'navigation', 'activeGroup', {
    darwin: [{ key: '-', ctrl: true }],
    linux: [{ key: '-', ctrl: true, alt: true }],
    win32: [{ key: 'ArrowLeft', alt: true }],
  }),
  command('navigation.forward', 'navigation', 'activeGroup', {
    darwin: [{ key: '-', ctrl: true, shift: true }],
    // Keep the established Linux binding; changing it needs a separate migration.
    linux: [{ key: '-', ctrl: true, shift: true }],
    win32: [{ key: 'ArrowRight', alt: true }],
  }),
  command('edit.previous-location', 'editing', 'article', allPlatforms({ key: 'F4', shift: true })),
  command('edit.next-location', 'editing', 'article', allPlatforms({ key: 'F4' })),
  command('comment.quick-add', 'comments', 'articleSelection', mod('m', { shift: true })),
];

const tabCommands = Array.from({ length: 9 }, (_, offset) => {
  const key = String(offset + 1);
  return command(`workspace.tab.${offset + 1}`, 'workspace', 'activeGroup', {
    darwin: [{ key, ctrl: true }],
    linux: [{ key, alt: true }],
    win32: [{ key, alt: true }],
  });
});

const groupCommands = Array.from({ length: 2 }, (_, offset) => {
  const key = String(offset + 1);
  return command(`workspace.group.${offset + 1}`, 'workspace', 'workspace', {
    darwin: [{ key, meta: true }],
    linux: [{ key, ctrl: true }],
    win32: [{ key, ctrl: true }],
  });
});

const headingCommands = Array.from({ length: 5 }, (_, offset) => {
  const key = String(offset + 2);
  return command(`format.heading.${offset + 2}`, 'editing', 'richText', {
    darwin: [{ key, meta: true, alt: true }],
    linux: [{ key, ctrl: true, alt: true }],
    win32: [{ key, ctrl: true, alt: true }],
  });
});

export const appShortcutCommands: readonly ShortcutCommand[] = [
  ...fixedCommands,
  ...tabCommands,
  ...groupCommands,
  ...headingCommands,
];

/** Composition and AltGraph belong to text input, never to application commands. */
export function shortcutEventAvailable(event: KeyboardEvent) {
  return !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !event.getModifierState('AltGraph');
}

export function shortcutBindingKey(binding: ShortcutBinding) {
  return [Boolean(binding.ctrl), Boolean(binding.meta), Boolean(binding.alt), Boolean(binding.shift), binding.key]
    .map((value) => String(value).toLowerCase())
    .join(':');
}

function normalizedKey(key: string) {
  return key.length === 1 ? key.toLowerCase() : key;
}

export interface ShortcutKeyInput {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isWorkspaceShortcut(command: ShortcutCommand) {
  return command.scope === 'app' || command.scope === 'workspace' || command.scope === 'activeGroup';
}

export function matchesShortcut(event: ShortcutKeyInput, binding: ShortcutBinding) {
  const keyMatches =
    normalizedKey(event.key) === normalizedKey(binding.key) || (binding.key === '-' && event.code === 'Minus');
  return (
    keyMatches &&
    event.altKey === Boolean(binding.alt) &&
    event.ctrlKey === Boolean(binding.ctrl) &&
    event.metaKey === Boolean(binding.meta) &&
    event.shiftKey === Boolean(binding.shift)
  );
}

export function commandMatchesShortcut(event: KeyboardEvent, platform: DesktopPlatform, commandId: AppCommandId) {
  if (!shortcutEventAvailable(event)) return false;
  const command = appShortcutCommands.find((candidate) => candidate.id === commandId);
  return command?.bindings[platform]?.some((binding) => matchesShortcut(event, binding)) ?? false;
}

export function shortcutTokens(binding: ShortcutBinding, platform: DesktopPlatform) {
  const tokens: string[] = [];
  if (binding.ctrl) tokens.push('Ctrl');
  if (binding.meta) tokens.push(platform === 'darwin' ? 'Cmd' : 'Meta');
  if (binding.alt) tokens.push(platform === 'darwin' ? 'Option' : 'Alt');
  if (binding.shift) tokens.push('Shift');
  const keyLabels: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  tokens.push(keyLabels[binding.key] ?? binding.key.toUpperCase());
  return tokens;
}

export function commandShortcutText(commandId: AppCommandId, platform: DesktopPlatform) {
  const binding = appShortcutCommands.find((command) => command.id === commandId)?.bindings[platform]?.[0];
  return binding ? shortcutTokens(binding, platform).join('+') : '';
}

export function commandAriaShortcut(commandId: AppCommandId, platform: DesktopPlatform) {
  const binding = appShortcutCommands.find((command) => command.id === commandId)?.bindings[platform]?.[0];
  if (!binding) return undefined;
  const tokens: string[] = [];
  if (binding.ctrl) tokens.push('Control');
  if (binding.meta) tokens.push('Meta');
  if (binding.alt) tokens.push('Alt');
  if (binding.shift) tokens.push('Shift');
  tokens.push(binding.key);
  return tokens.join('+');
}
