import { screen, type Point, type Rectangle } from 'electron';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import { containsDockedPetalPoint, containsFlowerPoint } from '@/shared/flower-geometry';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';
import {
  clampPetalBounds,
  clampFlowerBounds,
  flowerVisualBounds,
  dockBounds,
  nearestDockEdge,
  type DockEdge,
} from '@/main/desktop-petals/petal-window-geometry';

export function setPetalBounds(entry: PetalWindow, bounds: Rectangle) {
  entry.window.setMinimumSize(0, 0);
  entry.window.setMaximumSize(0, 0);
  entry.window.setBounds(bounds);
  entry.window.setMinimumSize(bounds.width, bounds.height);
  entry.window.setMaximumSize(bounds.width, bounds.height);
}
function pluckPreviewBounds(): Rectangle {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const x = Math.min(...areas.map((area) => area.x));
  const y = Math.min(...areas.map((area) => area.y));
  return {
    x,
    y,
    width: Math.max(...areas.map((area) => area.x + area.width)) - x,
    height: Math.max(...areas.map((area) => area.y + area.height)) - y,
  };
}
/** Temporary gesture geometry is never persisted as the user's preferred placement. */
export class PetalHubPresentation {
  private previews = new WeakMap<PetalWindow, { bounds: Rectangle; owners: Set<'pluck' | 'menu' | 'peek'> }>();
  private docks = new WeakMap<PetalWindow, { edge: DockEdge; collapsed: boolean; bounds: Rectangle }>();
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
    return this.previews.get(entry)?.bounds ?? this.docks.get(entry)?.bounds ?? entry.window.getBounds();
  }
  previewing(entry: PetalWindow) {
    const owners = this.previews.get(entry)?.owners;
    return Boolean(owners?.has('pluck') || owners?.has('menu'));
  }
  anchor(entry: PetalWindow) {
    const bounds = entry.window.getBounds(),
      origin = this.previews.get(entry)?.bounds ?? bounds;
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
  preview(entry: PetalWindow, active: boolean, owner: 'pluck' | 'menu' | 'peek' = 'pluck') {
    if (entry.window.isDestroyed()) return;
    if (entry.instanceId ? owner === 'pluck' || entry.expanded : entry.hubView !== 'flower') return;
    const preview = this.previews.get(entry) ?? {
      bounds: entry.window.getBounds(),
      owners: new Set<'pluck' | 'menu' | 'peek'>(),
    };
    if (active) preview.owners.add(owner);
    else if (!preview.owners.delete(owner)) return;
    if (!preview.owners.size) {
      this.previews.delete(entry);
      setPetalBounds(entry, preview.bounds);
    } else {
      this.previews.set(entry, preview);
      const bounds = preview.bounds;
      if (preview.owners.has('pluck')) {
        // Keep the flower anchored while the captured pointer crosses displays.
        setPetalBounds(entry, pluckPreviewBounds());
      } else {
        const area = screen.getDisplayMatching(bounds).workArea;
        const size = { width: Math.min(480, area.width), height: Math.min(640, area.height) };
        const point = {
          x: bounds.x + (bounds.width - size.width) / 2,
          y: bounds.y + (bounds.height - size.height) / 2,
        };
        setPetalBounds(entry, { ...clampPetalBounds(point, size, area), ...size });
      }
    }
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
    const preview = this.previews.get(entry);
    if (preview) {
      this.previews.delete(entry);
      setPetalBounds(entry, preview.bounds);
    }
  }
  leaveFlower(entry: PetalWindow) {
    this.endPreview(entry);
    if (this.dock(entry)?.collapsed) this.reveal(entry, true);
    this.docks.delete(entry);
  }
}
