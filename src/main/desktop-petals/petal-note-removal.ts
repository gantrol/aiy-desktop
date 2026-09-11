import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import type { PetalDrawerService } from '@/main/desktop-petals/petal-drawer-service';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import type { PetalColor } from '@/shared/contracts/petal-appearance';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalError } from '@/shared/petal-errors';

interface RemovalDependencies {
  windows: PetalWindows;
  flushNote(entry: PetalWindow): Promise<boolean>;
  removeNote(id: string): void;
  changed(): void;
}

export interface PetalNoteCleanupDependencies extends RemovalDependencies {
  notes: PetalNoteService;
  drawer: PetalDrawerService;
  restoration: Promise<void> | null;
  suspend(): void;
  resume(): void;
}

export async function cleanupPetalNotes(
  deps: PetalNoteCleanupDependencies,
  context: ActiveLibraryContext,
  color: PetalColor,
) {
  deps.suspend();
  deps.changed();
  try {
    await deps.drawer.settle();
    await deps.restoration?.catch(() => undefined);
    const ids = new Set([...context.database.listDesktopNoteIds(color), ...deps.notes.pendingIds(color)]);
    // Save only the selected notes; a failed save leaves the entire selection on the desktop.
    for (const entry of [...deps.windows.entries.values()]) {
      if (entry.libraryId !== context.library.id || !entry.instanceId || !ids.has(entry.instanceId)) continue;
      if (!(await deps.flushNote(entry))) throw petalError('unsaved');
    }
    const removed = context.database.removeDesktopNotesByColor(color);
    for (const id of [...removed, ...deps.notes.pendingIds(color)]) deps.removeNote(id);
    await deps.windows.flush();
  } finally {
    deps.resume();
  }
}

export async function removePetalPlacement(
  deps: RemovalDependencies & { board: PetalBoardService },
  context: ActiveLibraryContext,
  entry?: PetalWindow,
) {
  if (!entry?.instanceId) throw petalError('sourceUnavailable');
  try {
    if (!(await deps.flushNote(entry))) throw petalError('unsaved');
    if (isContentPinId(entry.instanceId)) await deps.board.run({ kind: 'unpin', id: entry.instanceId });
    else {
      context.database.removeDesktopNote(entry.instanceId);
      deps.removeNote(entry.instanceId);
      await deps.windows.flush();
      deps.changed();
    }
  } finally {
    if (!entry.window.isDestroyed()) {
      entry.editEpoch++;
      entry.window.webContents.send('desktop-petals:changed');
    }
  }
}
