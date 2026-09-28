import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
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

interface Props {
  id: string;
  title: string;
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

export function WorkspaceTabItem(props: Props) {
  const { messages } = useI18n();
  const labels = messages.app.workspace;
  const { id, title, selected, active, pending, compact } = props;
  const vertical = compact === 'vertical';
  const platform = window.desktopApi.appPlatform;
  const closeShortcut = selected && active ? commandShortcutText('workspace.close-tab', platform) : '';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="presentation"
          className={cn(
            'group/tab flex h-7 min-w-28 max-w-56 shrink items-center rounded-sm text-muted-foreground transition-colors duration-fast hover:bg-background',
            selected && active && 'bg-surface text-foreground ring-1 ring-inset ring-border-strong hover:bg-surface',
            selected && !active && 'bg-surface/60 text-foreground-secondary hover:bg-surface/60',
            pending && 'bg-hover text-foreground-secondary',
            !selected && 'hover:text-foreground-secondary',
            compact === 'horizontal' && 'min-w-0 max-w-40 shrink-0',
            vertical && 'h-auto w-7 min-w-0 max-w-none shrink-0',
          )}
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
            title={title}
            className={cn(
              'h-full min-w-0 flex-1 shrink justify-start rounded-sm px-3 py-0 text-left text-xs font-medium text-inherit hover:bg-transparent active:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0',
              selected && 'font-semibold',
              compact === 'horizontal' && 'px-2',
              vertical && 'h-auto min-h-12 w-full flex-none justify-center px-1 py-2',
            )}
            onFocus={props.onFocus}
            onClick={props.onActivate}
            onKeyDown={props.onKeyDown}
          >
            <span className={cn('truncate', vertical && 'max-h-36 [writing-mode:vertical-rl]')}>{title}</span>
          </Button>
          {!compact &&
            (pending ? (
              <span className="mr-0.5 flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                tabIndex={selected ? 0 : -1}
                className={cn(
                  'mr-0.5 size-6 shrink-0 rounded-sm text-muted-foreground transition-opacity duration-fast hover:bg-hover-strong hover:text-foreground',
                  selected ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100',
                )}
                aria-label={`${labels.closeTab}: ${title}`}
                aria-keyshortcuts={
                  selected && active ? commandAriaShortcut('workspace.close-tab', platform) : undefined
                }
                title={[labels.closeTab, closeShortcut].filter(Boolean).join(' · ')}
                onClick={props.onClose}
              >
                <XIcon className="size-3.5" />
              </Button>
            ))}
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
