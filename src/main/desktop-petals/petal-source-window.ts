import { shell, type BrowserWindow } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import { openPetalImageSource } from '@/main/desktop-petals/petal-image-source';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalError } from '@/shared/petal-errors';

export function openPetalSourceWindow(
  context: ActiveLibraryContext,
  targetId: string | null | undefined,
  deps: {
    board: PetalBoardService;
    notes: PetalNoteService;
    main: BrowserWindow | null;
    publishSource(id: string): void;
  },
) {
  const pin = isContentPinId(targetId) ? deps.board.snapshot().pins.find((pin) => pin.id === targetId) : undefined;
  if (targetId && !pin) {
    if (isContentPinId(targetId) || deps.notes.isPending(targetId)) throw petalError('sourceUnavailable');
    deps.notes.get(targetId);
  }
  if (pin?.source.kind === 'IMAGE') return openPetalImageSource(context.database, pin.source.id, shell.openPath);
  const main = deps.main;
  if (!main || main.isDestroyed()) throw petalError('sourceUnavailable');
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  if (pin) main.webContents.send('desktop-petals:open-pin', { libraryId: context.library.id, source: pin.source });
  else if (targetId) deps.publishSource(targetId);
}
