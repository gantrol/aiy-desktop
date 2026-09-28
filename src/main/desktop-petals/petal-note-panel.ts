import { screen } from 'electron';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import { setPetalBounds } from '@/main/desktop-petals/petal-hub-presentation';
import { clampPetalBounds } from '@/main/desktop-petals/petal-window-geometry';
import { petalError } from '@/shared/petal-errors';

/** Auxiliary controls borrow screen space, never the note's saved reading area. */
export class PetalNotePanel {
  private readonly states = new WeakMap<PetalWindow, { height: number; offsetY: number }>();

  height(entry: PetalWindow) {
    return this.states.get(entry)?.height ?? 0;
  }

  placement(entry: PetalWindow) {
    const bounds = entry.window.getBounds();
    const panel = this.states.get(entry);
    return panel ? { ...bounds, y: bounds.y + panel.offsetY, height: bounds.height - panel.height } : bounds;
  }

  set(entry: PetalWindow, requested: number) {
    if (entry.window.isDestroyed()) return 0;
    if (!requested && !this.states.has(entry)) return 0;
    if (!entry.instanceId || !entry.expanded || entry.drawer) throw petalError('sourceUnavailable');
    const origin = this.placement(entry);
    const area = screen.getDisplayMatching(entry.window.getBounds()).workArea;
    const height = Math.max(0, Math.min(requested, area.height - origin.height));
    if (requested && height < 64) throw petalError('panelSpaceUnavailable');
    const size = { width: origin.width, height: origin.height + height };
    const position = clampPetalBounds(origin, size, area);
    const previous = this.states.get(entry);
    if (height) this.states.set(entry, { height, offsetY: origin.y - position.y });
    else this.states.delete(entry);
    try {
      setPetalBounds(entry, { ...position, ...size });
    } catch (error) {
      if (previous) this.states.set(entry, previous);
      else this.states.delete(entry);
      throw error;
    }
    entry.window.webContents.send('desktop-petals:changed');
    return height;
  }

  moved(entry: PetalWindow) {
    const panel = this.states.get(entry);
    if (panel) panel.offsetY = 0;
  }
}
