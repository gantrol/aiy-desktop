import { PinIcon } from 'lucide-react';
import type { BootstrapDto } from '@/shared/contracts';
import type { useWorkspaceTabDrag } from '@/renderer/components/workspace/useWorkspaceTabDrag';
import { activeLocation, type WorkspaceRuntimeGroup } from '@/renderer/components/workspace/workspace-state';
import { workspaceTabTitle } from '@/renderer/components/workspace/workspace-location';
import { workspaceTabIcon } from '@/renderer/components/workspace/workspace-tab-icon';
import { WorkspaceTabDragLayer } from '@/renderer/components/workspace/WorkspaceTabDragLayer';
import { useWorkspaceTabLabels } from '@/renderer/components/workspace/useWorkspaceTabLabels';
import { cn } from '@/renderer/lib/utils';

export function WorkspaceTabPinDropTarget({
  dragging,
  empty,
  vertical,
}: {
  dragging: boolean;
  empty: boolean;
  vertical: boolean;
}) {
  const { labels } = useWorkspaceTabLabels();
  if (!dragging || !empty) return null;
  return (
    <div
      data-workspace-tab-zone="pinned"
      data-tab-axis={vertical ? 'vertical' : 'horizontal'}
      aria-label={labels.pinTab}
      className={cn(
        'flex shrink-0 items-center justify-center border-border text-muted-foreground',
        vertical ? 'h-8 w-7 border-b' : 'h-8 w-9 border-r',
      )}
    >
      <PinIcon className="size-3.5" aria-hidden="true" />
    </div>
  );
}

export function WorkspaceTabDragFeedback({
  drag,
  group,
  data,
}: {
  drag: ReturnType<typeof useWorkspaceTabDrag>;
  group: WorkspaceRuntimeGroup;
  data: BootstrapDto;
}) {
  const { labels, titleLabels } = useWorkspaceTabLabels();
  const source = group.tabs.find((tab) => tab.id === drag.view?.id);
  const moved = group.tabs.find((tab) => tab.id === drag.movedId);
  return (
    <>
      <span role="status" className="sr-only">
        {moved ? labels.tabMoved(workspaceTabTitle(activeLocation(moved), data, titleLabels)) : ''}
      </span>
      {drag.view && source && (
        <WorkspaceTabDragLayer
          view={drag.view}
          title={workspaceTabTitle(activeLocation(source), data, titleLabels)}
          icon={workspaceTabIcon(activeLocation(source))}
          ghost={drag.ghost}
          indicator={drag.indicator}
        />
      )}
    </>
  );
}
