import type { PetalWindows, PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalDrawerService } from '@/main/desktop-petals/petal-drawer-service';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalError } from '@/shared/petal-errors';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';

export function canRestorePetalVisibility(
  entry: PetalWindow,
  context: ActiveLibraryContext | null,
  suspended: boolean,
  notes: PetalNoteService | null,
  boardService: PetalBoardService | null,
) {
  if (suspended || context?.state !== 'ACTIVE' || context.library.id !== entry.libraryId) return false;
  if (!entry.instanceId) return true;
  const board = boardService?.snapshot();
  if (!board || board.hiddenLayerIds.includes(board.memberships[entry.instanceId] ?? 'default')) return false;
  if (isContentPinId(entry.instanceId)) return board.pins.some((pin) => pin.id === entry.instanceId);
  try {
    return !!notes?.get(entry.instanceId);
  } catch {
    return false;
  }
}

export async function openPetalNote(
  libraryId: string,
  id: string,
  windows: PetalWindows,
  notes: PetalNoteService,
  boardService: PetalBoardService,
  drawer: PetalDrawerService,
) {
  const board = boardService.snapshot();
  if (isContentPinId(id)) {
    if (!board.pins.some((pin) => pin.id === id)) throw petalError('sourceUnavailable');
  } else notes.get(id);
  if (board.hiddenLayerIds.includes(board.memberships[id] ?? 'default')) throw petalError('sourceUnavailable');
  const home = drawer.placement(id).home;
  await windows.show(libraryId, id, home === 'drawer' ? drawer.view.notePoint() : undefined, true, true);
  if (home === 'drawer') await drawer.view.animate(0);
}

export async function expandPetalNote(
  entry: PetalWindow,
  expanded: boolean,
  deps: {
    windows: PetalWindows;
    notes: PetalNoteService;
    drawer: PetalDrawerService;
    flush(): Promise<boolean>;
    remove(): void;
    changed(): void;
  },
) {
  if (!entry.instanceId) return;
  if (expanded || deps.drawer.placement(entry.instanceId).home !== 'drawer') {
    deps.windows.expand(entry, expanded);
    return;
  }
  try {
    if (!(await deps.flush())) throw petalError('unsaved');
    if (deps.notes.isPending(entry.instanceId)) deps.remove();
    else {
      deps.windows.remember(entry);
      entry.window.hide();
    }
  } finally {
    entry.editEpoch++;
    deps.changed();
  }
}
