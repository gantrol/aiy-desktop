import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefCallback, type RefObject } from 'react';
import { CheckIcon, ChevronDownIcon, EllipsisIcon, PinOffIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Separator } from '@/renderer/components/ui/separator';
import { ItemActions, itemActionButtonClassName } from '@/renderer/components/ui/item-actions';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ContextMenu, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import {
  WorkspaceTabContextMenu,
  WorkspaceTabIcon,
  type WorkspaceTabItemProps,
} from '@/renderer/components/workspace/WorkspaceTabItem';
import { usePinnedTabPopover } from '@/renderer/components/workspace/usePinnedTabPopover';
import { workspaceTabFocusTarget } from '@/renderer/components/workspace/workspace-tab-strip';
import { workspacePinnedTabClassName } from '@/renderer/components/workspace/workspace-pinned-tab-styles';
import { commandShortcutText, shortcutEventAvailable } from '@/renderer/commands/app-shortcuts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  tabs: WorkspaceTabItemProps[];
  visibleCount: number;
  activeTabId: string;
  compact: boolean;
  vertical: boolean;
  side: 'left' | 'right' | 'bottom';
  focusable: boolean;
  register: RefCallback<HTMLButtonElement>;
  onFocus(): void;
  onRestoreFocus(tabId?: string): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  children: ReactNode;
  dragListRef?: RefObject<HTMLDivElement | null>;
  dragOpen?: boolean;
  dragging?: boolean;
  dragId?: string;
}

export function WorkspacePinnedTabs(props: Props) {
  const { messages } = useI18n();
  const labels = messages.app.workspace;
  const { tabs, visibleCount, activeTabId, compact, vertical } = props;
  const hidden = tabs.slice(visibleCount);
  const hiddenActive = hidden.find((tab) => tab.selected);
  const popup = usePinnedTabPopover(hidden.length > 0, activeTabId, `${vertical}:${compact}`);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const focusedRow = useRef<{ id: string; index: number } | null>(null);

  useLayoutEffect(() => {
    const previous = focusedRow.current;
    if (!popup.open || !previous || rows.current.has(previous.id) || document.activeElement !== document.body) return;
    const next = tabs[Math.min(previous.index, tabs.length - 1)];
    if (next) rows.current.get(next.id)?.focus({ preventScroll: true });
  });

  function focusRow(event: KeyboardEvent<HTMLButtonElement>, tab: WorkspaceTabItemProps) {
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
      tab.onClose();
      return;
    }
    const id = workspaceTabFocusTarget(tabs, tab.id, event.key, 'vertical');
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    rows.current.get(id)?.focus();
  }

  return (
    <Popover
      open={popup.open || props.dragOpen}
      onOpenChange={(open) => {
        if (!props.dragging) popup.changeOpen(open);
      }}
    >
      <PopoverAnchor asChild>
        <div
          data-workspace-tab-zone="pinned"
          data-tab-axis={vertical ? 'vertical' : 'horizontal'}
          data-tab-hidden-first={hidden.find((tab) => tab.id !== props.dragId)?.id}
          className={cn(
            'flex shrink-0 gap-0.5 overflow-hidden',
            vertical ? 'w-full flex-col items-center pb-1' : 'h-full items-center',
          )}
        >
          {props.children}
          {hidden.map((tab) => (
            <span key={tab.id} id={`workspace-tab-${tab.id}`} hidden>
              {tab.title}
            </span>
          ))}
          {hidden.length > 0 && (
            <PopoverTrigger asChild>
              <Button
                ref={(node) => {
                  popup.trigger.current = node;
                  props.register(node);
                }}
                type="button"
                variant="ghost"
                size="icon-sm"
                tabIndex={props.focusable ? 0 : -1}
                aria-label={hiddenActive ? labels.morePinnedTabsCurrent(hiddenActive.title) : labels.morePinnedTabs}
                aria-current={hiddenActive ? 'page' : undefined}
                data-workspace-pinned-overflow=""
                aria-busy={hidden.some((tab) => tab.pending)}
                className={cn(
                  workspacePinnedTabClassName({
                    compact,
                    selected: Boolean(hiddenActive),
                    pending: hidden.some((tab) => tab.pending),
                  }),
                  'gap-0.5 focus-visible:ring-inset focus-visible:ring-offset-0',
                )}
                onFocus={props.onFocus}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse' && !event.buttons) popup.enter();
                }}
                onPointerLeave={() => {
                  if (!props.dragging) popup.leave();
                }}
                onPointerCancel={popup.intent.cancel}
                onClick={(event) => {
                  popup.intent.cancel();
                  if (popup.open && popup.hoverOnly.current) {
                    event.preventDefault();
                    popup.takeFocus();
                  } else popup.hoverOnly.current = false;
                }}
                onKeyDown={(event) => {
                  if (
                    event.repeat ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey ||
                    !shortcutEventAvailable(event.nativeEvent)
                  )
                    return;
                  props.onKeyDown(event);
                  if (event.defaultPrevented) return;
                  if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    popup.takeFocus();
                  }
                }}
              >
                {hiddenActive ? (
                  <>
                    <WorkspaceTabIcon icon={hiddenActive.icon} pinned pending={hiddenActive.pending} />
                    <ChevronDownIcon className="size-2" aria-hidden="true" />
                  </>
                ) : (
                  <EllipsisIcon className="size-4" aria-hidden="true" />
                )}
              </Button>
            </PopoverTrigger>
          )}
          <Separator
            orientation={vertical ? 'horizontal' : 'vertical'}
            className={
              vertical
                ? 'mt-0.5 data-[orientation=horizontal]:w-4'
                : 'ml-0.5 self-center data-[orientation=vertical]:h-4'
            }
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={(node) => {
          popup.content.current = node;
          if (props.dragListRef) props.dragListRef.current = node;
        }}
        data-workspace-tab-zone="list"
        data-tab-axis="vertical"
        aria-label={labels.morePinnedTabs}
        align="start"
        side={props.side}
        sideOffset={2}
        collisionPadding={8}
        className="max-h-[min(24rem,var(--radix-popover-content-available-height))] w-max min-w-[min(14rem,var(--radix-popover-content-available-width))] max-w-[min(16rem,var(--radix-popover-content-available-width))] overflow-y-auto rounded-sm p-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (props.dragging) return;
          if (!popup.hoverOnly.current) popup.focusCurrent();
          else
            popup.content.current
              ?.querySelector('[aria-current="page"]')
              ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (props.dragging) return;
          if (
            !popup.hoverOnly.current &&
            (document.activeElement === document.body || popup.content.current?.contains(document.activeElement))
          ) {
            if (popup.trigger.current) popup.trigger.current.focus({ preventScroll: true });
            else props.onRestoreFocus(focusedRow.current?.id);
          }
        }}
        onInteractOutside={(event) => {
          if (props.dragging) {
            event.preventDefault();
            return;
          }
          if (event.target instanceof Element && event.target.closest('[data-slot="context-menu-content"]'))
            event.preventDefault();
        }}
        onPointerEnter={popup.intent.cancel}
        onPointerLeave={() => {
          if (!props.dragging) popup.leave();
        }}
        onPointerCancel={popup.intent.cancel}
        onPointerDownCapture={() => {
          popup.intent.cancel();
          popup.hoverOnly.current = false;
        }}
        onKeyDownCapture={() => {
          popup.intent.cancel();
          popup.hoverOnly.current = false;
        }}
      >
        {tabs.map((tab, index) => (
          <PinnedTabRow
            key={tab.id}
            {...tab}
            register={(node) => {
              if (node) rows.current.set(tab.id, node);
              else rows.current.delete(tab.id);
            }}
            onFocus={() => {
              focusedRow.current = { id: tab.id, index };
            }}
            onKeyDown={(event) => focusRow(event, tab)}
            onActivate={() => {
              popup.changeOpen(false);
              tab.onActivate();
            }}
            onMenuOpenChange={(open) => {
              popup.intent.cancel();
              popup.contextMenuOpen.current = open;
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PinnedTabRow(props: WorkspaceTabItemProps & { onMenuOpenChange(open: boolean): void }) {
  const { messages } = useI18n();
  const labels = messages.app.workspace;
  const closeShortcut =
    props.selected && props.active ? commandShortcutText('workspace.close-tab', window.desktopApi.appPlatform) : '';
  return (
    <ContextMenu onOpenChange={props.onMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <div data-workspace-tab-item={props.id} className="group/item flex items-center rounded-sm pr-1 hover:bg-hover">
          <Button
            ref={props.register}
            type="button"
            variant="ghost"
            data-pinned-tab={props.id}
            data-workspace-tab-handle={props.id}
            aria-current={props.selected ? 'page' : undefined}
            aria-busy={props.pending}
            className={cn(
              'h-auto min-h-8 min-w-0 flex-1 shrink justify-start rounded-sm px-2 py-1.5 text-left font-normal hover:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0',
              props.selected && 'font-semibold',
            )}
            onFocus={props.onFocus}
            onKeyDown={props.onKeyDown}
            onClick={props.onActivate}
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
            <WorkspaceTabIcon icon={props.icon} pinned pending={props.pending} />
            <span data-workspace-tab-title="" className="min-w-0 flex-1 whitespace-normal break-words">
              {props.title}
            </span>
            <span className="sr-only">{labels.pinnedTab}</span>
            <CheckIcon className={cn('size-3.5', !props.selected && 'invisible')} aria-hidden="true" />
          </Button>
          <ItemActions>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={itemActionButtonClassName}
              aria-label={labels.unpinNamedTab(props.title)}
              title={labels.unpinTab}
              onFocus={props.onFocus}
              onKeyDown={props.onKeyDown}
              onClick={() => props.onPinnedChange(false)}
            >
              <PinOffIcon className="size-3.5" aria-hidden="true" />
            </Button>
          </ItemActions>
        </div>
      </ContextMenuTrigger>
      <WorkspaceTabContextMenu {...props} vertical={props.compact === 'vertical'} closeShortcut={closeShortcut} />
    </ContextMenu>
  );
}
