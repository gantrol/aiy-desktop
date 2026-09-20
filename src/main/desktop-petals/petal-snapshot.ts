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
  const notes =
    entry?.drawer || isContentPinId(entry?.instanceId)
      ? []
      : entry?.instanceId
        ? [deps.notes.get(entry.instanceId)]
        : context.database.listDesktopNotes();
  const bounds = entry?.window.getBounds();
  const collection = deps.windows.collectionHistory.current(context.library.id);
  return {
    libraryId: context.library.id,
    libraryName: context.library.name,
    instanceId: entry?.instanceId ?? null,
    ...deps.drawer.projection(entry),
    expanded: entry?.expanded ?? false,
    alwaysOnTop: entry?.window.isAlwaysOnTop() ?? true,
    collectionUndo: collection ? { token: collection.token, expiresAt: collection.expiresAt } : null,
    editEpoch: entry?.editEpoch ?? 0,
    point: { x: bounds?.x ?? 0, y: bounds?.y ?? 0 },
    notes,
    draft: entry?.instanceId && !isContentPinId(entry.instanceId) ? deps.notes.draft(entry.instanceId) : null,
    suspended: deps.suspended,
    contentActions: context.codexContent.enabled ? [CODEX_EXTENSION_ID] : [],
    contentApplications: deps.contentApplications,
    hubView: entry?.hubView ?? 'flower',
    hubSettings: deps.windows.layouts.hubSettings,
    titlesVisible: deps.windows.layouts.titlesVisible,
    timer: deps.windows.layouts.timer,
    board: deps.board.snapshot(),
    flowerAnchor: entry ? deps.windows.presentation.anchor(entry) : { x: 112, y: 112 },
    flowerPreview: entry ? deps.windows.presentation.previewing(entry) : false,
    dock: entry ? deps.windows.presentation.dock(entry) : null,
  };
}
