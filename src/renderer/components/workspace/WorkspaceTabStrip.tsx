import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { PanelLeftOpenIcon, PanelTopOpenIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { WorkspaceTabActions } from '@/renderer/components/workspace/WorkspaceTabActions';
import { WorkspaceTabItem } from '@/renderer/components/workspace/WorkspaceTabItem';
import { useWorkspaceTabLabels } from '@/renderer/components/workspace/useWorkspaceTabLabels';
import { activeLocation } from '@/renderer/components/workspace/workspace-state';
import { workspaceTabTitle } from '@/renderer/components/workspace/workspace-location';
import { useWorkspaceTabActivationTransition } from '@/renderer/components/workspace/useWorkspaceTabActivationTransition';
import {
  visibleWorkspaceTabs,
  workspaceTabFocusTarget,
  type WorkspaceTabStripProps,
} from '@/renderer/components/workspace/workspace-tab-strip';
import { shortcutEventAvailable } from '@/renderer/commands/app-shortcuts';
import { workspaceShortcutLayerOpen } from '@/renderer/commands/shortcut-context';
import { cn } from '@/renderer/lib/utils';

export function WorkspaceTabStrip(props: WorkspaceTabStripProps) {
  const { data, group, active, collapsed = false, onActivate, onClose } = props;
  const vertical = collapsed && props.splitAxis === 'columns';
  const ExpandIcon = vertical ? PanelLeftOpenIcon : PanelTopOpenIcon;
  const { labels, titleLabels } = useWorkspaceTabLabels();
  const tabListId = useId();
  const tabButtons = useRef(new Map<string, HTMLButtonElement>());
  const closeFrames = useRef(new Set<number>());
  const mounted = useRef(false);
  const [focusedTabId, setFocusedTabId] = useState(group.activeTabId);
  const visibleTabs = visibleWorkspaceTabs(group);
  const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
  const focusableId = visibleTabs.some((tab) => tab.id === focusedTabId) ? focusedTabId : activeTab.id;
  const { pendingTabId, requestActivation, clearPendingActivation } = useWorkspaceTabActivationTransition(
    group.activeTabId,
    onActivate,
  );
  const indexes = new Map(group.tabs.map((tab, index) => [tab.id, index]));

  useEffect(() => {
    setFocusedTabId(activeTab.id);
  }, [activeTab.id]);
  useEffect(() => {
    tabButtons.current.get(activeTab.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab.id, group.tabs, collapsed, vertical]);

  useEffect(() => {
    mounted.current = true;
    const frames = closeFrames.current;
    return () => {
      mounted.current = false;
      frames.forEach(cancelAnimationFrame);
      frames.clear();
    };
  }, []);
  function closeTab(tabId: string, focusNext = false) {
    clearPendingActivation(tabId);
    const index = visibleTabs.findIndex((tab) => tab.id === tabId);
    const nextId = visibleTabs[index + 1]?.id ?? visibleTabs[index - 1]?.id;
    onClose(
      tabId,
      focusNext
        ? () => {
            if (!mounted.current) return;
            const frame = requestAnimationFrame(() => {
              closeFrames.current.delete(frame);
              if (!mounted.current || workspaceShortcutLayerOpen()) return;
              if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
              const next = (nextId && tabButtons.current.get(nextId)) || [...tabButtons.current.values()][0];
              next?.focus({ preventScroll: true });
            });
            closeFrames.current.add(frame);
          }
        : undefined,
    );
  }
  function focusTab(event: KeyboardEvent<HTMLButtonElement>, tabId: string) {
    if (
      event.repeat ||
      !shortcutEventAvailable(event.nativeEvent) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (event.key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      closeTab(tabId, true);
      return;
    }
    const targetId = workspaceTabFocusTarget(visibleTabs, tabId, event.key, vertical ? 'vertical' : 'horizontal');
    if (!targetId) return;
    event.preventDefault();
    event.stopPropagation();
    tabButtons.current.get(targetId)?.focus();
  }
  const expandButton = collapsed && (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        'size-7 shrink-0 rounded-sm text-muted-foreground focus-visible:ring-inset focus-visible:ring-offset-0',
        !vertical && 'mr-1',
      )}
      aria-label={labels.expandTabs}
      title={labels.expandTabs}
      aria-expanded={false}
      aria-controls={`workspace-group-content-${group.id}`}
      onClick={() => {
        tabButtons.current.get(activeTab.id)?.focus({ preventScroll: true });
        requestActivation(activeTab.id);
      }}
    >
      <ExpandIcon className={cn('size-4', props.splitPosition === 'end' && 'rotate-180')} />
    </Button>
  );
  return (
    <TooltipProvider>
      <div
        data-workspace-group-rail={collapsed ? '' : undefined}
        className={cn(
          'flex min-h-0 min-w-0 shrink-0 items-center bg-muted/70',
          !collapsed && 'h-9 border-b',
          collapsed &&
            (vertical ? 'absolute inset-y-0 h-full w-8 flex-col border-x' : 'absolute inset-x-0 h-9 w-full border-y'),
          active && 'bg-muted',
        )}
        role="group"
        aria-label={labels.tabs}
      >
        {vertical && expandButton}
        <div
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedTabId(activeTab.id);
          }}
          id={tabListId}
          role="tablist"
          aria-label={labels.tabs}
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          className={cn(
            'flex min-h-0 min-w-0 flex-1 items-center gap-0.5 overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            vertical
              ? 'w-full flex-col overflow-x-hidden overflow-y-auto py-1'
              : 'h-full overflow-x-auto overflow-y-hidden px-1',
          )}
        >
          {visibleTabs.map((tab) => (
            <WorkspaceTabItem
              key={tab.id}
              id={tab.id}
              title={workspaceTabTitle(activeLocation(tab), data, titleLabels)}
              index={indexes.get(tab.id) ?? 0}
              count={group.tabs.length}
              selected={tab.id === activeTab.id}
              active={active}
              pending={tab.id === pendingTabId && tab.id !== activeTab.id}
              focusable={tab.id === focusableId}
              split={Boolean(props.splitAxis)}
              compact={collapsed ? (vertical ? 'vertical' : 'horizontal') : undefined}
              register={(node) => {
                if (node) tabButtons.current.set(tab.id, node);
                else tabButtons.current.delete(tab.id);
              }}
              onFocus={() => setFocusedTabId(tab.id)}
              onKeyDown={(event) => focusTab(event, tab.id)}
              onActivate={() => requestActivation(tab.id)}
              onClose={() => closeTab(tab.id)}
              onCloseOthers={() => props.onCloseOthers(tab.id)}
              onReorder={(delta) => props.onReorder(tab.id, delta)}
              onMove={() => props.onMoveToOtherGroup(tab.id)}
            />
          ))}
        </div>
        {!vertical && expandButton}
        {!collapsed && (
          <WorkspaceTabActions {...props} pendingTabId={pendingTabId} requestActivation={requestActivation} />
        )}
      </div>
    </TooltipProvider>
  );
}
