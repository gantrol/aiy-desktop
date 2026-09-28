import type { AppCommandId, FixedAppCommandId } from '@/renderer/commands/app-shortcuts';
import type { MessageCatalog } from '@/renderer/i18n/types';

export function shortcutCommandLabel(id: AppCommandId, messages: MessageCatalog): string {
  const labels = messages.app.shortcuts.commands;
  if (id.startsWith('workspace.tab.')) return labels.tab(Number(id.slice('workspace.tab.'.length)));
  if (id.startsWith('workspace.group.')) return labels.group(Number(id.slice('workspace.group.'.length)));
  if (id.startsWith('format.heading.')) return labels.heading(Number(id.slice('format.heading.'.length)));
  return labels[id as FixedAppCommandId];
}
