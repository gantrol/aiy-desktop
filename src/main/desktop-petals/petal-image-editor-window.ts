import { screen, type Rectangle } from 'electron';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import { setPetalBounds } from '@/main/desktop-petals/petal-hub-presentation';
import { clampImagePinBounds, clampPetalBounds } from '@/main/desktop-petals/petal-window-geometry';

/** The editor borrows space in the same window; the pin keeps its own dimensions. */
export class PetalImageEditorWindow {
  private readonly sizes = new WeakMap<
    PetalWindow,
    { width: number; height: number; offsetX: number; offsetY: number }
  >();
  placement(entry: PetalWindow): Rectangle {
    const bounds = entry.window.getBounds(),
      saved = this.sizes.get(entry);
    return saved
      ? { x: bounds.x + saved.offsetX, y: bounds.y + saved.offsetY, width: saved.width, height: saved.height }
      : bounds;
  }
  set(entry: PetalWindow, active: boolean) {
    if (entry.window.isDestroyed() || active === this.sizes.has(entry)) return;
    const bounds = entry.window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    if (active) {
      const size = {
        width: Math.min(area.width, Math.max(560, bounds.width)),
        height: Math.min(area.height, Math.max(320, bounds.height + 80)),
      };
      const position = clampPetalBounds(
        { x: bounds.x - (size.width - bounds.width) / 2, y: bounds.y - (size.height - bounds.height) / 2 },
        size,
        area,
      );
      this.sizes.set(entry, {
        width: bounds.width,
        height: bounds.height,
        offsetX: bounds.x - position.x,
        offsetY: bounds.y - position.y,
      });
      try {
        setPetalBounds(entry, { ...position, ...size });
      } catch (error) {
        this.sizes.delete(entry);
        throw error;
      }
    } else {
      const previous = this.placement(entry);
      this.sizes.delete(entry);
      setPetalBounds(entry, { ...previous, ...clampImagePinBounds(previous, previous, area) });
    }
  }
}
