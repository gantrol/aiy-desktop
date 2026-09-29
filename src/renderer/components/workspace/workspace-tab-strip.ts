import type { BootstrapDto } from '@/shared/contracts';
import type { AppView } from '@/renderer/components/app/app-navigation';
import type { WorkspaceRuntimeGroup, WorkspaceRuntimeTab } from '@/renderer/components/workspace/workspace-state';

/** Folding changes the strip's presentation, never its tab membership. */
export function visibleWorkspaceTabs(group: WorkspaceRuntimeGroup): readonly WorkspaceRuntimeTab[] {
  return group.tabs;
}

/** Manual activation: arrows move focus; Enter/Space still use the guarded activation path. */
export function workspaceTabFocusTarget(
  tabs: readonly { id: string }[],
  tabId: string,
  key: string,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): string | null {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return null;
  if (orientation === 'vertical') {
    if (key === 'ArrowLeft' || key === 'ArrowRight') return null;
    if (key === 'ArrowUp') key = 'ArrowLeft';
    if (key === 'ArrowDown') key = 'ArrowRight';
  }
  switch (key) {
    case 'ArrowLeft':
      return tabs[(index + tabs.length - 1) % tabs.length].id;
    case 'ArrowRight':
      return tabs[(index + 1) % tabs.length].id;
    case 'Home':
      return tabs[0].id;
    case 'End':
      return tabs[tabs.length - 1].id;
    default:
      return null;
  }
}

export interface WorkspaceTabStripProps {
  data: BootstrapDto;
  group: WorkspaceRuntimeGroup;
  active: boolean;
  collapsed?: boolean;
  onTabsCollapsedChange(collapsed: boolean): void;
  onActivate(tabId: string): void;
  onClose(tabId: string, committed?: () => void): void;
  onCloseOthers(tabId: string): void;
  onReorder(tabId: string, delta: -1 | 1): void;
  onNewTab(view: AppView): void;
  onOpenBeside(view: AppView): void;
  splitAxis: 'columns' | 'rows' | null;
  splitPosition: 'start' | 'end';
  onMerge(): void;
  onMoveToOtherGroup(tabId: string): void;
  onSplit(axis: 'columns' | 'rows'): void;
  onReset(): void;
}
