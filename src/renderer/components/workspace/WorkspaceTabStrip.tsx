import { ArrowLeftIcon, ArrowRightIcon, EllipsisIcon, LoaderCircleIcon, PlusIcon, XIcon } from 'lucide-react';
import type { BootstrapDto } from '@/shared/contracts';
import type { AppView } from '@/renderer/components/app/AppSidebar';
import { Button } from '@/renderer/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { activeLocation, type WorkspaceRuntimeGroup } from '@/renderer/components/workspace/workspace-state';
import { workspaceLocationCanSplit, workspaceTabTitle } from '@/renderer/components/workspace/workspace-location';
import { useWorkspaceTabActivationTransition } from '@/renderer/components/workspace/useWorkspaceTabActivationTransition';

interface Props {
  data: BootstrapDto;
  group: WorkspaceRuntimeGroup;
  active: boolean;
  onActivate(tabId: string): void;
  onClose(tabId: string): void;
  onCloseOthers(tabId: string): void;
  onReorder(tabId: string, delta: -1 | 1): void;
  onNewTab(view: AppView): void;
  onOpenBeside(view: AppView): void;
  splitAxis: 'columns' | 'rows' | null;
  onMerge(): void;
  onMoveToOtherGroup(tabId: string): void;
  onSplit(axis: 'columns' | 'rows'): void;
  onReset(): void;
}

export function WorkspaceTabStrip({
  data,
  group,
  active,
  onActivate,
  onClose,
  onCloseOthers,
  onReorder,
  onNewTab,
  onOpenBeside,
  splitAxis,
  onMerge,
  onMoveToOtherGroup,
  onSplit,
  onReset,
}: Props) {
  const { messages } = useI18n();
  const { pendingTabId, requestActivation, clearPendingActivation } = useWorkspaceTabActivationTransition(
    group.activeTabId,
    onActivate,
  );
  const labels = messages.app.workspace;
  const navigation = messages.app.navigation;
  const viewLabels = {
    creator: navigation.creator,
    documents: navigation.documents,
    dictionary: navigation.dictionary,
    gallery: navigation.gallery,
    companion: navigation.companion,
    codexImages: navigation.codexImages,
    transitionShowcase: navigation.transitionShowcase,
    packs: navigation.packs,
    aiCenter: navigation.aiCenter,
    contentManagement: navigation.settings,
    settings: navigation.settings,
  };
  const titleLabels = {
    views: viewLabels,
    newCreation: messages.creator.results.newCreation,
    creationKinds: messages.contentManagement.subtypes,
  };
  const availableViews = ['creator', 'dictionary', 'gallery', 'companion', 'packs', 'aiCenter'] as const;
  const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
  const canSplit = workspaceLocationCanSplit(activeLocation(activeTab));

  function closeTab(tabId: string) {
    clearPendingActivation(tabId);
    onClose(tabId);
  }

  return (
    <TooltipProvider>
      <div
        className={cn('flex h-9 min-w-0 shrink-0 items-center border-b bg-muted/70', active && 'bg-muted')}
        role="tablist"
        aria-label={labels.tabs}
      >
        <div className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {group.tabs.map((tab, index) => {
            const current = tab.id === group.activeTabId;
            const pending = tab.id === pendingTabId && !current;
            const title = workspaceTabTitle(activeLocation(tab), data, titleLabels);
            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'group/tab flex h-7 min-w-28 max-w-56 shrink items-center rounded-sm text-muted-foreground transition-colors duration-fast',
                      current && active && 'bg-surface text-foreground ring-1 ring-inset ring-border',
                      current && !active && 'bg-surface/60 text-foreground-secondary',
                      pending && 'bg-hover text-foreground-secondary',
                      !current && 'hover:bg-hover hover:text-foreground-secondary',
                    )}
                    role="presentation"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={current}
                      aria-busy={pending}
                      title={title}
                      className="h-full min-w-0 flex-1 truncate rounded-sm px-3 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => requestActivation(tab.id)}
                    >
                      {title}
                    </button>
                    {pending ? (
                      <span className="mr-0.5 flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                        <LoaderCircleIcon
                          className="size-3.5 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          'mr-0.5 size-6 shrink-0 rounded-sm text-muted-foreground transition-opacity duration-fast hover:text-foreground',
                          current ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100 focus:opacity-100',
                        )}
                        aria-label={labels.closeTab}
                        onClick={() => closeTab(tab.id)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => closeTab(tab.id)}>{labels.closeTab}</ContextMenuItem>
                  <ContextMenuItem disabled={group.tabs.length === 1} onSelect={() => onCloseOthers(tab.id)}>
                    {labels.closeOthers}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={index === 0} onSelect={() => onReorder(tab.id, -1)}>
                    <ArrowLeftIcon />
                    {labels.moveLeft}
                  </ContextMenuItem>
                  <ContextMenuItem disabled={index === group.tabs.length - 1} onSelect={() => onReorder(tab.id, 1)}>
                    <ArrowRightIcon />
                    {labels.moveRight}
                  </ContextMenuItem>
                  {splitAxis && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => onMoveToOtherGroup(tab.id)}>
                        {labels.moveToOtherGroup}
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
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
                <DropdownMenuItem key={view} onSelect={() => onNewTab(view)}>
                  {navigation[view]}
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
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{labels.openToSide}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {availableViews.map((view) => (
                    <DropdownMenuItem key={view} onSelect={() => onOpenBeside(view)}>
                      {navigation[view]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                disabled={splitAxis === 'columns' || (!splitAxis && !canSplit)}
                onSelect={() => onSplit('columns')}
              >
                {splitAxis ? labels.arrangeColumns : labels.splitColumns}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={splitAxis === 'rows' || (!splitAxis && !canSplit)}
                onSelect={() => onSplit('rows')}
              >
                {splitAxis ? labels.arrangeRows : labels.splitRows}
              </DropdownMenuItem>
              {splitAxis && <DropdownMenuItem onSelect={onMerge}>{labels.mergeGroups}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={onReset}>{labels.resetLayout}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}
