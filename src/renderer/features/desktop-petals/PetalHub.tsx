import { useCallback, useRef, useState } from 'react';
import { Layers, Pin, Plus, Images, MoreHorizontal, Eye, EyeOff, Undo2 } from 'lucide-react';
import { PetalList } from '@/renderer/features/desktop-petals/PetalList';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/renderer/components/ui/dropdown-menu';
import { Button } from '@/renderer/components/ui/button';
import { PetalPanel, PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { PetalLayers } from '@/renderer/features/desktop-petals/PetalLayers';
import { PinSourcePicker } from '@/renderer/features/desktop-petals/PinSourcePicker';
import { RoseFlower } from '@/renderer/features/desktop-petals/RoseFlower';
import { DockedPetal } from '@/renderer/features/desktop-petals/DockedPetal';
import { PetalContextMenu } from '@/renderer/features/desktop-petals/PetalContextMenu';
import { PetalCleanupMenu } from '@/renderer/features/desktop-petals/PetalCleanupMenu';
import { PetalMenuContent } from '@/renderer/features/desktop-petals/PetalMenu';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { PetalHubSettingsPanel } from '@/renderer/features/desktop-petals/PetalHubSettings';
import { FlowerCenter, flowerCenterProgress } from '@/renderer/features/desktop-petals/FlowerCenter';
import { usePetalHubData } from '@/renderer/features/desktop-petals/use-petal-hub-data';
import { usePetalDock } from '@/renderer/features/desktop-petals/use-petal-dock';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import { petalTimerRemaining } from '@/shared/petal-timer';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalBoardCommand } from '@/shared/contracts/petal-board';
import type { PetalHubView } from '@/shared/contracts/petal-hub';
export function PetalHub({ snapshot }: { snapshot: DesktopPetalSnapshot }) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals,
    { now, quota } = usePetalHubData(snapshot);
  const [error, setError] = useState(''),
    pendingCreate = useRef<string | null>(null);
  const onError = useCallback((reason: unknown) => setError(String(reason)), []);
  const dock = usePetalDock(snapshot, onError);
  const petalBounds = dock.petalBounds;
  const view = (next: PetalHubView) => void window.desktopPetals.hubView(next).catch(onError);
  const create = async (point?: { x: number; y: number }) => {
    pendingCreate.current ??= crypto.randomUUID();
    try {
      await window.desktopPetals.create({
        requestId: pendingCreate.current,
        point,
        expanded: true,
      });
      pendingCreate.current = null;
      setError('');
      return true;
    } catch (reason) {
      onError(reason);
      return false;
    }
  };
  const boardCommand = async (command: PetalBoardCommand) => {
    try {
      await window.desktopPetals.boardCommand(command);
      setError('');
    } catch (reason) {
      onError(reason);
      throw reason;
    }
  };
  const runBoard = (command: PetalBoardCommand) => void boardCommand(command).catch(() => undefined);
  const centerClick =
    snapshot.hubSettings.mode === 'pomodoro'
      ? () =>
          void window.desktopPetals
            .timerAction(
              petalTimerRemaining(snapshot.timer, Date.now()) === 0
                ? 'next'
                : snapshot.timer.endsAt === null
                  ? 'start'
                  : 'pause',
            )
            .catch(onError)
      : undefined;
  const board = snapshot.board;
  const undo = snapshot.collectionUndo;
  return (
    <PetalContextMenu snapshot={snapshot} onError={onError}>
      <section
        className="relative size-full overflow-clip select-none"
        aria-label={copy.flower.label.replace('{library}', snapshot.libraryName)}
        onPointerDownCapture={dock.beginGesture}
        onPointerEnter={dock.cancel}
        onPointerLeave={(event) => {
          dock.cancel();
          if (!event.buttons) dock.scheduleCollapse();
        }}
      >
        {snapshot.dock?.collapsed ? (
          <div
            className="absolute"
            style={
              petalBounds
                ? {
                    left: petalBounds.x,
                    top: petalBounds.y,
                    width: petalBounds.width,
                    height: petalBounds.height,
                  }
                : { inset: 0 }
            }
          >
            <DockedPetal
              label={copy.dock.reveal}
              onPointerEnter={(event) => {
                if (!event.buttons) dock.scheduleReveal();
              }}
              onClick={() => void dock.reveal()}
            />
          </div>
        ) : snapshot.hubView === 'settings' ? (
          <PetalHubSettingsPanel snapshot={snapshot} now={now} />
        ) : snapshot.hubView === 'layers' ? (
          <PetalLayers board={board} onBack={() => view('notes')} onCommand={boardCommand} />
        ) : snapshot.hubView === 'sources' ? (
          <PinSourcePicker onBack={() => view('notes')} onError={onError} />
        ) : snapshot.hubView === 'notes' ? (
          <PetalPanel
            title={snapshot.hubSettings.title || copy.actions.myPetals}
            onBack={() => view('flower')}
            actions={
              <>
                <PetalIconButton label={copy.flower.newNote} onClick={() => void create()}>
                  <Plus />
                </PetalIconButton>
                <PetalIconButton
                  label={copy.actions.gallery}
                  onClick={() => void window.desktopPetals.codex.command({ kind: 'open-album' }).catch(onError)}
                >
                  <Images />
                </PetalIconButton>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <PetalIconButton label={copy.actions.more}>
                      <MoreHorizontal />
                    </PetalIconButton>
                  </DropdownMenuTrigger>
                  <PetalMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => view('sources')}>
                      <Pin />
                      {copy.board.pin}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => view('layers')}>
                      <Layers />
                      {copy.board.manage}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void window.desktopPetals.showAll().catch(onError)}>
                      <Eye />
                      {copy.actions.showAll}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void window.desktopPetals.hideAll().catch(onError)}>
                      <EyeOff />
                      {copy.menu.hide}
                    </DropdownMenuItem>
                    <PetalCleanupMenu disabled={snapshot.suspended} onError={onError} />
                  </PetalMenuContent>
                </DropdownMenu>
              </>
            }
          >
            <PetalList snapshot={snapshot} onError={onError} />
          </PetalPanel>
        ) : (
          <div
            className="fixed"
            style={{
              left: dock.anchor.x - snapshot.hubSettings.flowerSize / 2,
              top: dock.anchor.y - snapshot.hubSettings.flowerSize / 2,
            }}
          >
            <RoseFlower
              fold={dock.fold}
              dock={
                snapshot.dock && petalBounds
                  ? {
                      x: petalBounds.x + petalBounds.width / 2 - dock.anchor.x,
                      y: petalBounds.y + petalBounds.height / 2 - dock.anchor.y,
                    }
                  : undefined
              }
              size={snapshot.hubSettings.flowerSize}
              onPluck={create}
              onPreview={dock.setPluckPreview}
              onCenterClick={
                undo ? () => void window.desktopPetals.undoCollection(undo.token).catch(onError) : centerClick
              }
              centerLabel={undo ? copy.actions.undoCollection : undefined}
              onError={onError}
              center={
                undo ? (
                  <Undo2 className="size-5" />
                ) : (
                  <FlowerCenter settings={snapshot.hubSettings} timer={snapshot.timer} quota={quota} now={now} />
                )
              }
              progress={flowerCenterProgress(snapshot.hubSettings, snapshot.timer, quota, now)}
            />
            {snapshot.hubSettings.title && (
              <span
                className="pointer-events-none absolute inset-x-0 -bottom-5 truncate text-center text-xs"
                style={{ opacity: Math.max(0, 1 - dock.fold * 5) }}
              >
                {snapshot.hubSettings.title}
              </span>
            )}
            {board.layers.length > 1 &&
              board.layers.map((layer, index) => {
                const angle = ((-90 + (index * 360) / board.layers.length) * Math.PI) / 180,
                  radius = snapshot.hubSettings.flowerSize / 2 + 10;
                const selected = board.activeLayerId === layer.id,
                  hidden = board.hiddenLayerIds.includes(layer.id);
                return (
                  <Button
                    disabled={dock.fold > 0}
                    key={layer.id}
                    variant="ghost"
                    className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full p-1"
                    style={{
                      opacity: Math.max(0, 1 - dock.fold * 5),
                      ...appearanceStyle(layer.color),
                      left: snapshot.hubSettings.flowerSize / 2 + Math.cos(angle) * radius,
                      top: snapshot.hubSettings.flowerSize / 2 + Math.sin(angle) * radius,
                    }}
                    title={layer.name || copy.board.defaultLayer}
                    aria-label={layer.name || copy.board.defaultLayer}
                    aria-pressed={!hidden}
                    onClick={() =>
                      runBoard({ kind: selected && !hidden ? 'toggle-layer' : 'select-layer', id: layer.id })
                    }
                  >
                    <span
                      className={`size-2 rounded-full border border-[var(--petal-edge)] ${hidden ? 'bg-transparent' : 'bg-[var(--petal-edge)]'} ${selected ? 'outline outline-1 outline-offset-2 outline-[var(--petal-edge)]' : ''}`}
                    />
                  </Button>
                );
              })}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="absolute inset-x-2 bottom-1 max-h-12 overflow-y-auto bg-background px-2 py-1 text-xs text-destructive"
          >
            {petalErrorText(error, copy.errors)}
          </div>
        )}
      </section>
    </PetalContextMenu>
  );
}
