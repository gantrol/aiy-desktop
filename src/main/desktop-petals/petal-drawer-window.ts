import { screen, type Display, type Point, type Rectangle } from 'electron';
import type { PetalWindows, PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalLayoutStore } from '@/main/desktop-petals/petal-layout-store';
import {
  PETAL_DRAWER,
  PETAL_DRAWER_ENABLED,
  type PetalDrawerFrame,
  type PetalDrawerPosition,
} from '@/shared/contracts/petal-drawer';
import {
  clampDrawer as clamp,
  containsDrawerRect as contains,
  drawerHandle,
  drawerPosition,
  floatingDrawer,
  unionDrawer,
} from '@/main/desktop-petals/petal-drawer-geometry';

/** A floating bookmark anchors the strip; expansion never changes its saved position. */
export class PetalDrawerWindow {
  entry?: PetalWindow;
  progress = 0;
  moving = false;
  menu = false;
  private preview = false;
  dragging = false;
  localDrag = false;
  dropPoint: Point | null = null;
  private libraryId = '';
  private position: PetalDrawerPosition = { displayId: '', xRatio: 0.8, yRatio: 1 / 3 };
  private moveOrigin?: PetalDrawerPosition;
  private pullOrigin?: { point: Point; handle: Rectangle };
  private columns: number = PETAL_DRAWER.columns;
  private rows = 1;
  private animation?: ReturnType<typeof setInterval>;
  private finishAnimation?: () => void;
  private displayTimer?: ReturnType<typeof setTimeout>;
  private dropTimer?: ReturnType<typeof setTimeout>;
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private stopPointer?: () => void;
  private lastProfile = '';
  private disposed = false;
  private revision = 0;
  private interactionEpoch = 0;
  constructor(
    private readonly windows: PetalWindows,
    private readonly layouts: PetalLayoutStore,
    private readonly count: () => number,
    private readonly changed: () => void,
    private readonly hide: () => void,
  ) {
    if (!PETAL_DRAWER_ENABLED) return;
    screen.on('display-added', this.displaysChanged);
    screen.on('display-removed', this.displaysChanged);
    screen.on('display-metrics-changed', this.displaysChanged);
  }
  private profile() {
    return screen
      .getAllDisplays()
      .map((d) => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width},${d.bounds.height}:${d.scaleFactor}`)
      .sort()
      .join('|');
  }
  private display(): Display {
    return screen.getAllDisplays().find((d) => String(d.id) === this.position.displayId) ?? screen.getPrimaryDisplay();
  }
  private choosePosition() {
    const stored = this.layouts.drawer(this.libraryId).profiles[this.profile()];
    if (stored && screen.getAllDisplays().some((d) => String(d.id) === stored.displayId)) this.position = { ...stored };
    else if (!screen.getAllDisplays().some((d) => String(d.id) === this.position.displayId))
      this.position = { ...this.position, displayId: String(screen.getPrimaryDisplay().id) };
    this.lastProfile = this.profile();
  }
  private measure() {
    this.columns = floatingDrawer(this.display().workArea, this.position, this.count()).columns;
    this.rows = 1;
  }
  async activate(libraryId: string, title: string) {
    if (!PETAL_DRAWER_ENABLED) return;
    this.cancel();
    this.entry = undefined;
    this.libraryId = libraryId;
    this.position = {
      displayId: String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id),
      xRatio: 0.8,
      yRatio: 1 / 3,
    };
    this.choosePosition();
    if (!this.layouts.drawer(libraryId).profiles[this.profile()]) await this.savePosition();
    this.measure();
    if (!this.layouts.drawer(libraryId).visible) return;
    await this.show(title);
  }
  async show(title: string) {
    if (!PETAL_DRAWER_ENABLED) return;
    if (!this.entry || this.entry.window.isDestroyed()) {
      this.progress = 0;
      const frame = this.frame();
      const entry = await this.windows.createDrawer(
        this.libraryId,
        frame,
        title,
        () => {
          this.setPreview(false);
          if (this.menu) this.setMenu(false);
          if (!this.menu && !this.dragging && !this.pullOrigin && !this.moving) this.hover(false);
        },
        this.hide,
      );
      if (this.disposed || entry.libraryId !== this.libraryId) {
        entry.window.destroy();
        return;
      }
      this.entry = entry;
    } else this.entry.window.showInactive();
    this.emit();
  }
  frame(): PetalDrawerFrame {
    const area = this.display().workArea;
    const { handle, content, edge, columns } = floatingDrawer(area, this.position, this.columns);
    const full = unionDrawer(handle, content);
    const revealed = {
      ...content,
      width: Math.round(content.width * this.progress),
      x: edge === 'left' ? content.x + content.width - Math.round(content.width * this.progress) : content.x,
    };
    const visible = this.progress === 0 ? handle : unionDrawer(handle, revealed);
    const reservedHeight = this.menu ? 480 : 560;
    let bounds =
      this.menu || this.preview
        ? {
            x: Math.round(
              clamp(visible.x + visible.width / 2 - 240, area.x, area.x + area.width - Math.min(480, area.width)),
            ),
            y: Math.round(
              clamp(
                visible.y + visible.height / 2 - reservedHeight / 2,
                area.y,
                area.y + area.height - Math.min(reservedHeight, area.height),
              ),
            ),
            width: Math.min(480, area.width),
            height: Math.min(reservedHeight, area.height),
          }
        : visible;
    if (this.menu || this.preview) bounds = unionDrawer(bounds, visible);
    if (this.localDrag) {
      const areas = screen.getAllDisplays().map((display) => display.workArea);
      const x = Math.min(...areas.map((a) => a.x)),
        y = Math.min(...areas.map((a) => a.y));
      bounds = {
        x,
        y,
        width: Math.max(...areas.map((a) => a.x + a.width)) - x,
        height: Math.max(...areas.map((a) => a.y + a.height)) - y,
      };
    }
    return {
      ...bounds,
      revision: this.revision,
      interactionEpoch: this.interactionEpoch,
      canvasX: full.x - bounds.x,
      canvasY: content.y - bounds.y,
      handleX: handle.x - full.x,
      handleY: handle.y - content.y,
      contentX: content.x - full.x,
      contentWidth: content.width,
      bodyWidth: full.width,
      bodyHeight: content.height,
      columns,
      rows: this.rows,
      progress: this.progress,
      edge,
      moving: this.moving,
      menu: this.menu,
      dropPoint: this.dropPoint,
    };
  }
  emit() {
    this.revision++;
    const entry = this.entry;
    if (!entry || entry.window.isDestroyed()) return;
    const frame = this.frame();
    const current = entry.window.getBounds();
    if (['x', 'y', 'width', 'height'].some((key) => current[key as keyof Rectangle] !== frame[key as keyof Rectangle]))
      entry.window.setBounds({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    entry.window.webContents.send('desktop-petals:drawer-frame', frame);
  }
  private stopAnimation() {
    clearInterval(this.animation);
    this.animation = undefined;
    this.finishAnimation?.();
    this.finishAnimation = undefined;
  }
  animate(target: number, reduced = false): Promise<void> {
    this.stopAnimation();
    if (target === 0) this.preview = false;
    if (target > 0 && this.progress === 0) this.measure();
    if (reduced || this.progress === target) {
      this.progress = target;
      this.emit();
      return Promise.resolve();
    }
    const from = this.progress,
      start = Date.now();
    return new Promise((resolve) => {
      this.finishAnimation = resolve;
      this.animation = setInterval(() => {
        const elapsed = Math.min(1, (Date.now() - start) / 180);
        this.progress = from + (target - from) * (1 - (1 - elapsed) ** 3);
        if (elapsed === 1) this.progress = target;
        this.emit();
        if (elapsed === 1) this.stopAnimation();
      }, 16);
    });
  }
  begin(point: Point, token?: string) {
    this.stopAnimation();
    clearTimeout(this.hoverTimer);
    this.preview = false;
    this.moveOrigin ??= { ...this.position };
    this.pullOrigin = { point, handle: drawerHandle(this.display().workArea, this.position) };
    this.moving = true;
    this.progress = 0;
    this.emit();
    if (token) this.watchPointer(token);
  }
  pull(point: Point) {
    if (!this.pullOrigin) return;
    const display = screen.getDisplayNearestPoint(point);
    this.position = drawerPosition(display.workArea, String(display.id), {
      x: this.pullOrigin.handle.x + point.x - this.pullOrigin.point.x,
      y: this.pullOrigin.handle.y + point.y - this.pullOrigin.point.y,
    });
    this.measure();
    this.emit();
  }
  async end(cancel: boolean) {
    this.stopPointer?.();
    this.stopPointer = undefined;
    this.pullOrigin = undefined;
    if (this.moving) {
      await this.endMove(cancel);
      return;
    }
  }
  setMenu(open: boolean) {
    clearTimeout(this.hoverTimer);
    if (open) this.preview = false;
    this.menu = open;
    this.emit();
    if (!open) this.hover(false);
  }
  setPreview(open: boolean) {
    if (this.preview === open) return;
    this.preview = open;
    this.emit();
    if (!open) this.hover(false);
  }
  hover(active: boolean, reduced = false) {
    clearTimeout(this.hoverTimer);
    if (this.menu || this.preview || this.dragging || this.moving || this.pullOrigin) return;
    this.hoverTimer = setTimeout(
      () => {
        if (this.menu || this.preview || this.dragging || this.moving || this.pullOrigin) return;
        if (active || !this.accepts(screen.getCursorScreenPoint())) void this.animate(active ? 1 : 0, reduced);
      },
      active ? 180 : 350,
    );
  }
  setLocalDrag(active: boolean, token?: string) {
    this.stopPointer?.();
    this.stopPointer = undefined;
    this.preview = false;
    this.dragging = active;
    this.localDrag = active;
    this.emit();
    if (active && token) this.watchPointer(token);
    if (!active) this.hover(false);
  }
  private watchPointer(token: string) {
    this.stopPointer?.();
    this.stopPointer = this.windows.input.watchPointer((point, released) => {
      if (this.entry && !this.entry.window.isDestroyed())
        this.entry.window.webContents.send('desktop-petals:drawer-pointer', { token, point, released });
    });
  }
  async moveMode() {
    await this.animate(0, true);
    this.moveOrigin = { ...this.position };
    this.moving = true;
    this.emit();
  }
  private async savePosition() {
    const layout = this.layouts.drawer(this.libraryId);
    const profiles = { ...layout.profiles, [this.profile()]: { ...this.position } };
    // Retain recent configurations without allowing an unbounded machine-local file.
    const keys = Object.keys(profiles);
    for (const key of keys.slice(0, Math.max(0, keys.length - 16))) delete profiles[key];
    await this.layouts.commit(this.libraryId, {}, { ...layout, profiles });
  }
  private async endMove(cancel: boolean) {
    try {
      if (cancel && this.moveOrigin) this.position = this.moveOrigin;
      else await this.savePosition();
    } catch (error) {
      if (this.moveOrigin) this.position = this.moveOrigin;
      throw error;
    } finally {
      this.moveOrigin = undefined;
      this.moving = false;
      this.measure();
      this.emit();
    }
  }
  async moveKey(dx: number, dy: number, finish?: boolean, cancel?: boolean) {
    if (!this.moving) return;
    if (finish || cancel) return this.endMove(Boolean(cancel));
    const area = this.display().workArea,
      handle = drawerHandle(area, this.position);
    this.position = drawerPosition(area, this.position.displayId, { x: handle.x + dx, y: handle.y + dy });
    this.emit();
  }
  async moveScreen(displayId: string) {
    if (!screen.getAllDisplays().some((display) => String(display.id) === displayId)) return;
    const previous = { ...this.position };
    await this.animate(0, true);
    this.position.displayId = displayId;
    try {
      await this.savePosition();
    } catch (error) {
      this.position = previous;
      throw error;
    }
    this.measure();
    this.emit();
  }
  observeDrop(point: Point) {
    if (!this.accepts(point)) {
      this.clearDrop();
      return false;
    }
    this.dropPoint = point;
    this.dragging = true;
    if (this.progress === 0 && !this.dropTimer)
      this.dropTimer = setTimeout(() => {
        this.dropTimer = undefined;
        void this.animate(1);
      }, 350);
    this.emit();
    return true;
  }
  clearDrop() {
    clearTimeout(this.dropTimer);
    this.dropTimer = undefined;
    const changed = this.dropPoint !== null;
    this.dropPoint = null;
    this.dragging = this.localDrag;
    if (changed) this.emit();
  }
  accepts(point: Point) {
    const { content } = floatingDrawer(this.display().workArea, this.position, this.columns);
    return Boolean(
      this.entry?.window.isVisible() &&
      !this.menu &&
      (this.containsHandle(point) || (this.progress === 1 && contains(content, point))),
    );
  }
  containsHandle(point: Point) {
    const handle = drawerHandle(this.display().workArea, this.position);
    const x = ((point.x - handle.x) * 80) / handle.width;
    const y = ((point.y - handle.y) * 152) / handle.height;
    return x >= 6 && x <= 74 && y >= 4 && y <= 126 + (Math.abs(x - 40) * 20) / 34;
  }
  notePoint() {
    const f = this.frame(),
      area = this.display().workArea;
    return {
      x: Math.round(clamp(f.x, area.x, area.x + area.width - 328)),
      y: Math.round(clamp(f.y + f.height + 8, area.y, area.y + area.height - 362)),
    };
  }
  private displaysChanged = () => {
    clearTimeout(this.displayTimer);
    this.displayTimer = setTimeout(
      () => {
        if (this.disposed || !this.libraryId) return;
        const displays = screen.getAllDisplays();
        const stillPresent = displays.some((d) => String(d.id) === this.position.displayId);
        const detachedEditor = [...this.windows.entries.values()].some((entry) => {
          if (!entry.instanceId || entry.window.isDestroyed() || !entry.window.isVisible()) return false;
          const bounds = entry.window.getBounds();
          return !displays.some((d) =>
            contains(d.workArea, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }),
          );
        });
        if (
          stillPresent &&
          !detachedEditor &&
          (this.menu ||
            this.dragging ||
            this.pullOrigin ||
            [...this.windows.entries.values()].some((entry) => entry.instanceId && entry.window.isFocused()))
        ) {
          this.displaysChanged();
          return;
        }
        this.cancel();
        this.choosePosition();
        this.measure();
        this.emit();
        const occupied: Rectangle[] = [];
        for (const entry of this.windows.entries.values()) {
          if (entry.drawer || entry.window.isDestroyed() || !entry.window.isVisible()) continue;
          const bounds = entry.window.getBounds();
          const display = screen.getDisplayMatching(bounds),
            area = display.workArea;
          const width = Math.min(bounds.width, area.width),
            height = Math.min(bounds.height, area.height);
          let x = clamp(bounds.x, area.x, area.x + area.width - width),
            y = clamp(bounds.y, area.y, area.y + area.height - height);
          if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) {
            for (
              let attempt = 0;
              attempt < 100 && occupied.some((r) => Math.abs(r.x - x) < 40 && Math.abs(r.y - y) < 50);
              attempt++
            ) {
              y += height + 8;
              if (y + height > area.y + area.height) {
                y = area.y;
                x = clamp(x - width - 8, area.x, area.x + area.width - width);
              }
            }
            this.windows.presentation.clearDock(entry);
            entry.window.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
          }
          occupied.push({ x, y, width, height });
        }
        this.changed();
      },
      this.lastProfile === this.profile() ? 300 : 500,
    );
  };
  cancel() {
    clearTimeout(this.hoverTimer);
    this.stopPointer?.();
    this.stopPointer = undefined;
    this.interactionEpoch++;
    this.stopAnimation();
    this.pullOrigin = undefined;
    this.moveOrigin = undefined;
    this.moving = false;
    this.menu = false;
    this.preview = false;
    this.localDrag = false;
    this.dragging = false;
    this.progress = 0;
    this.clearDrop();
    this.emit();
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    clearTimeout(this.displayTimer);
    screen.off('display-added', this.displaysChanged);
    screen.off('display-removed', this.displaysChanged);
    screen.off('display-metrics-changed', this.displaysChanged);
  }
}
