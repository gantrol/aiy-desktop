import { screen, type Point, type Rectangle } from 'electron';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import { containsDockedPetalPoint, containsFlowerPoint } from '@/shared/flower-geometry';
import { PETAL_WINDOW_SIZES, type PetalHubView } from '@/shared/contracts/petal-hub';
import {
  clampPetalBounds,
  clampFlowerBounds,
  flowerVisualBounds,
  dockBounds,
  nearestDockEdge,
  type DockEdge,
} from '@/main/desktop-petals/petal-window-geometry';

export function setPetalBounds(entry: PetalWindow, bounds: Rectangle) {
  const current = entry.window.getBounds();
  if (
    current.x === bounds.x &&
    current.y === bounds.y &&
    current.width === bounds.width &&
    current.height === bounds.height
  )
    return;
  entry.window.setMinimumSize(0, 0);
  entry.window.setMaximumSize(0, 0);
  entry.window.setBounds(bounds);
  // resizable:false already owns the native size constraints. Reapplying them
  // after setBounds introduces another native layout pass at fractional DPI.
}
type DockState = { edge: DockEdge; collapsed: boolean; bounds: Rectangle };
type HubViewOrigin = { bounds: Rectangle; dock?: DockState };
/** Temporary gesture and panel geometry never replaces the user's flower placement. */
export class PetalHubPresentation {
  private previews = new WeakMap<PetalWindow, Set<'pluck' | 'menu'>>();
  private docks = new WeakMap<PetalWindow, DockState>();
  private views = new WeakMap<PetalWindow, HubViewOrigin>();
  constructor(
    private readonly remember: (entry: PetalWindow) => void,
    private readonly flowerSize: () => number,
  ) {}
  dock(entry: PetalWindow) {
    const dock = this.docks.get(entry);
    if (!dock) return null;
    const current = entry.window.getBounds();
    const bounds = dockBounds(dock.bounds, screen.getDisplayMatching(dock.bounds).workArea, dock.edge, true);
    return {
      edge: dock.edge,
      collapsed: dock.collapsed,
      petalBounds: { ...bounds, x: bounds.x - current.x, y: bounds.y - current.y },
    };
  }
  dockEdge(entry: PetalWindow) {
    return this.docks.get(entry)?.edge ?? this.views.get(entry)?.dock?.edge;
  }
  clearDock(entry: PetalWindow) {
    if (!this.docks.has(entry)) return;
    this.docks.delete(entry);
    this.remember(entry);
    entry.window.webContents.send('desktop-petals:changed');
  }
  restoreDock(entry: PetalWindow, edge: DockEdge) {
    this.docks.set(entry, { edge, collapsed: false, bounds: entry.window.getBounds() });
    this.reveal(entry, false, true);
  }
  placement(entry: PetalWindow) {
    return this.views.get(entry)?.bounds ?? this.docks.get(entry)?.bounds ?? entry.window.getBounds();
  }
  previewing(entry: PetalWindow) {
    return Boolean(this.previews.get(entry)?.size);
  }
  anchor(entry: PetalWindow) {
    const bounds = entry.window.getBounds(),
      origin = this.views.get(entry)?.bounds ?? bounds;
    return {
      x: Math.round(origin.x + origin.width / 2 - bounds.x),
      y: Math.round(origin.y + origin.height / 2 - bounds.y),
    };
  }
  containsFlower(entry: PetalWindow, point: Point) {
    if (entry.instanceId || entry.hubView !== 'flower' || entry.window.isDestroyed() || !entry.window.isVisible())
      return false;
    const bounds = entry.window.getBounds();
    const dock = this.dock(entry);
    if (dock?.collapsed)
      return containsDockedPetalPoint(point, {
        ...dock.petalBounds,
        x: bounds.x + dock.petalBounds.x,
        y: bounds.y + dock.petalBounds.y,
      });
    const anchor = this.anchor(entry);
    return containsFlowerPoint(point, { x: bounds.x + anchor.x, y: bounds.y + anchor.y }, this.flowerSize());
  }
  pluckPosition(point: Point, pointer?: Point) {
    const size = PETAL_WINDOW_SIZES.collapsed;
    const area = screen.getDisplayNearestPoint(
      pointer ?? { x: point.x + size.width / 2, y: point.y + size.height / 2 },
    ).workArea;
    return clampPetalBounds(point, size, area);
  }
  preview(entry: PetalWindow, active: boolean, owner: 'pluck' | 'menu' = 'pluck') {
    if (entry.window.isDestroyed()) return;
    if (entry.instanceId ? owner === 'pluck' || entry.expanded : entry.hubView !== 'flower') return;
    const owners = this.previews.get(entry) ?? new Set<'pluck' | 'menu'>();
    if (active) {
      if (owners.has(owner)) return;
      owners.add(owner);
    } else if (!owners.delete(owner)) return;
    if (owners.size) this.previews.set(entry, owners);
    else this.previews.delete(entry);
    entry.window.webContents.send('desktop-petals:changed');
  }
  snap(entry: PetalWindow) {
    if (entry.instanceId || entry.hubView !== 'flower' || this.previews.has(entry)) return;
    const bounds = entry.window.getBounds();
    const edge = nearestDockEdge(
      flowerVisualBounds(bounds, this.flowerSize()),
      screen.getDisplayMatching(bounds).workArea,
    );
    if (!edge) {
      this.docks.delete(entry);
      this.remember(entry);
      entry.window.webContents.send('desktop-petals:changed');
      return;
    }
    this.docks.set(entry, { edge, collapsed: false, bounds });
    this.remember(entry);
    entry.window.webContents.send('desktop-petals:changed');
  }
  reveal(entry: PetalWindow, expanded: boolean, force = false) {
    const dock = this.docks.get(entry);
    if (!dock || entry.hubView !== 'flower' || this.previews.has(entry)) return;
    if (dock.collapsed === !expanded) return;
    const bounds = dock.bounds;
    const cursor = screen.getCursorScreenPoint();
    if (
      !expanded &&
      !force &&
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height
    )
      return;
    const area = screen.getDisplayMatching(bounds).workArea;
    dock.collapsed = !expanded;
    const next = expanded
      ? { ...bounds, ...clampFlowerBounds(bounds, this.flowerSize(), area) }
      : dockBounds(bounds, area, dock.edge, true);
    if (expanded) dock.bounds = next;
    setPetalBounds(entry, next);
    this.remember(entry);
    entry.window.webContents.send('desktop-petals:changed');
  }
  endPreview(entry: PetalWindow) {
    this.previews.delete(entry);
  }
  showView(entry: PetalWindow, view: PetalHubView) {
    if (entry.hubView === view) return;
    const leavingFlower = entry.hubView === 'flower';
    if (leavingFlower) {
      const dock = this.docks.get(entry);
      this.views.set(entry, {
        bounds: { ...(dock?.bounds ?? this.placement(entry)) },
        dock: dock ? { ...dock, collapsed: false, bounds: { ...dock.bounds } } : undefined,
      });
      this.previews.delete(entry);
      this.docks.delete(entry);
    }
    const origin = this.views.get(entry);
    const returning = view === 'flower';
    const placement =
      returning || leavingFlower ? (origin?.bounds ?? entry.window.getBounds()) : entry.window.getBounds();
    const area = screen.getDisplayMatching(placement).workArea;
    const size = PETAL_WINDOW_SIZES[view];
    const target = {
      ...placement,
      width: Math.min(size.width, area.width),
      height: Math.min(size.height, area.height),
    };
    const bounds = {
      ...target,
      ...(returning ? clampFlowerBounds(target, this.flowerSize(), area) : clampPetalBounds(target, target, area)),
    };
    // View, target size and restoration point form one transition. Never publish
    // a flower at the panel's origin and repair it in a later microtask.
    entry.hubView = view;
    setPetalBounds(entry, bounds);
    if (returning) {
      if (origin?.dock) this.docks.set(entry, { ...origin.dock, bounds: { ...bounds } });
      this.views.delete(entry);
    }
    this.remember(entry);
    entry.window.webContents.send('desktop-petals:changed');
  }
}
