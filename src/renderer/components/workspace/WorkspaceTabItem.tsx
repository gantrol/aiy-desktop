import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  LoaderCircleIcon,
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
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { commandAriaShortcut, commandShortcutText } from '@/renderer/commands/app-shortcuts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { WorkspaceTabShape } from '@/renderer/components/workspace/WorkspaceTabShape';

interface Props {
  id: string;
  title: string;
  icon?: LucideIcon;
  index: number;
  count: number;
  selected: boolean;
  active: boolean;
  pending: boolean;
  focusable: boolean;
  split: boolean;
  compact?: 'horizontal' | 'vertical';
  register: RefCallback<HTMLButtonElement>;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onActivate(): void;
  onClose(): void;
  onCloseOthers(): void;
  onReorder(delta: -1 | 1): void;
  onMove(): void;
}

function tabContainerClassName({ selected, pending, compact }: Pick<Props, 'selected' | 'pending' | 'compact'>) {
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
  const { id, title, selected, active, pending, compact } = props;
  const vertical = compact === 'vertical';
  const Icon = props.icon;
  const platform = window.desktopApi.appPlatform;
  const closeShortcut = selected && active ? commandShortcutText('workspace.close-tab', platform) : '';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="presentation"
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
          {!compact && <WorkspaceTabShape selected={selected} />}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={props.register}
                type="button"
                variant="ghost"
                size="sm"
                role="tab"
                id={`workspace-tab-${id}`}
                tabIndex={props.focusable ? 0 : -1}
                aria-selected={selected}
                aria-controls={selected ? `workspace-panel-${id}` : undefined}
                aria-busy={pending}
                className={cn(
                  'relative z-10 h-full min-w-0 flex-1 shrink justify-start gap-2 rounded-sm px-3 py-0 text-left text-sm text-inherit hover:bg-transparent active:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0',
                  active ? (selected ? 'font-semibold' : 'font-medium') : 'font-normal',
                  !compact && 'scroll-ms-2 scroll-me-9',
                  compact === 'horizontal' && 'px-2',
                  vertical && 'h-auto min-h-12 w-full flex-none justify-center px-1 py-2',
                )}
                onFocus={props.onFocus}
                onClick={props.onActivate}
                onKeyDown={props.onKeyDown}
              >
                {!compact &&
                  (pending ? (
                    <LoaderCircleIcon
                      className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  ))}
                <span className={cn('truncate', vertical && 'max-h-36 [writing-mode:vertical-rl]')}>{title}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 break-words">{title}</TooltipContent>
          </Tooltip>
          {!compact && (
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
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onClose}>
          {labels.closeTab}
          {closeShortcut && <span className="ml-auto pl-4 text-xs text-muted-foreground">{closeShortcut}</span>}
        </ContextMenuItem>
        <ContextMenuItem disabled={props.count === 1} onSelect={props.onCloseOthers}>
          {labels.closeOthers}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={props.index === 0} onSelect={() => props.onReorder(-1)}>
          {vertical ? <ArrowUpIcon /> : <ArrowLeftIcon />}
          {vertical ? labels.moveUp : labels.moveLeft}
        </ContextMenuItem>
        <ContextMenuItem disabled={props.index === props.count - 1} onSelect={() => props.onReorder(1)}>
          {vertical ? <ArrowDownIcon /> : <ArrowRightIcon />}
          {vertical ? labels.moveDown : labels.moveRight}
        </ContextMenuItem>
        {props.split && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={props.onMove}>{labels.moveToOtherGroup}</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
