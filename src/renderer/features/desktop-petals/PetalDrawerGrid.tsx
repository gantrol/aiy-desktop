import type { RefObject, MouseEvent } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Plus } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { PetalDrawerFrame, PetalDrawerItem, PetalDrawerState } from '@/shared/contracts/petal-drawer';
import { PetalShape } from '@/renderer/features/desktop-petals/PetalShape';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { DRAWER_ROW, type useDrawerScroll } from '@/renderer/features/desktop-petals/use-drawer-scroll';
import type { useDrawerItems } from '@/renderer/features/desktop-petals/use-drawer-items';
import { PETAL_DRAWER, PETAL_DRAWER_COLUMN } from '@/shared/contracts/petal-drawer';
import { PetalCaption } from '@/renderer/features/desktop-petals/PetalCaption';
import { PetalPreview } from '@/renderer/features/desktop-petals/PetalPreview';
interface Props {
  state: PetalDrawerState;
  frame: PetalDrawerFrame;
  focused: string | null;
  enabled: boolean;
  viewport: RefObject<HTMLDivElement | null>;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  scroll: ReturnType<typeof useDrawerScroll>;
  itemsDrag: ReturnType<typeof useDrawerItems>;
  setFocused(id: string): void;
  contextMenu(event: MouseEvent, item?: PetalDrawerItem): void;
  onError(error: unknown): void;
}
export function PetalDrawerGrid({
  state,
  frame,
  focused,
  enabled,
  viewport,
  buttons,
  scroll,
  itemsDrag,
  setFocused,
  contextMenu,
  onError,
}: Props) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals,
    drawer = copy.drawer;
  const first = Math.max(0, Math.floor(scroll.top / DRAWER_ROW) - 1) * frame.columns;
  const last = Math.min(state.items.length, (Math.floor(scroll.top / DRAWER_ROW) + frame.rows + 2) * frame.columns);
  const visibleRows = Array.from(
    { length: Math.ceil((last - first) / frame.columns) },
    (_, offset) => first / frame.columns + offset,
  );
  const focusedIndex = state.items.findIndex((item) => item.id === focused);
  const focusedTop = PETAL_DRAWER.gridTop + Math.floor(focusedIndex / frame.columns) * DRAWER_ROW - scroll.top;
  const tabStop =
    focusedIndex >= 0 && focusedTop >= 0 && focusedTop + PETAL_DRAWER.cellHeight <= frame.bodyHeight - 2
      ? focused
      : state.items[Math.round(scroll.top / DRAWER_ROW) * frame.columns]?.id;
  const insertIndex =
    itemsDrag.beforeId === null ? state.items.length : state.items.findIndex((item) => item.id === itemsDrag.beforeId);
  const insertAtEnd = insertIndex === state.items.length && insertIndex > 0;
  const markerIndex = insertAtEnd ? insertIndex - 1 : insertIndex;
  const title = (item: PetalDrawerItem) =>
    item.title || (item.sourceKind === 'NOTE' ? copy.note.newTitle : copy.board[item.sourceKind]);

  return (
    <div
      ref={viewport}
      role="grid"
      aria-label={drawer.title}
      aria-rowcount={Math.ceil(state.items.length / frame.columns)}
      aria-colcount={frame.columns}
      className="petal-drawer-scroll h-full overflow-x-hidden overflow-y-auto overscroll-contain"
      onScroll={scroll.onScroll}
    >
      <div
        className="relative"
        style={{
          height: Math.max(
            frame.bodyHeight - 2,
            PETAL_DRAWER.gridTop * 2 - PETAL_DRAWER.gap + Math.ceil(state.items.length / frame.columns) * DRAWER_ROW,
          ),
        }}
      >
        {visibleRows.map((row) => {
          const top = PETAL_DRAWER.gridTop + row * DRAWER_ROW,
            complete = top - scroll.top >= 0 && top + PETAL_DRAWER.cellHeight - scroll.top <= frame.bodyHeight - 2;
          return (
            <div
              key={row}
              role="row"
              aria-rowindex={row + 1}
              aria-hidden={!complete}
              className="absolute inset-x-0"
              style={{ top, height: PETAL_DRAWER.cellHeight }}
            >
              {state.items.slice(row * frame.columns, (row + 1) * frame.columns).map((item, column) => (
                <PetalPreview
                  key={item.id}
                  id={item.id}
                  title={title(item)}
                  disabled={
                    !enabled || !complete || itemsDrag.busy || Boolean(itemsDrag.preview) || Boolean(frame.dropPoint)
                  }
                  onError={onError}
                >
                  <Button
                    ref={(node) => {
                      if (node) buttons.current.set(item.id, node);
                      else buttons.current.delete(item.id);
                    }}
                    type="button"
                    variant="ghost"
                    role="gridcell"
                    aria-colindex={column + 1}
                    aria-label={title(item)}
                    aria-hidden={!complete}
                    aria-selected={item.opened}
                    disabled={itemsDrag.busy}
                    tabIndex={complete && item.id === tabStop ? 0 : -1}
                    className="absolute flex-col gap-1 rounded-none bg-transparent p-0 shadow-none hover:bg-transparent active:bg-transparent focus-visible:ring-1 focus-visible:ring-[var(--petal-edge)] focus-visible:ring-offset-0"
                    style={{
                      ...appearanceStyle(item.color),
                      left: PETAL_DRAWER.padding + column * PETAL_DRAWER_COLUMN,
                      top: 0,
                      width: PETAL_DRAWER.cellWidth,
                      height: PETAL_DRAWER.cellHeight,
                      pointerEvents: complete ? undefined : 'none',
                      opacity: itemsDrag.preview?.id === item.id ? 0.3 : item.opened ? 0.65 : 1,
                    }}
                    onFocus={() => setFocused(item.id)}
                    onContextMenu={(event) => contextMenu(event, item)}
                    {...itemsDrag.handlers(item.id)}
                  >
                    <span className="pointer-events-none block h-[48px] w-10 shrink-0">
                      <PetalShape icon={item.icon} compact />
                    </span>
                    <PetalCaption title={title(item)} />
                  </Button>
                </PetalPreview>
              ))}
            </div>
          );
        })}
        {itemsDrag.beforeId !== undefined && markerIndex >= 0 && (
          <span
            className="pointer-events-none absolute w-0.5 bg-[var(--petal-edge)]"
            style={{
              left:
                PETAL_DRAWER.padding -
                2 +
                (markerIndex % frame.columns) * PETAL_DRAWER_COLUMN +
                (insertAtEnd ? PETAL_DRAWER.cellWidth + 2 : 0),
              top: PETAL_DRAWER.gridTop + Math.floor(markerIndex / frame.columns) * DRAWER_ROW,
              height: PETAL_DRAWER.cellHeight,
            }}
          />
        )}
        {!state.items.length && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copy.flower.newNote}
            title={copy.flower.newNote}
            className="absolute left-3 top-5"
            disabled={!enabled}
            onClick={() =>
              void window.desktopPetals
                .create({ requestId: crypto.randomUUID(), expanded: true, home: 'drawer' })
                .catch(onError)
            }
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
