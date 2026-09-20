import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import type { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import type { PetalNoteCleanupDependencies } from '@/main/desktop-petals/petal-note-removal';
import type {
  PetalWorkspaceItem,
  PetalWorkspaceSnapshot,
  PetalWorkspaceResult,
} from '@/shared/contracts/petal-workspace';
import type { PetalFlushObservation } from '@/shared/petal-flush';
import { petalPlacementState } from '@/shared/petal-visibility';
import { petalFlushObservation } from '@/main/desktop-petals/petal-flush-observations';

export interface PetalWorkspaceDependencies extends PetalNoteCleanupDependencies {
  board: PetalBoardService;
  checkpointNote(entry: PetalWindow): Promise<boolean>;
  openSource(id: string): Promise<unknown>;
}
const failures = new WeakMap<ActiveLibraryContext, Map<string, PetalFlushObservation>>();
function latestFlushObservation(observed: PetalFlushObservation | null, failed?: PetalFlushObservation) {
  return failed && (!observed || failed.checkedAt >= observed.checkedAt) ? failed : observed;
}
function contextFailures(context: ActiveLibraryContext) {
  let values = failures.get(context);
  if (!values) {
    values = new Map();
    failures.set(context, values);
  }
  return values;
}

export function petalWorkspaceSnapshot(
  deps: PetalWorkspaceDependencies,
  context: ActiveLibraryContext,
): PetalWorkspaceSnapshot {
  const libraryId = context.library.id;
  const board = deps.board.snapshot();
  const summaries = new Map(
    context.database.listDesktopNoteSummaries().map(({ id, title, color, icon }) => [id, { id, title, color, icon }]),
  );
  const pins = new Map(board.pins.map((pin) => [pin.id, pin]));
  const entries = new Map(
    [...deps.windows.entries.values()]
      .filter((entry) => entry.libraryId === libraryId && entry.instanceId && !entry.window.isDestroyed())
      .map((entry) => [entry.instanceId!, entry]),
  );
  const ids = new Set([
    ...summaries.keys(),
    ...pins.keys(),
    ...entries.keys(),
    ...Object.keys(deps.windows.layouts.placements(libraryId)).filter((id) => id !== 'hub'),
  ]);
  const items: PetalWorkspaceItem[] = [...ids].map((id) => {
    const pin = pins.get(id);
    let note = summaries.get(id);
    if (!pin && !note) {
      try {
        note = deps.notes.get(id);
      } catch {
        /* Preserve an unavailable source as a visible diagnostic row. */
      }
    }
    const entry = entries.get(id);
    const place = deps.windows.layouts.get(libraryId, id);
    const layerId = board.memberships[id] ?? 'default';
    const observed = entry ? petalFlushObservation(entry) : null;
    const failed = failures.get(context)?.get(id);
    const lastFlush = latestFlushObservation(observed, failed);
    return {
      id,
      title: pin?.title || note?.title || '',
      sourceKind: pin?.source.kind ?? 'ARTICLE',
      color: pin?.color ?? note?.color ?? 'white',
      icon: pin?.icon ?? note?.icon ?? 'feather',
      layerId,
      layerHidden: board.hiddenLayerIds.includes(layerId),
      placement: petalPlacementState(place),
      expanded: entry?.expanded ?? place?.expanded ?? false,
      windowVisible: entry?.window.isVisible() ?? false,
      provisional: !pin && deps.notes.isPending(id),
      sourceAvailable: Boolean(pin || note),
      lastFlush: lastFlush ?? null,
    };
  });
  return { libraryId, items, suspended: false };
}

/** Only placement commands use this queue; note saves and flush replies must remain runnable. */
const queues = new WeakMap<PetalWindows, Promise<unknown>>();
export function queuePetalWorkspace<T>(windows: PetalWindows, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(windows) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(task);
  queues.set(windows, pending);
  void pending
    .finally(() => {
      if (queues.get(windows) === pending) queues.delete(windows);
    })
    .catch(() => undefined);
  return pending;
}

/** Temporary hide is best-effort per entry. Process exit and library drain remain strict. */
export async function hidePetalWorkspace(
  deps: PetalWorkspaceDependencies,
  context: ActiveLibraryContext,
  mode: 'temporary' | 'collect',
  selected?: readonly string[],
): Promise<PetalWorkspaceResult> {
  const result: PetalWorkspaceResult = { completed: [], blocked: [] };
  deps.suspend();
  deps.changed();
  try {
    await deps.drawer.settle();
    await deps.restoration?.catch(() => undefined);
    const items = petalWorkspaceSnapshot(deps, context).items;
    const byId = new Map(items.map((item) => [item.id, item]));
    const targets = selected
      ? [...new Set(selected)]
      : items.filter((item) => item.placement === 'active' && !item.layerHidden).map((item) => item.id);
    const prepared: string[] = [];
    let index = 0;
    const prepare = async () => {
      while (index < targets.length) {
        const id = targets[index++]!;
        const item = byId.get(id);
        if (!item?.sourceAvailable) {
          result.blocked.push({ id, reason: 'sourceUnavailable' });
          continue;
        }
        const entry = deps.windows.find(context.library.id, id);
        let safe = true;
        if (entry) {
          try {
            safe = await deps.checkpointNote(entry);
          } catch {
            safe = false;
          }
        }
        if (!safe) {
          result.blocked.push({ id, reason: (entry && petalFlushObservation(entry)?.report.reason) || 'unknown' });
          continue;
        }
        if (deps.notes.isPending(id)) {
          // Provisional checkpoints are in memory. Only an acknowledged empty note may disappear.
          const report = entry && petalFlushObservation(entry)?.report;
          if (report?.status !== 'unchanged') {
            result.blocked.push({ id, reason: 'unconfirmed' });
            continue;
          }
          deps.removeNote(id);
          result.completed.push(id);
          continue;
        }
        prepared.push(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, prepare));
    let persisted = false;
    try {
      await deps.windows.layouts.transitionVisibility(context.library.id, prepared, mode);
      persisted = true;
    } catch {
      for (const id of prepared) {
        contextFailures(context).set(id, {
          report: { status: 'blocked', reason: 'persistence' },
          checkedAt: Date.now(),
        });
        result.blocked.push({ id, reason: 'persistence' });
      }
    }
    if (persisted) {
      for (const id of prepared) {
        try {
          const entry = deps.windows.find(context.library.id, id);
          const place = deps.windows.layouts.get(context.library.id, id);
          if (place?.visible === false && entry && !entry.window.isDestroyed()) {
            deps.windows.presentation.endPreview(entry);
            entry.window.hide();
            deps.windows.collectionHistory.clear(entry);
          }
          contextFailures(context).delete(id);
          result.completed.push(id);
        } catch {
          // Placement has already committed. A native-window failure is not a disk failure,
          // and must not retroactively mark successfully hidden siblings as failed.
          contextFailures(context).set(id, {
            report: { status: 'blocked', reason: 'rendererUnavailable' },
            checkedAt: Date.now(),
          });
          result.blocked.push({ id, reason: 'rendererUnavailable' });
        }
      }
    }
    if (result.blocked.length) {
      try {
        const hub = await deps.windows.show(context.library.id, null);
        deps.windows.showHubView(hub, 'notes');
      } catch (error) {
        // Retain the structured result even when the manager itself cannot be presented.
        console.error('[desktop-petals] management window unavailable', error);
      }
    }
    return result;
  } finally {
    deps.resume();
    deps.changed();
  }
}

export async function restorePetalWorkspace(deps: PetalWorkspaceDependencies, context: ActiveLibraryContext) {
  const items = petalWorkspaceSnapshot(deps, context).items;
  const placements = deps.windows.layouts.placements(context.library.id);
  const ids = items
    .filter(
      (item) =>
        item.sourceAvailable &&
        !item.layerHidden &&
        placements[item.id]?.home !== 'drawer' &&
        (item.placement === 'active' || item.placement === 'temporary'),
    )
    .map((item) => item.id);
  await deps.windows.layouts.transitionVisibility(context.library.id, ids, 'restore');
  for (const id of ids) {
    // The native restore path rechecks the latest placement after loading as well.
    const board = deps.board.snapshot();
    if (!board.hiddenLayerIds.includes(board.memberships[id] ?? 'default'))
      await deps.windows.restore(context.library.id, id);
  }
  deps.changed();
}
