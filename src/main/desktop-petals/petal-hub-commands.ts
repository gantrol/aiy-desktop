import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import type { PetalDrawerService } from '@/main/desktop-petals/petal-drawer-service';
import type { PetalHubService } from '@/main/desktop-petals/petal-hub-service';
import { petalHubViewSchema } from '@/shared/contracts/petal-hub';
import { petalError } from '@/shared/petal-errors';
interface Dependencies {
  windows: PetalWindows;
  board: PetalBoardService;
  drawer: PetalDrawerService;
  hub: PetalHubService;
  changed(): void;
  drain(): Promise<boolean>;
  resume(): void;
  activate(context: ActiveLibraryContext): Promise<void>;
}
export async function executePetalHubCommand(
  deps: Dependencies,
  command: string,
  input: unknown,
  context: ActiveLibraryContext,
  entry?: PetalWindow,
) {
  if (entry?.instanceId) throw petalError('hubOnly');
  switch (command) {
    case 'show-all': {
      if (!entry) deps.windows.showHubView(await deps.windows.show(context.library.id, null), 'flower');
      const board = deps.board.snapshot();
      await deps.windows.layouts.saveBoard(context.library.id, {
        activeLayerId: board.activeLayerId,
        hiddenLayerIds: [],
      });
      const changes = Object.fromEntries(
        [...context.database.listDesktopNoteIds(), ...board.pins.map((pin) => pin.id)].map((id) => [
          id,
          { ...deps.drawer.placement(id), visible: true },
        ]),
      );
      await deps.windows.layouts.commit(context.library.id, changes);
      for (const id of [...context.database.listDesktopNoteIds(), ...board.pins.map((pin) => pin.id)])
        if (deps.drawer.placement(id).home === 'desktop') await deps.windows.show(context.library.id, id);
      await deps.drawer.show();
      deps.changed();
      return;
    }
    case 'hub-view': {
      const view = petalHubViewSchema.parse(input);
      const hubWindow = entry && !entry.drawer ? entry : await deps.windows.show(context.library.id, null);
      deps.windows.showHubView(hubWindow, view);
      return;
    }
    case 'configure-hub':
      await deps.hub.configure(input);
      deps.changed();
      return;
    case 'timer-action':
      await deps.hub.timerAction(input);
      deps.changed();
      return;
    case 'hub-quota':
      return deps.hub.quota(context);
    case 'hide-all':
    case 'hide-petals':
    case 'reload':
      if (!(await deps.drain())) throw petalError('unsaved');
      try {
        if (command === 'reload') await deps.activate(context);
        else {
          const ids = [...context.database.listDesktopNoteIds(), ...deps.board.snapshot().pins.map((pin) => pin.id)];
          await deps.windows.layouts.commit(
            context.library.id,
            Object.fromEntries(ids.map((id) => [id, { ...deps.drawer.placement(id), visible: false }])),
          );
          for (const current of deps.windows.entries.values()) if (current.instanceId) current.window.hide();
          deps.windows.collectionHistory.clear();
        }
      } finally {
        deps.resume();
      }
      return;
    default:
      throw new Error('Unknown flower center command');
  }
}
