import {
  ArrowRightLeftIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  LoaderCircleIcon,
  PanelsTopLeftIcon,
  PinIcon,
  PinOffIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import type { KeyboardEvent, RefCallback } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { commandAriaShortcut, commandShortcutText } from '@/renderer/commands/app-shortcuts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { WorkspaceTabShape } from '@/renderer/components/workspace/WorkspaceTabShape';
import { workspacePinnedTabClassName } from '@/renderer/components/workspace/workspace-pinned-tab-styles';
import type { WorkspaceTabCloseScope, WorkspaceTabMove } from '@/renderer/components/workspace/workspace-state';

export interface WorkspaceTabItemProps {
  id: string;
  title: string;
  icon?: LucideIcon;
  pinned: boolean;
  canMoveBefore: boolean;
  canMoveAfter: boolean;
  canClose: Record<WorkspaceTabCloseScope, boolean>;
  selected: boolean;
  active: boolean;
  pending: boolean;
  focusable: boolean;
  split: boolean;
  canMoveToOtherGroup: boolean;
  compact?: 'horizontal' | 'vertical';
  register: RefCallback<HTMLButtonElement>;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onActivate(): void;
  onClose(): void;
  onCloseOthers(): void;
  onCloseTabs(scope: WorkspaceTabCloseScope): void;
  onPinnedChange(pinned: boolean): void;
  onReorder(move: WorkspaceTabMove): void;
  onMove(): void;
  moveTargets?: { id: string; title: string }[];
  onMoveBefore?(tabId: string): void;
  dragging?: boolean;
}

type Props = WorkspaceTabItemProps;

function tabContainerClassName({
  selected,
  pending,
  compact,
  pinned,
}: Pick<Props, 'selected' | 'pending' | 'compact' | 'pinned'>) {
  if (pinned) {
    return cn(
      'group/tab relative flex min-w-0 max-w-none items-center',
      workspacePinnedTabClassName({ compact: Boolean(compact), selected, pending }),
    );
  }
  return cn(
    'group/tab relative flex h-8 min-w-30 max-w-55 shrink items-center text-muted-foreground transition-colors duration-fast motion-reduce:transition-none',
    selected ? 'z-10 text-foreground' : 'rounded-t-sm hover:bg-hover hover:text-foreground-secondary',
    compact && 'rounded-sm border border-transparent',
    selected && compact && 'border-border border-b-background bg-background hover:bg-background',
    pending && 'bg-hover text-foreground-secondary',
    compact === 'horizontal' && 'h-7 min-w-0 max-w-40 shrink-0 rounded-sm',
    compact === 'vertical' && 'h-auto w-7 min-w-0 max-w-none shrink-0 rounded-sm',
  );
}

export function WorkspaceTabItem(props: Props) {
  const { messages } = useI18n();
  const labels = messages.app.workspace;
  const { id, title, selected, active, pending, compact, pinned } = props;
  const vertical = compact === 'vertical';
  const platform = window.desktopApi.appPlatform;
  const closeShortcut = selected && active ? commandShortcutText('workspace.close-tab', platform) : '';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="presentation"
          data-workspace-tab-item={id}
          className={tabContainerClassName(props)}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              props.onClose();
            }
          }}
        >
          {!compact && !pinned && <WorkspaceTabShape selected={selected} />}
          <Tooltip open={props.dragging ? false : undefined}>
            <TooltipTrigger asChild>
              <Button
                ref={props.register}
                type="button"
                variant="ghost"
                size="sm"
                role="tab"
                data-workspace-tab-handle={id}
                id={`workspace-tab-${id}`}
                tabIndex={props.focusable ? 0 : -1}
                aria-selected={selected}
                aria-controls={selected ? `workspace-panel-${id}` : undefined}
                aria-busy={pending}
                className={cn(
                  'relative z-10 h-full min-w-0 flex-1 shrink justify-start gap-2 rounded-sm px-3 py-0 text-left text-sm text-inherit hover:bg-transparent active:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0',
                  active ? (selected ? 'font-semibold' : 'font-medium') : 'font-normal',
                  !compact && (pinned ? 'scroll-mx-2' : 'scroll-ms-2 scroll-me-9'),
                  compact === 'horizontal' && 'px-2',
                  vertical && !pinned && 'h-auto min-h-12 w-full flex-none flex-col justify-center px-1 py-2',
                  pinned && 'justify-center px-0',
                )}
                onFocus={props.onFocus}
                onClick={props.onActivate}
                onKeyDown={props.onKeyDown}
              >
                {(!compact || pinned) && <WorkspaceTabIcon icon={props.icon} pinned={pinned} pending={pending} />}
                <span
                  data-workspace-tab-title=""
                  className={pinned ? 'sr-only' : cn('truncate', vertical && 'max-h-36 [writing-mode:vertical-rl]')}
                >
                  {title}
                </span>
                {pinned && <span className="sr-only">{labels.pinnedTab}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 break-words">{title}</TooltipContent>
          </Tooltip>
          {!compact && !pinned && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              tabIndex={selected ? 0 : -1}
              className={cn(
                'relative z-10 mr-0.5 size-6 shrink-0 rounded-sm text-muted-foreground transition-opacity duration-fast motion-reduce:transition-none hover:bg-hover-strong hover:text-foreground',
                selected
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 group-data-[state=open]/tab:pointer-events-auto group-data-[state=open]/tab:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
              )}
              aria-label={`${labels.closeTab}: ${title}`}
              aria-keyshortcuts={selected && active ? commandAriaShortcut('workspace.close-tab', platform) : undefined}
              title={[labels.closeTab, closeShortcut].filter(Boolean).join(' · ')}
              onClick={props.onClose}
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </ContextMenuTrigger>
      <WorkspaceTabContextMenu {...props} vertical={vertical} closeShortcut={closeShortcut} />
    </ContextMenu>
  );
}

export function WorkspaceTabIcon({ icon, pinned, pending }: Pick<Props, 'icon' | 'pinned' | 'pending'>) {
  const Icon = icon ?? (pinned ? PanelsTopLeftIcon : undefined);
  if (!pending && !Icon) return null;
  return (
    <span data-workspace-tab-icon="" className="inline-flex shrink-0">
      {pending ? (
        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      )}
    </span>
  );
}

export function WorkspaceTabContextMenu({
  vertical,
  closeShortcut,
  ...props
}: Props & { vertical: boolean; closeShortcut: string }) {
  const { messages } = useI18n();
  const labels = messages.app.workspace;
  return (
    <ContextMenuContent className="max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto">
      <ContextMenuItem onSelect={() => props.onPinnedChange(!props.pinned)}>
        {props.pinned ? <PinOffIcon /> : <PinIcon />}
        {props.pinned ? labels.unpinTab : labels.pinTab}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {Boolean(props.moveTargets?.length) && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>{labels.moveToPosition}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[var(--radix-context-menu-content-available-height)] max-w-80 overflow-y-auto">
            {props.moveTargets?.map((target) => (
              <ContextMenuItem key={target.id} onSelect={() => props.onMoveBefore?.(target.id)}>
                <span className="truncate">{labels.moveBeforeTab(target.title)}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuItem disabled={!props.canMoveBefore} onSelect={() => props.onReorder('start')}>
        <ChevronsLeftIcon className={cn(vertical && 'rotate-90')} />
        {labels.moveToStart}
      </ContextMenuItem>
      <ContextMenuItem disabled={!props.canMoveAfter} onSelect={() => props.onReorder('end')}>
        <ChevronsRightIcon className={cn(vertical && 'rotate-90')} />
        {labels.moveToEnd}
      </ContextMenuItem>
      {props.split && (
        <ContextMenuItem disabled={!props.canMoveToOtherGroup} onSelect={props.onMove}>
          <ArrowRightLeftIcon />
          {labels.moveToOtherGroup}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={props.onClose}>
        <XIcon />
        {labels.closeTab}
        {closeShortcut && <span className="ml-auto pl-4 text-xs text-muted-foreground">{closeShortcut}</span>}
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!props.canClose.others} onSelect={props.onCloseOthers}>
        {labels.closeOthers}
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!props.canClose.left} onSelect={() => props.onCloseTabs('left')}>
        {vertical ? labels.closeAbove : labels.closeLeft}
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!props.canClose.right} onSelect={() => props.onCloseTabs('right')}>
        {vertical ? labels.closeBelow : labels.closeRight}
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!props.canClose.all} onSelect={() => props.onCloseTabs('all')}>
        {labels.closeAll}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
