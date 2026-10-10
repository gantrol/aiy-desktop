import { useId } from 'react';
import { PanelLeftOpenIcon, PanelTopOpenIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { WorkspaceTabActions } from '@/renderer/components/workspace/WorkspaceTabActions';
import { WorkspaceTabItem, type WorkspaceTabItemProps } from '@/renderer/components/workspace/WorkspaceTabItem';
import { WorkspacePinnedTabs } from '@/renderer/components/workspace/WorkspacePinnedTabs';
import { useWorkspaceTabLayout } from '@/renderer/components/workspace/useWorkspaceTabLayout';
import { useWorkspaceTabStripNavigation } from '@/renderer/components/workspace/useWorkspaceTabStripNavigation';
import { useWorkspaceTabLabels } from '@/renderer/components/workspace/useWorkspaceTabLabels';
import {
  activeLocation,
  workspaceTabsToClose,
  type WorkspaceRuntimeTab,
} from '@/renderer/components/workspace/workspace-state';
import { workspaceTabTitle } from '@/renderer/components/workspace/workspace-location';
import { useWorkspaceTabActivationTransition } from '@/renderer/components/workspace/useWorkspaceTabActivationTransition';
import { visibleWorkspaceTabs, type WorkspaceTabStripProps } from '@/renderer/components/workspace/workspace-tab-strip';
import { cn } from '@/renderer/lib/utils';
import { workspaceTabIcon } from '@/renderer/components/workspace/workspace-tab-icon';
import { useWorkspaceTabDrag } from '@/renderer/components/workspace/useWorkspaceTabDrag';
import {
  WorkspaceTabDragFeedback,
  WorkspaceTabPinDropTarget,
} from '@/renderer/components/workspace/WorkspaceTabDragFeedback';

export function WorkspaceTabStrip(props: WorkspaceTabStripProps) {
  const { data, group, active, collapsed = false, onActivate, onClose } = props;
  const vertical = collapsed && props.splitAxis === 'columns';
  const ExpandIcon = vertical ? PanelLeftOpenIcon : PanelTopOpenIcon;
  const { labels, titleLabels } = useWorkspaceTabLabels();
  const tabListId = useId();
  const visibleTabs = visibleWorkspaceTabs(group);
  const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
  const layout = useWorkspaceTabLayout(visibleTabs, vertical, collapsed);
  const drag = useWorkspaceTabDrag(
    group,
    `${data.spaceId}:${vertical}:${collapsed}:${layout.visiblePinned.length}`,
    props.onReorder,
  );
  const overflowId = `${tabListId}-pinned-overflow`;
  const hiddenActive = Boolean(activeTab.pinned && !layout.visiblePinned.some((tab) => tab.id === activeTab.id));
  const activeTargetId = hiddenActive ? overflowId : activeTab.id;
  const { pendingTabId, requestActivation, clearPendingActivation } = useWorkspaceTabActivationTransition(
    group.activeTabId,
    onActivate,
  );
  const navigation = useWorkspaceTabStripNavigation({
    targets: [...layout.visiblePinned, ...(layout.overflow ? [{ id: overflowId }] : []), ...layout.regular],
    activeTargetId,
    pinnedLayout: layout.visiblePinned.map((tab) => tab.id).join('|'),
    vertical,
    onClose,
    clearPendingActivation,
  });
  const indexes = new Map(group.tabs.map((tab, index) => [tab.id, index]));
  const pinnedCount = layout.pinned.length;

  function tabProps(tab: WorkspaceRuntimeTab): WorkspaceTabItemProps {
    return {
      id: tab.id,
      title: workspaceTabTitle(activeLocation(tab), data, titleLabels),
      icon: workspaceTabIcon(activeLocation(tab)),
      pinned: Boolean(tab.pinned),
      canMoveBefore: (indexes.get(tab.id) ?? 0) > (tab.pinned ? 0 : pinnedCount),
      canMoveAfter: (indexes.get(tab.id) ?? 0) < (tab.pinned ? pinnedCount - 1 : group.tabs.length - 1),
      canClose: {
        others: workspaceTabsToClose(group, tab.id, 'others').length > 0,
        left: workspaceTabsToClose(group, tab.id, 'left').length > 0,
        right: workspaceTabsToClose(group, tab.id, 'right').length > 0,
        all: workspaceTabsToClose(group, tab.id, 'all').length > 0,
      },
      selected: tab.id === activeTab.id,
      active,
      pending: tab.id === pendingTabId && tab.id !== activeTab.id,
      focusable: tab.id === navigation.focusableId,
      split: Boolean(props.splitAxis),
      canMoveToOtherGroup: props.canMoveToOtherGroup,
      compact: collapsed ? (vertical ? 'vertical' : 'horizontal') : undefined,
      register: (node) => navigation.register(tab.id, node),
      onFocus: () => navigation.onFocus(tab.id),
      onKeyDown: (event) => navigation.focusTab(event, tab.id),
      onActivate: () => requestActivation(tab.id),
      onClose: () => navigation.closeTab(tab.id),
      onCloseOthers: () => props.onCloseOthers(tab.id),
      onCloseTabs: (scope) => props.onCloseTabs(tab.id, scope, () => navigation.restoreCloseFocus()),
      onPinnedChange: (pinned) => {
        drag.prepareChange(undefined, tab.id);
        props.onPinnedChange(tab.id, pinned);
        navigation.restoreCloseFocus(tab.id);
      },
      onReorder: (move) => {
        drag.prepareChange();
        props.onReorder(tab.id, move);
      },
      onMove: () => props.onMoveToOtherGroup(tab.id),
      moveTargets: group.tabs
        .filter((candidate) => candidate.id !== tab.id && Boolean(candidate.pinned) === Boolean(tab.pinned))
        .map((candidate) => ({
          id: candidate.id,
          title: workspaceTabTitle(activeLocation(candidate), data, titleLabels),
        })),
      onMoveBefore: (beforeId) => {
        drag.prepareChange();
        props.onReorder(tab.id, { pinned: Boolean(tab.pinned), beforeId, orderKey: drag.orderKey });
      },
      dragging: drag.dragging,
    };
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
        navigation.buttons.current.get(activeTargetId)?.focus({ preventScroll: true });
        requestActivation(activeTab.id);
      }}
    >
      <ExpandIcon className={cn('size-4', props.splitPosition === 'end' && 'rotate-180')} />
    </Button>
  );
  return (
    <TooltipProvider>
      <div
        ref={drag.root}
        onPointerDownCapture={drag.onPointerDown}
        onDragStart={(event) => event.preventDefault()}
        data-workspace-group-rail={collapsed ? '' : undefined}
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 shrink-0 items-center bg-surface-sunken',
          !collapsed &&
            'h-9 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border',
          collapsed &&
            (vertical ? 'absolute inset-y-0 h-full w-8 flex-col border-x' : 'absolute inset-x-0 h-9 w-full border-y'),
        )}
        role="group"
        aria-label={labels.tabs}
      >
        {vertical && expandButton}
        <div
          ref={layout.viewport}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              navigation.setFocusedId(activeTargetId);
          }}
          id={tabListId}
          role="tablist"
          aria-label={labels.tabs}
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          className={cn(
            'flex min-h-0 min-w-0 flex-1',
            vertical ? 'h-full w-full flex-col items-center py-1' : 'h-full items-end',
            pinnedCount > 0 && !vertical && 'pl-1',
          )}
        >
          <WorkspaceTabPinDropTarget dragging={drag.moving} empty={pinnedCount === 0} vertical={vertical} />
          {pinnedCount > 0 && (
            <WorkspacePinnedTabs
              dragListRef={drag.list}
              dragOpen={drag.openPinned}
              dragging={drag.dragging}
              dragId={drag.activeId}
              tabs={layout.pinned.map(tabProps)}
              visibleCount={layout.visiblePinned.length}
              activeTabId={activeTab.id}
              compact={collapsed}
              vertical={vertical}
              side={vertical ? (props.splitPosition === 'end' ? 'left' : 'right') : 'bottom'}
              focusable={navigation.focusableId === overflowId}
              register={(node) => navigation.register(overflowId, node)}
              onFocus={() => navigation.onFocus(overflowId)}
              onRestoreFocus={navigation.restoreCloseFocus}
              onKeyDown={(event) => navigation.focusTab(event, overflowId, false)}
            >
              {layout.visiblePinned.map((tab) => (
                <WorkspaceTabItem key={tab.id} {...tabProps(tab)} />
              ))}
            </WorkspacePinnedTabs>
          )}
          <div
            data-workspace-tab-zone="regular"
            data-tab-axis={vertical ? 'vertical' : 'horizontal'}
            className={cn(
              'flex min-h-0 min-w-0 flex-1 gap-0.5 overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              vertical
                ? 'w-full flex-col items-center overflow-x-hidden overflow-y-auto'
                : 'h-full items-end overflow-x-auto overflow-y-hidden',
              !vertical && (collapsed ? 'px-1' : 'px-2'),
            )}
          >
            {layout.regular.map((tab) => (
              <WorkspaceTabItem key={tab.id} {...tabProps(tab)} />
            ))}
          </div>
        </div>
        {!vertical && expandButton}
        {!collapsed && (
          <WorkspaceTabActions {...props} pendingTabId={pendingTabId} requestActivation={requestActivation} />
        )}
        <WorkspaceTabDragFeedback drag={drag} group={group} data={data} />
      </div>
    </TooltipProvider>
  );
}
