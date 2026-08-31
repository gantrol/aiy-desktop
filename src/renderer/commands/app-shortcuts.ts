import type { DesktopPlatform, Locale } from '@/shared/contracts';

export type ShortcutGroup = 'general' | 'navigation' | 'editing' | 'comments' | 'media';
export type AppCommandId =
  | 'app.new'
  | 'document.save'
  | 'document.find'
  | 'document.replace'
  | 'navigation.back'
  | 'navigation.forward'
  | 'edit.previous-location'
  | 'edit.next-location'
  | 'comment.quick-add'
  | `workspace.tab.${number}`
  | `workspace.group.${number}`
  | `format.heading.${number}`;

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
  label: Record<Locale, string>;
  scope: Record<Locale, string>;
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
  zh: string,
  en: string,
  scopeZh: string,
  scopeEn: string,
  bindings: ShortcutCommand['bindings'],
): ShortcutCommand => ({ id, group, label: { zh, en }, scope: { zh: scopeZh, en: scopeEn }, bindings });

const fixedCommands: ShortcutCommand[] = [
  command('app.new', 'general', '新建', 'New', '应用', 'App', mod('n')),
  command('document.save', 'general', '保存', 'Save', '编辑器', 'Editor', mod('s')),
  command('document.find', 'editing', '查找', 'Find', '编辑器', 'Editor', mod('f')),
  command('document.replace', 'editing', '替换', 'Replace', '编辑器', 'Editor', {
    darwin: [{ key: 'f', meta: true, alt: true }],
    linux: [{ key: 'h', ctrl: true }],
    win32: [{ key: 'h', ctrl: true }],
  }),
  command('navigation.back', 'navigation', '后退', 'Back', '当前分屏', 'Active split', {
    darwin: [{ key: '-', ctrl: true }],
    linux: [{ key: '-', ctrl: true, alt: true }],
    win32: [{ key: 'ArrowLeft', alt: true }],
  }),
  command('navigation.forward', 'navigation', '前进', 'Forward', '当前分屏', 'Active split', {
    darwin: [{ key: '-', ctrl: true, shift: true }],
    linux: [{ key: '-', ctrl: true, shift: true }],
    win32: [{ key: 'ArrowRight', alt: true }],
  }),
  command(
    'edit.previous-location',
    'editing',
    '上一处编辑',
    'Previous edit',
    '当前文章',
    'Current article',
    allPlatforms({ key: 'F4', shift: true }),
  ),
  command(
    'edit.next-location',
    'editing',
    '下一处编辑',
    'Next edit',
    '当前文章',
    'Current article',
    allPlatforms({ key: 'F4' }),
  ),
  command(
    'comment.quick-add',
    'comments',
    '快速评论',
    'Quick comment',
    '文章选区',
    'Article selection',
    mod('m', { shift: true }),
  ),
];

const tabCommands = Array.from({ length: 9 }, (_, offset) => {
  const index = offset + 1;
  return command(
    `workspace.tab.${index}`,
    'navigation',
    `切换到组内标签 ${index}`,
    `Open tab ${index} in group`,
    '当前分屏',
    'Active split',
    {
      darwin: [{ key: String(index), ctrl: true }],
      linux: [{ key: String(index), alt: true }],
      win32: [{ key: String(index), alt: true }],
    },
  );
});

const groupCommands = Array.from({ length: 2 }, (_, offset) => {
  const index = offset + 1;
  return command(
    `workspace.group.${index}`,
    'navigation',
    `聚焦分屏 ${index}`,
    `Focus split ${index}`,
    '工作区',
    'Workspace',
    {
      darwin: [{ key: String(index), meta: true }],
      linux: [{ key: String(index), ctrl: true }],
      win32: [{ key: String(index), ctrl: true }],
    },
  );
});

const headingCommands = Array.from({ length: 5 }, (_, offset) => {
  const level = offset + 2;
  return command(
    `format.heading.${level}`,
    'editing',
    `设为 ${level} 级标题`,
    `Heading ${level}`,
    '富文本编辑器',
    'Rich-text editor',
    {
      darwin: [{ key: String(level), meta: true, alt: true }],
      linux: [{ key: String(level), ctrl: true, alt: true }],
      win32: [{ key: String(level), ctrl: true, alt: true }],
    },
  );
});

export const appShortcutCommands: readonly ShortcutCommand[] = [
  ...fixedCommands,
  ...tabCommands,
  ...groupCommands,
  ...headingCommands,
];

function normalizedKey(key: string) {
  return key.length === 1 ? key.toLocaleLowerCase() : key;
}

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding) {
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
  if (event.defaultPrevented || event.isComposing) return false;
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
  tokens.push(keyLabels[binding.key] ?? binding.key.toLocaleUpperCase());
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
