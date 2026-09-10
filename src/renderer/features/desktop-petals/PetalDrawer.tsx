import { useDrawerKeyboard } from '@/renderer/features/desktop-petals/use-drawer-keyboard';
import { PetalDrawerGrid } from '@/renderer/features/desktop-petals/PetalDrawerGrid';
import { PetalDrawerMenu } from '@/renderer/features/desktop-petals/PetalDrawerMenu';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { DropdownMenu } from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalDrawerFrame, PetalDrawerItem, PetalDrawerState } from '@/shared/contracts/petal-drawer';
import { petalErrorText } from '@/shared/petal-errors';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { PetalShape } from '@/renderer/features/desktop-petals/PetalShape';
import { useDrawerPull } from '@/renderer/features/desktop-petals/use-drawer-pull';
import { useDrawerScroll } from '@/renderer/features/desktop-petals/use-drawer-scroll';
import { useDrawerItems } from '@/renderer/features/desktop-petals/use-drawer-items';
import { PetalDrawerHandle } from '@/renderer/features/desktop-petals/PetalDrawerHandle';
import { PetalDrawerRename } from '@/renderer/features/desktop-petals/PetalDrawerRename';
import './PetalDrawer.css';

export function PetalDrawer({ state, snapshot }: { state: PetalDrawerState; snapshot: DesktopPetalSnapshot }) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals,
    drawer = copy.drawer;
  const [frame, setFrame] = useState(state.frame);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; id?: string } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const onError = useCallback((reason: unknown) => {
    setError(String(reason));
    if (frameRef.current.progress === 0)
      void window.desktopPetals.drawer({ kind: 'toggle', reduced: true }).catch(() => undefined);
  }, []);
  const acceptFrame = useCallback(
    (next: PetalDrawerFrame) => setFrame((previous) => (next.revision >= previous.revision ? next : previous)),
    [],
  );
  useEffect(() => acceptFrame(state.frame), [state.frame, acceptFrame]);
  useEffect(() => window.desktopPetals.onDrawerFrame(acceptFrame), [acceptFrame]);
  useEffect(() => {
    if (!frame.menu) {
      setMenu(null);
      setRenaming(false);
    }
  }, [frame.menu]);
  const viewport = useRef<HTMLDivElement | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const enabled = frame.progress === 1 && !frame.menu && !frame.moving && !snapshot.suspended;
  const scroll = useDrawerScroll(viewport, state.items, frame.columns, frame.rows, state.anchorId, enabled, onError);
  const open = (id: string) => {
    void window.desktopPetals.open(id).catch(onError);
  };
  const itemsDrag = useDrawerItems(viewport, state.items, frame, scroll.step, scroll.manualAt, open, onError, !enabled);
  const pull = useDrawerPull(
    frame,
    Boolean(menu) || renaming || snapshot.suspended || Boolean(itemsDrag.preview) || itemsDrag.busy,
    onError,
  );
  const closeMenu = async () => {
    setMenu(null);
    setRenaming(false);
    await window.desktopPetals.drawer({ kind: 'menu', open: false });
  };
  const showMenu = async (point: { x: number; y: number }, id?: string) => {
    if (itemsDrag.preview || itemsDrag.busy || snapshot.suspended) return;
    try {
      await window.desktopPetals.drawer({ kind: 'menu', open: true, point });
      setMenu({ x: Math.max(8, point.x - window.screenX), y: Math.max(8, point.y - window.screenY), id });
    } catch (reason) {
      onError(reason);
    }
  };
  const run = async (action: () => Promise<unknown>, dismiss = true) => {
    try {
      if (dismiss) await closeMenu();
      await action();
      setError('');
    } catch (reason) {
      onError(reason);
    }
  };
  const previewItem = itemsDrag.preview?.item;
  const hover = (active: boolean) =>
    void window.desktopPetals
      .drawer({ kind: 'hover', active, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
      .catch(onError);
  const { handle, keyboard } = useDrawerKeyboard({
    frame,
    state,
    menu: menu || renaming,
    enabled,
    focused,
    buttons,
    scroll,
    setFocused,
    onError,
    showMenu,
  });
  const contextMenu = (event: React.MouseEvent, item?: PetalDrawerItem) => {
    event.preventDefault();
    event.stopPropagation();
    void showMenu({ x: Math.round(event.screenX), y: Math.round(event.screenY) }, item?.id);
  };
  return (
    <DropdownMenu
      open={Boolean(menu)}
      onOpenChange={(value) => {
        if (!value) void closeMenu().catch(onError);
      }}
      modal={false}
    >
      <div
        className="relative size-full overflow-hidden select-none"
        style={appearanceStyle('rose')}
        onKeyDown={keyboard}
      >
        <section
          className="absolute"
          style={{ left: frame.canvasX, top: frame.canvasY, width: frame.bodyWidth, height: frame.bodyHeight }}
          aria-label={drawer.title}
          onPointerEnter={() => hover(true)}
          onPointerLeave={() => {
            if (!(document.activeElement instanceof Element && document.activeElement.matches(':focus-visible')))
              hover(false);
          }}
        >
          <div
            aria-hidden={frame.progress === 0}
            inert={!enabled}
            className="absolute overflow-hidden rounded-md border border-border/60 bg-background/95"
            style={{ left: frame.contentX, width: frame.contentWidth, height: frame.bodyHeight }}
            onContextMenu={contextMenu}
          >
            <PetalDrawerGrid
              state={state}
              frame={frame}
              focused={focused}
              enabled={enabled}
              viewport={viewport}
              buttons={buttons}
              scroll={scroll}
              itemsDrag={itemsDrag}
              setFocused={setFocused}
              contextMenu={contextMenu}
              onError={onError}
            />
            {error && (
              <div
                role="alert"
                className="absolute inset-x-1 bottom-1 flex items-center gap-1 rounded-sm bg-background p-1 text-[10px] text-destructive"
              >
                <span className="min-w-0 flex-1">{petalErrorText(error, copy.errors)}</span>
                <Button variant="ghost" size="icon-sm" aria-label={copy.note.collapse} onClick={() => setError('')}>
                  <X className="size-3" />
                </Button>
              </div>
            )}
          </div>
          <PetalDrawerHandle
            name={state.name}
            count={state.items.length}
            frame={frame}
            handle={handle}
            handlers={pull}
            onContextMenu={contextMenu}
          />
        </section>
        {previewItem && itemsDrag.preview && (
          <span
            className="pointer-events-none fixed h-[50px] w-10 opacity-85"
            style={{
              ...appearanceStyle(previewItem.color),
              left: itemsDrag.preview.point.x - frame.x - 20,
              top: itemsDrag.preview.point.y - frame.y - 25,
            }}
          >
            <PetalShape icon={previewItem.icon} compact />
          </span>
        )}
        <PetalDrawerMenu
          state={state}
          snapshot={snapshot}
          frame={frame}
          menu={menu}
          run={run}
          onRename={() => {
            setMenu(null);
            setRenaming(true);
          }}
          onRestoreFocus={() => {
            if (renaming) return;
            if (focused && frame.progress === 1) buttons.current.get(focused)?.focus();
            else handle.current?.focus();
          }}
        />
        {renaming && <PetalDrawerRename name={state.name || drawer.title} close={closeMenu} onError={onError} />}
      </div>
    </DropdownMenu>
  );
}
