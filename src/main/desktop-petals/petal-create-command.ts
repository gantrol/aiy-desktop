import { screen } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import { desktopNoteCreateSchema } from '@/shared/contracts/desktop-petals';
import { PETAL_DRAWER_ENABLED } from '@/shared/contracts/petal-drawer';
interface Dependencies {
  windows: PetalWindows;
  notes: PetalNoteService;
  board: PetalBoardService;
  changed(): void;
  publishSource(context: ActiveLibraryContext, id: string): void;
}
export async function createPetalNote(
  deps: Dependencies,
  input: unknown,
  context: ActiveLibraryContext,
  entry?: PetalWindow,
) {
  const database = context.database;
  const request = desktopNoteCreateSchema.parse(input);
  if (
    entry?.instanceId &&
    (!request.duplicate ||
      deps.notes.isPending(entry.instanceId) ||
      request.stashId !== deps.notes.get(entry.instanceId).stashId)
  )
    throw new Error('This window can only place another view of its own note');
  if (request.stashId && !request.duplicate) {
    const existing = database.listDesktopNotes().find((note) => note.stashId === request.stashId);
    if (existing) {
      await deps.windows.pin(context.library.id, existing.id, request.point, true);
      await applyHome(deps.windows, context.library.id, existing.id, request.home ?? 'desktop');
      deps.changed();
      return existing;
    }
  }
  const note = deps.notes.create(request.requestId, request.stashId);
  deps.board.registerNote(note.id, note.persisted);
  if (note.persisted) deps.publishSource(context, note.id);
  deps.changed();
  const cursor = screen.getCursorScreenPoint();
  await deps.windows.pin(
    context.library.id,
    note.id,
    request.point ?? { x: cursor.x + 20, y: cursor.y + 20 },
    request.expanded ?? false,
    Boolean(request.point),
  );
  if (PETAL_DRAWER_ENABLED && (request.home === 'drawer' || (entry?.drawer && !request.stashId))) {
    await applyHome(deps.windows, context.library.id, note.id, 'drawer');
  }
  deps.changed();
  return note;
}
async function applyHome(windows: PetalWindows, libraryId: string, id: string, home: 'desktop' | 'drawer') {
  if (!PETAL_DRAWER_ENABLED) home = 'desktop';
  const place = windows.layouts.get(libraryId, id)!;
  const layout = windows.layouts.drawer(libraryId);
  await windows.layouts.commit(
    libraryId,
    { [id]: { ...place, home } },
    {
      ...layout,
      order: home === 'drawer' && !layout.order.includes(id) ? [...layout.order, id] : layout.order,
    },
  );
}
