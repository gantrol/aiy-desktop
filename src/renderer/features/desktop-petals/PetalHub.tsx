import { useCallback, useRef, useState } from 'react';
import { Layers, Pin, Plus, Images, MoreHorizontal, Eye, EyeOff, Undo2, SlidersHorizontal } from 'lucide-react';
import { PetalList } from '@/renderer/features/desktop-petals/PetalList';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/renderer/components/ui/dropdown-menu';
import { PetalPanel, PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { PetalLayers } from '@/renderer/features/desktop-petals/PetalLayers';
import { PinSourcePicker } from '@/renderer/features/desktop-petals/PinSourcePicker';
import { RoseFlower } from '@/renderer/features/desktop-petals/RoseFlower';
import { DockedPetal } from '@/renderer/features/desktop-petals/DockedPetal';
import { PetalContextMenu } from '@/renderer/features/desktop-petals/PetalContextMenu';
import { PetalCleanupMenu } from '@/renderer/features/desktop-petals/PetalCleanupMenu';
import { PetalMenuContent } from '@/renderer/features/desktop-petals/PetalMenu';
import { PetalFlowerLayers } from '@/renderer/features/desktop-petals/PetalFlowerLayers';
import { useFlowerViewport } from '@/renderer/features/desktop-petals/use-flower-viewport';
import { PetalHubSettingsPanel, type FlowerSettingsHandle } from '@/renderer/features/desktop-petals/PetalHubSettings';
import { FlowerCenter, flowerCenterProgress } from '@/renderer/features/desktop-petals/FlowerCenter';
import { usePetalHubData } from '@/renderer/features/desktop-petals/use-petal-hub-data';
import { usePetalDock } from '@/renderer/features/desktop-petals/use-petal-dock';
import { PetalSpaceLabel } from '@/renderer/features/desktop-petals/PetalSpaceLabel';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalBoardCommand } from '@/shared/contracts/petal-board';
import type { PetalHubView } from '@/shared/contracts/petal-hub';
import { screenMagnifierRunning } from '@/shared/contracts/screen-magnifier';
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
  const settingsOpen = snapshot.hubView === 'settings';
  const settingsControls = useRef<FlowerSettingsHandle>(null);
  const center = useRef<HTMLButtonElement>(null);
  const viewport = useFlowerViewport(snapshot);
  const magnifierRunning = screenMagnifierRunning(snapshot.magnifier);
  const centerClick = () => {
    setError('');
    if (!magnifierRunning) return settingsOpen ? settingsControls.current?.close() : view('settings');
    void window.desktopPetals.magnifier('stop').catch(onError);
  };
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
            <PetalSpaceLabel name={snapshot.libraryName} />
            <PetalList snapshot={snapshot} onError={onError} />
          </PetalPanel>
        ) : (
          <div
            className="fixed -translate-x-1/2 -translate-y-1/2"
            style={{
              left: viewport.x,
              top: viewport.y,
              width: snapshot.hubSettings.flowerSize,
              height: snapshot.hubSettings.flowerSize,
            }}
          >
            <RoseFlower
              centerRef={center}
              fold={dock.fold}
              pluckDisabled={settingsOpen}
              dock={
                snapshot.dock && petalBounds
                  ? {
                      x: petalBounds.x + petalBounds.width / 2 - window.innerWidth / 2,
                      y: petalBounds.y + petalBounds.height / 2 - window.innerHeight / 2,
                    }
                  : undefined
              }
              size={snapshot.hubSettings.flowerSize}
              onPluck={create}
              onPreview={dock.setPluckPreview}
              onCenterClick={centerClick}
              centerLabel={
                magnifierRunning
                  ? copy.magnifier.stop
                  : settingsOpen
                    ? copy.settings.petals.collapse
                    : copy.settings.title
              }
              onError={onError}
              center={
                <FlowerCenter
                  settings={snapshot.hubSettings}
                  timer={snapshot.timer}
                  quota={quota}
                  now={now}
                  magnifier={snapshot.magnifier}
                />
              }
              progress={
                magnifierRunning ? undefined : flowerCenterProgress(snapshot.hubSettings, snapshot.timer, quota, now)
              }
            />
            {magnifierRunning && !settingsOpen && (
              <PetalIconButton
                label={copy.settings.petals.adjust}
                className="absolute -bottom-2 right-0 bg-background/90"
                onClick={() => view('settings')}
              >
                <SlidersHorizontal />
              </PetalIconButton>
            )}
            {undo && (
              <PetalIconButton
                label={copy.actions.undoCollection}
                className="absolute -top-1 -right-1 rounded-full bg-background/90"
                disabled={dock.fold > 0}
                style={{ opacity: Math.max(0, 1 - dock.fold * 5) }}
                onClick={() => void window.desktopPetals.undoCollection(undo.token).catch(onError)}
              >
                <Undo2 />
              </PetalIconButton>
            )}
            {snapshot.hubSettings.title && (
              <span
                className="pointer-events-none absolute inset-x-0 -bottom-5 truncate text-center text-xs"
                style={{ opacity: Math.max(0, 1 - dock.fold * 5) }}
              >
                {snapshot.hubSettings.title}
              </span>
            )}
            <PetalFlowerLayers snapshot={snapshot} fold={dock.fold} onCommand={runBoard} />
          </div>
        )}
        {settingsOpen && (
          <PetalHubSettingsPanel
            ref={settingsControls}
            snapshot={snapshot}
            now={now}
            quota={quota}
            onClosed={() => {
              if (document.hasFocus()) center.current?.focus({ preventScroll: true });
            }}
          />
        )}
        {(error || snapshot.magnifier?.status === 'failed') && (
          <div
            role="alert"
            className="absolute inset-x-2 bottom-1 max-h-12 overflow-y-auto bg-background px-2 py-1 text-xs text-destructive"
          >
            {error ? petalErrorText(error, copy.errors) : copy.errors.magnifierFailed}
          </div>
        )}
      </section>
    </PetalContextMenu>
  );
}
