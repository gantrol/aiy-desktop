import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindows } from '@/main/desktop-petals/petal-windows';
import { isContentPinId, type PetalBoardCommand, type PetalBoard } from '@/shared/contracts/petal-board';
import { petalError } from '@/shared/petal-errors';
type LayerCommand = Extract<
  PetalBoardCommand,
  { kind: 'create-layer' | 'rename-layer' | 'remove-layer' | 'select-layer' | 'toggle-layer' }
>;
/** Organizes views only. Source repositories never depend on layers or native windows. */
export class PetalBoardService {
  private queue: Promise<void> = Promise.resolve();
  private provisionalLayers = new Map<string, string>();
  constructor(
    private readonly context: ActiveLibraryContext,
    private readonly windows: PetalWindows,
    private readonly beforeHide: (id: string) => Promise<boolean>,
    private readonly changed: () => void,
    private readonly noteExists: (id: string) => boolean,
  ) {}
  private get repository() {
    return this.context.database.petalBoard;
  }
  private get libraryId() {
    return this.context.library.id;
  }
  registerNote(id: string, persisted: boolean) {
    const existing = this.provisionalLayers.get(id);
    if (!persisted) {
      if (!existing) this.provisionalLayers.set(id, this.snapshot().activeLayerId);
      return;
    }
    const layerId = existing ?? this.snapshot().activeLayerId;
    if (!this.repository.memberships()[id]) this.repository.assign(id, layerId);
    this.provisionalLayers.delete(id);
  }
  forgetNote(id: string) {
    this.provisionalLayers.delete(id);
    this.repository.forget(id);
  }
  snapshot(): PetalBoard {
    const layers = this.repository.layers(),
      state = this.windows.layouts.board(this.libraryId);
    return {
      pins: this.repository.list(),
      layers,
      memberships: { ...this.repository.memberships(), ...Object.fromEntries(this.provisionalLayers) },
      activeLayerId: layers.some((layer) => layer.id === state.activeLayerId) ? state.activeLayerId : 'default',
      hiddenLayerIds: state.hiddenLayerIds.filter((id) => layers.some((layer) => layer.id === id)),
    };
  }
  run(command: PetalBoardCommand) {
    this.queue = this.queue.catch(() => undefined).then(() => this.execute(command));
    return this.queue;
  }
  private async execute(command: PetalBoardCommand) {
    const board = this.snapshot();
    switch (command.kind) {
      case 'pin': {
        const id = this.repository.pin(command.source, board.activeLayerId);
        const layerId = this.repository.memberships()[id] ?? 'default';
        await this.windows.layouts.saveBoard(this.libraryId, {
          activeLayerId: layerId,
          hiddenLayerIds: board.hiddenLayerIds.filter((id) => id !== layerId),
        });
        await this.windows.pin(this.libraryId, id, undefined, false);
        break;
      }
      case 'pin-appearance':
        if (!board.pins.some((pin) => pin.id === command.id)) throw petalError('sourceUnavailable');
        this.repository.appearance(command.id, command);
        break;
      case 'unpin':
        if (!isContentPinId(command.id)) throw petalError('invalidSettings');
        this.repository.remove(command.id);
        this.windows.remove(this.libraryId, command.id);
        break;
      case 'assign-layer':
        await this.assign(command, board);
        break;
      default:
        await this.updateLayers(command, board);
    }
    await this.windows.flush();
    this.changed();
  }
  private async assign(command: Extract<PetalBoardCommand, { kind: 'assign-layer' }>, board: PetalBoard) {
    if (!board.layers.some((layer) => layer.id === command.layerId)) throw petalError('invalidSettings');
    if (!board.pins.some((pin) => pin.id === command.id) && !this.noteExists(command.id))
      throw petalError('sourceUnavailable');
    const hide = board.hiddenLayerIds.includes(command.layerId);
    if (hide && !(await this.beforeHide(command.id))) throw petalError('unsaved');
    if (this.provisionalLayers.has(command.id)) this.provisionalLayers.set(command.id, command.layerId);
    else this.repository.assign(command.id, command.layerId);
    if (hide) this.windows.find(this.libraryId, command.id)?.window.hide();
  }
  private async flushLayer(id: string, board: PetalBoard) {
    const entries = [...this.windows.entries.values()].filter(
      (entry) =>
        entry.libraryId === this.libraryId &&
        entry.instanceId &&
        (board.memberships[entry.instanceId] ?? 'default') === id,
    );
    for (const entry of entries) if (!(await this.beforeHide(entry.instanceId!))) throw petalError('unsaved');
  }
  private async updateLayers(command: LayerCommand, board: PetalBoard) {
    const next = { activeLayerId: board.activeLayerId, hiddenLayerIds: [...board.hiddenLayerIds] };
    if (command.kind !== 'create-layer' && !board.layers.some((layer) => layer.id === command.id))
      throw petalError('invalidSettings');
    let recall: string | null = null;
    switch (command.kind) {
      case 'create-layer':
        next.activeLayerId = this.repository.createLayer(command.name);
        break;
      case 'rename-layer':
        this.repository.renameLayer(command.id, command.name);
        break;
      case 'remove-layer':
        this.repository.removeLayer(command.id);
        for (const [id, layer] of this.provisionalLayers)
          if (layer === command.id) this.provisionalLayers.set(id, 'default');
        if (next.activeLayerId === command.id) next.activeLayerId = 'default';
        next.hiddenLayerIds = next.hiddenLayerIds.filter((id) => id !== command.id);
        recall = 'default';
        break;
      case 'select-layer':
        next.activeLayerId = command.id;
        next.hiddenLayerIds = next.hiddenLayerIds.filter((id) => id !== command.id);
        recall = command.id;
        break;
      case 'toggle-layer': {
        const hidden = next.hiddenLayerIds.includes(command.id);
        if (!hidden) await this.flushLayer(command.id, board);
        next.hiddenLayerIds = hidden
          ? next.hiddenLayerIds.filter((id) => id !== command.id)
          : [...next.hiddenLayerIds, command.id];
        recall = command.id;
        break;
      }
    }
    await this.windows.layouts.saveBoard(this.libraryId, next);
    await this.applyVisibility(this.snapshot(), recall);
  }
  private async applyVisibility(board: PetalBoard, recall: string | null) {
    for (const entry of this.windows.entries.values()) {
      if (entry.libraryId !== this.libraryId || !entry.instanceId) continue;
      if (board.hiddenLayerIds.includes(board.memberships[entry.instanceId] ?? 'default')) entry.window.hide();
    }
    if (!recall || board.hiddenLayerIds.includes(recall)) return;
    const ids = [
      ...this.context.database.listDesktopNoteIds(),
      ...board.pins.map((pin) => pin.id),
      ...this.provisionalLayers.keys(),
    ];
    for (const id of ids)
      if ((board.memberships[id] ?? 'default') === recall) {
        const placement = this.windows.layouts.get(this.libraryId, id);
        if (placement?.visible !== false && placement?.home !== 'drawer') await this.windows.show(this.libraryId, id);
      }
  }
  reconcile() {
    for (const id of this.repository.reconcile()) this.windows.remove(this.libraryId, id);
    const active = new Set(this.repository.list().map((pin) => pin.id));
    for (const entry of this.windows.entries.values()) {
      if (entry.libraryId === this.libraryId && isContentPinId(entry.instanceId) && !active.has(entry.instanceId))
        entry.window.hide();
    }
    this.changed();
    void this.windows.flush().catch((error) => console.error('[desktop-petals] board layout save failed', error));
  }
}
