import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { screen } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalBoard } from '@/shared/contracts/petal-board';
import type { PetalDrawerCommand, PetalDrawerItem, PetalDrawerState } from '@/shared/contracts/petal-drawer';
import { petalError } from '@/shared/petal-errors';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import type { PetalPlacement } from '@/main/desktop-petals/petal-layout-store';
import { PetalDrawerWindow } from '@/main/desktop-petals/petal-drawer-window';
import { petalLabel } from '@/shared/petal-preview';
import { PETAL_DRAWER_ENABLED } from '@/shared/contracts/petal-drawer';

interface Dependencies {
  context(): ActiveLibraryContext;
  board(): PetalBoard;
  flush(entry: PetalWindow): Promise<boolean>;
  pending(id: string): boolean;
  discard(id: string): void;
  remove(id: string): Promise<void>;
  changed(): void;
  title(): string;
}

/** Drawer membership is machine-local placement, separate from selection and live editor visibility. */
export class PetalDrawerService {
  readonly view: PetalDrawerWindow;
  private queue: Promise<void> = Promise.resolve();
  private summaries?: Omit<PetalDrawerItem, 'opened'>[];
  private undo?: {
    libraryId: string;
    placements: Record<string, PetalPlacement>;
    order: string[];
    after: Record<string, PetalPlacement>;
  };
  private beforeId: string | null | undefined;
  private readonly flushed = new Set<PetalWindow>();
  constructor(
    private readonly windows: PetalWindows,
    private readonly deps: Dependencies,
  ) {
    this.view = new PetalDrawerWindow(
      windows,
      windows.layouts,
      () => this.items().length,
      deps.changed,
      () => {
        void this.run({ kind: 'hide' }).catch((error) => console.error('[desktop-petals] drawer hide failed', error));
      },
    );
  }
  invalidate() {
    this.summaries = undefined;
  }
  private get context() {
    return this.deps.context();
  }
  private get libraryId() {
    return this.context.library.id;
  }
  private get layout() {
    return this.windows.layouts.drawer(this.libraryId);
  }
  placement(id: string): PetalPlacement {
    return (
      this.windows.layouts.get(this.libraryId, id) ?? { x: 0, y: 0, expanded: false, visible: true, home: 'desktop' }
    );
  }
  private all() {
    if (!this.summaries) {
      const board = this.deps.board();
      this.summaries = [
        ...this.context.database.listDesktopNoteSummaries().map(({ hasImages, ...note }) => ({
          ...note,
          sourceKind: hasImages ? ('IMAGE' as const) : ('NOTE' as const),
        })),
        ...board.pins.map(({ id, title, preview, color, icon, source }) => ({
          id,
          title: petalLabel(title, preview),
          color,
          icon,
          sourceKind: source.kind,
        })),
      ].map((item) => ({
        ...item,
        title: item.title,
        layerId: board.memberships[item.id] ?? 'default',
      }));
    }
    return this.summaries;
  }
  private require(id: string) {
    if (!this.all().some((item) => item.id === id) && !this.deps.pending(id)) throw petalError('sourceUnavailable');
  }
  private flush(entry: PetalWindow) {
    this.flushed.add(entry);
    return this.deps.flush(entry);
  }
  items(): PetalDrawerItem[] {
    const hidden = new Set(this.deps.board().hiddenLayerIds),
      order = new Map(this.layout.order.map((id, index) => [id, index]));
    return this.all()
      .filter((item) => {
        const place = this.placement(item.id);
        return place.home === 'drawer' && place.visible && !hidden.has(item.layerId);
      })
      .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
      .map((item) => ({ ...item, opened: Boolean(this.windows.find(this.libraryId, item.id)?.window.isVisible()) }));
  }
  projection(entry?: PetalWindow): Pick<DesktopPetalSnapshot, 'drawerWindow' | 'home' | 'drawer' | 'placements'> {
    return {
      drawerWindow: Boolean(entry?.drawer),
      home: entry?.instanceId ? this.placement(entry.instanceId).home : 'desktop',
      drawer: entry?.drawer ? this.state() : null,
      placements: Object.fromEntries(
        Object.entries(this.windows.layouts.placements(this.libraryId))
          .filter(([id]) => id !== 'hub')
          .map(([id, place]) => [id, { visible: place.visible, home: place.home }]),
      ),
    };
  }
  state(): PetalDrawerState {
    return {
      name: this.layout.name,
      items: this.items(),
      frame: this.view.frame(),
      anchorId: this.layout.anchorId,
      canUndo: this.canUndo(),
      screens: screen
        .getAllDisplays()
        .map((display) => ({ id: String(display.id), label: display.label || String(display.id) })),
    };
  }
  async activate() {
    this.invalidate();
    this.undo = undefined;
    if (!PETAL_DRAWER_ENABLED) return;
    await this.view.activate(this.libraryId, this.layout.name || this.deps.title());
  }
  private canUndo() {
    return Boolean(
      this.undo &&
      this.undo.libraryId === this.libraryId &&
      Object.entries(this.undo.after).every(
        ([id, place]) => JSON.stringify(this.placement(id)) === JSON.stringify(place),
      ) &&
      this.undo.order.every((id) => this.all().some((item) => item.id === id)),
    );
  }
  async show() {
    if (!PETAL_DRAWER_ENABLED) return;
    if (!this.layout.visible) await this.windows.layouts.commit(this.libraryId, {}, { ...this.layout, visible: true });
    await this.view.show(this.layout.name || this.deps.title());
  }
  run(command: PetalDrawerCommand, sender?: PetalWindow) {
    // These two existing commands serve ordinary petals independently of drawers.
    if (!PETAL_DRAWER_ENABLED && !['visibility', 'toggle-titles'].includes(command.kind))
      throw petalError('sourceUnavailable');
    const libraryId = this.libraryId;
    const windowCommands = [
      'toggle',
      'collapse',
      'hover',
      'begin-pull',
      'pull',
      'end-pull',
      'menu',
      'dragging',
      'drop-target',
    ];
    if (windowCommands.includes(command.kind)) {
      if (!sender?.drawer) throw petalError('hubOnly');
      return this.windowCommand(command);
    }
    if (
      sender?.instanceId &&
      (!('id' in command) ||
        command.id !== sender.instanceId ||
        !['store', 'take', 'visibility'].includes(command.kind))
    )
      throw petalError('hubOnly');
    const pending = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (this.libraryId !== libraryId) throw petalError('wrongLibrary');
        try {
          await this.execute(command);
        } finally {
          for (const entry of this.flushed)
            if (!entry.window.isDestroyed()) {
              entry.editEpoch++;
              entry.window.webContents.send('desktop-petals:changed');
            }
          this.flushed.clear();
        }
      });
    this.queue = pending;
    return pending;
  }
  private async windowCommand(command: PetalDrawerCommand) {
    switch (command.kind) {
      case 'toggle':
        return this.view.animate(this.view.progress >= 0.5 ? 0 : 1, command.reduced);
      case 'collapse':
        return this.view.animate(0, command.reduced);
      case 'hover':
        this.view.hover(command.active, command.reduced);
        return;
      case 'begin-pull':
        this.view.begin(command.point, command.token);
        return;
      case 'pull':
        this.view.pull(command.point);
        return;
      case 'end-pull':
        return this.view.end(command.cancel);
      case 'menu':
        this.view.setMenu(command.open);
        return;
      case 'dragging':
        this.view.setLocalDrag(command.active, command.token);
        return;
      case 'drop-target':
        this.beforeId = command.beforeId;
        return;
    }
  }
  private async execute(command: PetalDrawerCommand) {
    switch (command.kind) {
      case 'rename':
        await this.rename(command.name);
        break;
      case 'toggle-titles':
        await this.windows.toggleTitles();
        return;
      case 'show':
        await this.show();
        break;
      case 'hide':
        await this.windows.layouts.commit(this.libraryId, {}, { ...this.layout, visible: false });
        this.view.cancel();
        this.view.entry?.window.hide();
        break;
      case 'store':
        await this.store([command.id], command.beforeId);
        break;
      case 'take':
        await this.take(command.id, command.point);
        break;
      case 'reorder': {
        this.require(command.id);
        if (this.placement(command.id).home !== 'drawer') throw petalError('sourceUnavailable');
        const order = this.insert(this.layout.order, [command.id], command.beforeId);
        await this.windows.layouts.commit(this.libraryId, {}, { ...this.layout, order });
        this.undo = undefined;
        break;
      }
      case 'collect-layer': {
        const board = this.deps.board();
        const ids = this.all()
          .filter(
            (item) =>
              item.layerId === board.activeLayerId &&
              !board.hiddenLayerIds.includes(item.layerId) &&
              this.placement(item.id).visible &&
              this.placement(item.id).home === 'desktop',
          )
          .map((item) => item.id);
        for (const entry of this.windows.entries.values())
          if (
            entry.libraryId === this.libraryId &&
            entry.instanceId &&
            this.deps.pending(entry.instanceId) &&
            (board.memberships[entry.instanceId] ?? 'default') === board.activeLayerId &&
            entry.window.isVisible()
          )
            ids.push(entry.instanceId);
        await this.store(ids, undefined, true);
        break;
      }
      case 'undo':
        await this.restoreUndo();
        break;
      case 'anchor':
        if (command.id && !this.items().some((item) => item.id === command.id)) return;
        if (this.layout.anchorId === command.id) return;
        await this.windows.layouts.commit(this.libraryId, {}, { ...this.layout, anchorId: command.id });
        return;
      case 'move-mode':
        await this.view.moveMode();
        break;
      case 'move-screen':
        await this.view.moveScreen(command.displayId);
        break;
      case 'move-key':
        await this.view.moveKey(command.dx, command.dy, command.finish, command.cancel);
        break;
      case 'visibility':
        await this.visibility(command.id, command.visible);
        break;
      case 'remove': {
        this.require(command.id);
        const entry = this.windows.find(this.libraryId, command.id);
        if (entry && !(await this.flush(entry))) throw petalError('unsaved');
        await this.deps.remove(command.id);
        this.undo = undefined;
        break;
      }
    }
    this.deps.changed();
  }
  private async rename(name: string) {
    await this.windows.layouts.commit(this.libraryId, {}, { ...this.layout, name });
    const entry = this.view.entry;
    if (entry && !entry.window.isDestroyed()) entry.window.setTitle(name);
  }
  private insert(existing: string[], ids: string[], beforeId?: string | null) {
    const moving = new Set(ids),
      base = existing.filter((id) => !moving.has(id));
    if (beforeId === undefined) {
      // A returning petal retains its original place among the stable global order.
      return [...existing, ...ids.filter((id) => !existing.includes(id))];
    }
    const index = beforeId === null ? base.length : base.indexOf(beforeId);
    if (index < 0) throw petalError('sourceUnavailable');
    base.splice(index, 0, ...ids);
    return base;
  }
  private async store(ids: string[], beforeId?: string | null, undoable = false) {
    for (const id of ids) this.require(id);
    const context = this.context;
    for (const id of ids) {
      const entry = this.windows.find(this.libraryId, id);
      if (entry && !(await this.flush(entry))) throw petalError('unsaved');
    }
    if (this.context !== context) throw petalError('wrongLibrary');
    this.invalidate();
    // Empty provisional notes are discarded by the ordinary close path, never stored as fake content.
    ids = ids.filter((id) => {
      if (!this.deps.pending(id)) return true;
      this.deps.discard(id);
      return false;
    });
    const previous: Record<string, PetalPlacement> = {},
      changes: Record<string, PetalPlacement> = {};
    for (const id of ids) {
      this.require(id);
      previous[id] = { ...this.placement(id) };
      changes[id] = { ...previous[id], home: 'drawer' };
    }
    const oldOrder = [...this.layout.order];
    const order = this.insert(oldOrder, ids, beforeId);
    await this.windows.layouts.commit(this.libraryId, changes, {
      ...this.layout,
      visible: true,
      order,
      anchorId: ids[0] ?? this.layout.anchorId,
    });
    for (const id of ids) {
      const entry = this.windows.find(this.libraryId, id);
      if (entry) {
        this.windows.presentation.endPreview(entry);
        entry.window.hide();
      }
    }
    this.undo =
      undoable && ids.length
        ? { libraryId: this.libraryId, placements: previous, order: oldOrder, after: changes }
        : undefined;
    await this.show();
  }
  private async take(id: string, point?: { x: number; y: number }) {
    this.require(id);
    const hub = point ? this.windows.find(this.libraryId, null) : undefined;
    if (hub && point && this.windows.presentation.containsFlower(hub, point)) {
      await this.visibility(id, false);
      return;
    }
    const previous = { ...this.placement(id) },
      original = this.windows.find(this.libraryId, id);
    const oldBounds = original?.window.getBounds(),
      wasVisible = original?.window.isVisible();
    const wasExpanded = original?.expanded ?? false;
    const expanded = Boolean(original?.window.isVisible() && original.expanded);
    const size = expanded ? oldBounds! : PETAL_WINDOW_SIZES.collapsed;
    const destination = point
      ? { x: point.x - size.width / 2, y: point.y - size.height / 2 }
      : oldBounds && wasVisible
        ? oldBounds
        : this.view.notePoint();
    const entry = await this.windows.show(this.libraryId, id, destination, expanded, true);
    this.windows.move(entry, destination);
    const bounds = entry.window.getBounds();
    try {
      await this.windows.layouts.commit(this.libraryId, {
        [id]: { ...previous, x: bounds.x, y: bounds.y, expanded: entry.expanded, home: 'desktop', visible: true },
      });
    } catch (error) {
      if (!original) entry.window.destroy();
      else {
        this.windows.expand(entry, wasExpanded);
        if (oldBounds) entry.window.setBounds(oldBounds);
        if (!wasVisible) entry.window.hide();
      }
      this.windows.layouts.set(this.libraryId, id, previous);
      throw error;
    }
    this.undo = undefined;
  }
  private async restoreUndo() {
    if (!this.canUndo() || !this.undo) throw petalError('sourceUnavailable');
    const undo = this.undo;
    for (const id of Object.keys(undo.placements)) {
      const entry = this.windows.find(this.libraryId, id);
      if (entry && !(await this.flush(entry))) throw petalError('unsaved');
    }
    await this.windows.layouts.commit(this.libraryId, undo.placements, { ...this.layout, order: undo.order });
    this.undo = undefined;
    for (const [id, place] of Object.entries(undo.placements))
      if (place.visible && !this.deps.board().hiddenLayerIds.includes(this.deps.board().memberships[id] ?? 'default')) {
        const entry = await this.windows.show(this.libraryId, id, undefined, place.expanded);
        this.windows.move(entry, place);
      }
  }
  private async visibility(id: string, visible: boolean) {
    this.require(id);
    const entry = this.windows.find(this.libraryId, id);
    if (!visible && entry && !(await this.flush(entry))) throw petalError('unsaved');
    const place = this.placement(id);
    await this.windows.layouts.commit(this.libraryId, { [id]: { ...place, visible } });
    if (!visible) entry?.window.hide();
    else if (
      place.home === 'desktop' &&
      !this.deps.board().hiddenLayerIds.includes(this.deps.board().memberships[id] ?? 'default')
    )
      await this.windows.show(this.libraryId, id);
    this.undo = undefined;
  }
  async drop(entry: PetalWindow, point: { x: number; y: number }) {
    if (!PETAL_DRAWER_ENABLED) return false;
    const accept =
      entry.instanceId &&
      entry.libraryId === this.libraryId &&
      this.view.accepts(point) &&
      (this.view.containsHandle(point) || this.beforeId !== undefined);
    const before = this.beforeId;
    this.beforeId = undefined;
    this.view.clearDrop();
    if (!accept) return false;
    await this.run({ kind: 'store', id: entry.instanceId!, ...(this.view.progress > 0 ? { beforeId: before } : {}) });
    return true;
  }
  observeDrop(entry: PetalWindow, point: { x: number; y: number }) {
    if (!PETAL_DRAWER_ENABLED) return;
    if (entry.instanceId && entry.libraryId === this.libraryId && !this.view.observeDrop(point))
      this.beforeId = undefined;
  }
  async settle() {
    await this.queue.catch(() => undefined);
    this.view.cancel();
  }
}
