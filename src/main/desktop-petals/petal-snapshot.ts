import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalDrawerService } from '@/main/desktop-petals/petal-drawer-service';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';

export function desktopPetalSnapshot(
  context: ActiveLibraryContext,
  entry: PetalWindow | undefined,
  deps: {
    notes: PetalNoteService;
    windows: PetalWindows;
    drawer: PetalDrawerService;
    board: PetalBoardService;
    suspended: boolean;
    contentApplications: DesktopPetalSnapshot['contentApplications'];
  },
): DesktopPetalSnapshot {
  const bounds = entry?.window.getBounds();
  const board = deps.board.snapshot();
  const collection = deps.windows.collectionHistory.current(context.library.id);
  return {
    libraryId: context.library.id,
    libraryName: context.library.name,
    instanceId: entry?.instanceId ?? null,
    ...deps.drawer.projection(entry),
    expanded: entry?.expanded ?? false,
    alwaysOnTop: entry?.window.isAlwaysOnTop() ?? true,
    contentScale: contentScale(context.library.id, entry, deps.windows),
    applicationPanelHeight: entry ? deps.windows.notePanel.height(entry) : 0,
    collectionUndo: collection ? { token: collection.token, expiresAt: collection.expiresAt } : null,
    collectionPreview: deps.windows.collectionPreview.active(entry),
    editEpoch: entry?.editEpoch ?? 0,
    point: { x: bounds?.x ?? 0, y: bounds?.y ?? 0 },
    ...noteContent(entry, deps.notes),
    suspended: deps.suspended,
    contentActions: context.codexContent.enabled ? [CODEX_EXTENSION_ID] : [],
    contentApplications: deps.contentApplications,
    hubView: entry?.hubView ?? 'flower',
    hubSettings: deps.windows.layouts.hubSettings,
    titlesVisible: deps.windows.layouts.titlesVisible,
    timer: deps.windows.layouts.timer,
    board: entry?.instanceId
      ? {
          ...board,
          pins: board.pins.filter((pin) => pin.id === entry.instanceId),
          memberships: { [entry.instanceId]: board.memberships[entry.instanceId] ?? 'default' },
        }
      : board,
    flowerAnchor: entry ? deps.windows.presentation.anchor(entry) : { x: 112, y: 112 },
    flowerPreview: entry ? deps.windows.presentation.previewing(entry) : false,
    dock: entry ? deps.windows.presentation.dock(entry) : null,
  };
}

function contentScale(libraryId: string, entry: PetalWindow | undefined, windows: PetalWindows) {
  return entry?.instanceId ? (windows.layouts.get(libraryId, entry.instanceId)?.contentScale ?? 1) : 1;
}

function noteContent(entry: PetalWindow | undefined, notes: PetalNoteService) {
  const noteId = entry?.instanceId && !isContentPinId(entry.instanceId) ? entry.instanceId : null;
  return {
    notes: noteId && entry?.expanded ? [notes.get(noteId)] : [],
    summary: noteId ? notes.summary(noteId) : null,
    draft: entry?.expanded && noteId ? notes.draft(noteId) : null,
  };
}
