import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalHubService } from '@/main/desktop-petals/petal-hub-service';
import { petalHubViewSchema } from '@/shared/contracts/petal-hub';
import { petalError } from '@/shared/petal-errors';
import { DEFAULT_PETAL_COLOR, petalColorSchema } from '@/shared/contracts/petal-appearance';
import { cleanupPetalNotes } from '@/main/desktop-petals/petal-note-removal';
import { openPetalNote } from '@/main/desktop-petals/petal-note-presentation';
import { petalWorkspaceCommandSchema, type PetalWorkspaceResult } from '@/shared/contracts/petal-workspace';
import {
  hidePetalWorkspace,
  restorePetalWorkspace,
  petalWorkspaceSnapshot,
  queuePetalWorkspace,
  type PetalWorkspaceDependencies,
} from '@/main/desktop-petals/petal-workspace-service';

interface Dependencies extends PetalWorkspaceDependencies {
  hub: PetalHubService;
  drain(): Promise<boolean>;
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
  const queued = <T>(action: () => Promise<T>) =>
    queuePetalWorkspace(deps.windows, async () => {
      if (context.state !== 'ACTIVE') throw petalError('libraryUnavailable');
      return action();
    });
  switch (command) {
    case 'workspace': {
      const request = petalWorkspaceCommandSchema.parse(input);
      if (request.kind === 'list') return petalWorkspaceSnapshot(deps, context);
      return queued(async (): Promise<PetalWorkspaceResult> => {
        if (request.kind === 'collect') return hidePetalWorkspace(deps, context, 'collect', request.ids);
        const item = petalWorkspaceSnapshot(deps, context).items.find((item) => item.id === request.id);
        if (!item?.sourceAvailable || (request.kind === 'source' && item.provisional))
          return { completed: [], blocked: [{ id: request.id, reason: 'sourceUnavailable' }] };
        if (request.kind === 'open' && item.layerHidden)
          return { completed: [], blocked: [{ id: request.id, reason: 'hiddenLayer' }] };
        try {
          if (request.kind === 'source') await deps.openSource(request.id);
          else await openPetalNote(context.library.id, request.id, deps.windows, deps.notes, deps.board, deps.drawer);
          deps.changed();
          return { completed: [request.id], blocked: [] };
        } catch {
          return { completed: [], blocked: [{ id: request.id, reason: 'unknown' }] };
        }
      });
    }
    case 'cleanup':
      return queued(() => cleanupPetalNotes(deps, context, petalColorSchema.default(DEFAULT_PETAL_COLOR).parse(input)));
    case 'show-all':
      return queued(async () => {
        if (!entry) deps.windows.showHubView(await deps.windows.show(context.library.id, null), 'flower');
        await restorePetalWorkspace(deps, context);
      });
    case 'hide-all':
    case 'hide-petals':
      return queued(() => hidePetalWorkspace(deps, context, 'temporary'));
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
    case 'reload':
      return queued(async () => {
        if (!(await deps.drain())) throw petalError('unsaved');
        try {
          await deps.activate(context);
        } finally {
          deps.resume();
        }
      });
    default:
      throw new Error('Unknown flower center command');
  }
}
export const hubCommands = new Set([
  'workspace',
  'hub-view',
  'configure-hub',
  'timer-action',
  'hub-quota',
  'show-all',
  'hide-all',
  'hide-petals',
  'cleanup',
  'reload',
]);
