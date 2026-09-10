import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalDrawerFrame, PetalDrawerItem, PetalDrawerState } from '@/shared/contracts/petal-drawer';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/renderer/components/ui/dropdown-menu';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  EyeOff,
  List,
  Monitor,
  Move,
  Palette,
  Plus,
  Undo2,
  X,
  ExternalLink,
  Layers,
  Pencil,
} from 'lucide-react';
import { noteAppearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { NoteAppearancePicker } from '@/renderer/features/desktop-petals/NoteAppearancePicker';
import { PetalMenuContent, PetalMenuSection } from '@/renderer/features/desktop-petals/PetalMenu';
export type DrawerMenuPosition = { x: number; y: number; id?: string } | null;
interface Props {
  state: PetalDrawerState;
  snapshot: DesktopPetalSnapshot;
  frame: PetalDrawerFrame;
  menu: DrawerMenuPosition;
  run(action: () => Promise<unknown>, dismiss?: boolean): Promise<void>;
  onRestoreFocus(): void;
  onRename(): void;
}
export function PetalDrawerMenu({ state, snapshot, frame, menu, run, onRestoreFocus, onRename }: Props) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals,
    drawer = copy.drawer;
  const action = (fn: () => Promise<unknown>) => (event: Event) => {
    event.preventDefault();
    void run(fn);
  };
  const menuItem = state.items.find((item) => item.id === menu?.id);
  const itemIndex = menuItem ? state.items.findIndex((item) => item.id === menuItem.id) : -1;
  const appearance = (item: PetalDrawerItem, patch: Parameters<typeof window.desktopPetals.appearance>[0]) =>
    isContentPinId(item.id)
      ? window.desktopPetals.boardCommand({ kind: 'pin-appearance', ...patch })
      : window.desktopPetals.appearance(patch);

  return (
    <>
      {' '}
      <DropdownMenuTrigger asChild>
        <Button
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none fixed size-px p-0 opacity-0"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <PetalMenuContent
        className="w-52"
        style={noteAppearanceStyle(menuItem?.color ?? 'rose')}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        {menuItem ? (
          <>
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.open(menuItem.id))}>
              <ExternalLink />
              {copy.actions.expand}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'take', id: menuItem.id }))}>
              <Archive />
              {drawer.take}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={itemIndex <= 0}
              onSelect={action(() =>
                window.desktopPetals.drawer({
                  kind: 'reorder',
                  id: menuItem.id,
                  beforeId: state.items[itemIndex - 1]?.id ?? null,
                }),
              )}
            >
              <ArrowUp />
              {drawer.previous}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={itemIndex >= state.items.length - 1}
              onSelect={action(() =>
                window.desktopPetals.drawer({
                  kind: 'reorder',
                  id: menuItem.id,
                  beforeId: state.items[itemIndex + 2]?.id ?? null,
                }),
              )}
            >
              <ArrowDown />
              {drawer.next}
            </DropdownMenuItem>
            <PetalMenuSection icon={Palette} label={copy.actions.appearance}>
              <NoteAppearancePicker
                note={menuItem}
                onChange={(patch) => void run(() => appearance(menuItem, { id: menuItem.id, ...patch }), false)}
              />
            </PetalMenuSection>
            {snapshot.board.layers.length > 1 && (
              <PetalMenuSection icon={Layers} label={copy.actions.moveLayer}>
                {snapshot.board.layers.map((layer) => (
                  <DropdownMenuItem
                    key={layer.id}
                    onSelect={action(() =>
                      window.desktopPetals.boardCommand({
                        kind: 'assign-layer',
                        id: menuItem.id,
                        layerId: layer.id,
                      }),
                    )}
                  >
                    <span className="truncate">{layer.name || copy.board.defaultLayer}</span>
                  </DropdownMenuItem>
                ))}
              </PetalMenuSection>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={action(() =>
                window.desktopPetals.drawer({ kind: 'visibility', id: menuItem.id, visible: false }),
              )}
            >
              <EyeOff />
              {copy.actions.hide}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'remove', id: menuItem.id }))}>
              <X />
              {copy.actions.remove}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={action(() =>
                window.desktopPetals.create({ requestId: crypto.randomUUID(), expanded: true, home: 'drawer' }),
              )}
            >
              <Plus />
              {copy.flower.newNote}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.hubView('notes'))}>
              <List />
              {copy.actions.myPetals}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'collect-layer' }))}>
              <Archive />
              {drawer.collect}
            </DropdownMenuItem>
            {state.canUndo && (
              <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'undo' }))}>
                <Undo2 />
                {drawer.undo}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'move-mode' }))}>
              <Move />
              {drawer.move}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onRename();
              }}
            >
              <Pencil />
              {drawer.rename}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'toggle-titles' }))}>
              <EyeOff />
              {snapshot.titlesVisible ? drawer.hideTitles : drawer.showTitles}
            </DropdownMenuItem>
            {state.screens.length > 1 && (
              <PetalMenuSection icon={Monitor} label={drawer.screen}>
                {state.screens.map((display) => (
                  <DropdownMenuItem
                    key={display.id}
                    onSelect={action(() => window.desktopPetals.drawer({ kind: 'move-screen', displayId: display.id }))}
                  >
                    <span className="truncate">{display.label}</span>
                  </DropdownMenuItem>
                ))}
              </PetalMenuSection>
            )}
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'toggle' }))}>
              {frame.progress >= 0.5 ? drawer.close : drawer.open}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={action(() => window.desktopPetals.drawer({ kind: 'hide' }))}>
              <EyeOff />
              {drawer.hide}
            </DropdownMenuItem>
          </>
        )}
      </PetalMenuContent>
    </>
  );
}
