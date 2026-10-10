import {
  CheckIcon,
  PanelLeftCloseIcon,
  PanelTopCloseIcon,
  EllipsisIcon,
  ListIcon,
  LoaderCircleIcon,
  PlusIcon,
  PinIcon,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { commandAriaShortcut, commandShortcutText } from '@/renderer/commands/app-shortcuts';
import { activeLocation } from '@/renderer/components/workspace/workspace-state';
import { workspaceLocationCanSplit, workspaceTabTitle } from '@/renderer/components/workspace/workspace-location';
import type { WorkspaceTabStripProps } from '@/renderer/components/workspace/workspace-tab-strip';
import { useWorkspaceTabLabels } from '@/renderer/components/workspace/useWorkspaceTabLabels';
import { cn } from '@/renderer/lib/utils';

type Props = Pick<
  WorkspaceTabStripProps,
  | 'group'
  | 'data'
  | 'splitAxis'
  | 'splitPosition'
  | 'onTabsCollapsedChange'
  | 'onNewTab'
  | 'onOpenBeside'
  | 'onMerge'
  | 'onSplit'
> & {
  pendingTabId: string | null;
  requestActivation(tabId: string): void;
};
const availableViews = [
  'creator',
  'dictionary',
  'gallery',
  'search',
  'calendar',
  'companion',
  'packs',
  'aiCenter',
] as const;

export function WorkspaceTabActions(props: Props) {
  const { data, group, splitAxis, pendingTabId, requestActivation } = props;
  const { labels, navigation, titleLabels } = useWorkspaceTabLabels();
  const platform = window.desktopApi.appPlatform;
  const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
  const canSplit = workspaceLocationCanSplit(activeLocation(activeTab));
  const CollapseIcon = splitAxis === 'rows' ? PanelTopCloseIcon : PanelLeftCloseIcon;
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-l border-border/60 px-1">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 rounded-sm text-muted-foreground"
                aria-label={`${labels.allTabs} (${group.tabs.length})`}
                aria-busy={Boolean(pendingTabId)}
              >
                {pendingTabId ? (
                  <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <ListIcon className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{labels.allTabs}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto"
        >
          <DropdownMenuLabel>{`${labels.allTabs} (${group.tabs.length})`}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {group.tabs.map((tab) => {
            const current = tab.id === activeTab.id;
            const title = workspaceTabTitle(activeLocation(tab), data, titleLabels);
            return (
              <DropdownMenuItem
                key={tab.id}
                textValue={title}
                title={title}
                aria-current={current ? 'page' : undefined}
                onSelect={() => requestActivation(tab.id)}
              >
                <CheckIcon className={cn('size-4 shrink-0', !current && 'invisible')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {tab.pinned && (
                  <>
                    <PinIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{labels.pinnedTab}</span>
                  </>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 rounded-sm text-muted-foreground"
                aria-label={labels.newTab}
              >
                <PlusIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{labels.newTab}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {availableViews.map((view) => (
            <DropdownMenuItem
              key={view}
              onSelect={() => props.onNewTab(view)}
              aria-keyshortcuts={view === 'creator' ? commandAriaShortcut('workspace.new-tab', platform) : undefined}
            >
              {navigation[view]}
              {view === 'creator' && (
                <span className="ml-auto pl-4 text-xs text-muted-foreground">
                  {commandShortcutText('workspace.new-tab', platform)}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 rounded-sm text-muted-foreground"
                aria-label={labels.layout}
              >
                <EllipsisIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{labels.layout}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {splitAxis && (
            <>
              <DropdownMenuItem onSelect={() => props.onTabsCollapsedChange(true)}>
                <CollapseIcon className={cn('size-4', props.splitPosition === 'end' && 'rotate-180')} />
                {labels.collapseTabs}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{labels.openToSide}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {availableViews.map((view) => (
                <DropdownMenuItem key={view} onSelect={() => props.onOpenBeside(view)}>
                  {navigation[view]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            disabled={splitAxis === 'columns' || (!splitAxis && !canSplit)}
            onSelect={() => props.onSplit('columns')}
          >
            {splitAxis ? labels.arrangeColumns : labels.splitColumns}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={splitAxis === 'rows' || (!splitAxis && !canSplit)}
            onSelect={() => props.onSplit('rows')}
          >
            {splitAxis ? labels.arrangeRows : labels.splitRows}
          </DropdownMenuItem>
          {splitAxis && <DropdownMenuItem onSelect={props.onMerge}>{labels.mergeGroups}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
