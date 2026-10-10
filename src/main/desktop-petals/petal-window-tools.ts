import { screen } from 'electron';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import { petalWindowToolsCommandSchema } from '@/shared/contracts/petal-window-tools';
import { petalError } from '@/shared/petal-errors';

/** Transient presentation settings; reopening restores pointer access. */
export class PetalWindowTools {
  private values = new WeakMap<PetalWindow, { opacity: number; locked: boolean; clickThrough: boolean }>();
  private value(entry: PetalWindow) {
    let value = this.values.get(entry);
    if (!value) {
      value = { opacity: 1, locked: false, clickThrough: false };
      this.values.set(entry, value);
    }
    return value;
  }
  locked(entry: PetalWindow) {
    return this.values.get(entry)?.locked ?? false;
  }
  restorePointer(entry: PetalWindow) {
    if (!this.values.get(entry)?.clickThrough || entry.window.isDestroyed()) return;
    entry.window.setIgnoreMouseEvents(false);
    this.value(entry).clickThrough = false;
  }
  async execute(windows: PetalWindows, entry: PetalWindow | undefined, raw: unknown) {
    if (!entry?.instanceId || entry.drawer || entry.window.isDestroyed()) throw petalError('sourceUnavailable');
    const command = petalWindowToolsCommandSchema.parse(raw);
    const value = this.value(entry);
    if (command.kind === 'editing') windows.imageEditor.set(entry, command.active);
    if (command.kind === 'imageZoom') zoomImage(windows, entry, command.direction);
    if (command.kind === 'imageSize') {
      if (!windows.layouts.get(entry.libraryId, entry.instanceId)?.imageSize) throw petalError('invalidSettings');
      windows.resizeNote(entry, { width: command.width, height: command.height });
    }
    if (command.kind === 'set') {
      if (command.opacity !== undefined) {
        entry.window.setOpacity(command.opacity);
        value.opacity = command.opacity;
      }
      if (command.locked !== undefined) {
        entry.window.setMovable(!command.locked);
        value.locked = command.locked;
      }
      if (command.clickThrough !== undefined) {
        entry.window.setIgnoreMouseEvents(command.clickThrough, { forward: true });
        value.clickThrough = command.clickThrough;
      }
    }
    if (command.kind === 'recover') {
      this.restorePointer(entry);
      value.locked = false;
      value.opacity = 1;
      entry.window.setMovable(true);
      entry.window.setOpacity(1);
    }
    if (command.kind === 'nudge' || command.kind === 'display' || command.kind === 'recover') {
      if (value.locked) throw petalError('invalidSettings');
      const bounds = entry.window.getBounds();
      if (command.kind === 'nudge') windows.move(entry, { x: bounds.x + command.x, y: bounds.y + command.y });
      else {
        const display =
          command.kind === 'display'
            ? screen.getAllDisplays().find((item) => item.id === command.id)
            : screen.getPrimaryDisplay();
        if (!display) throw petalError('sourceUnavailable');
        const area = display.workArea;
        const point = {
          x: Math.round(area.x + (area.width - bounds.width) / 2),
          y: Math.round(area.y + (area.height - bounds.height) / 2),
        };
        windows.move(entry, point, { x: area.x + area.width / 2, y: area.y + area.height / 2 });
      }
      windows.remember(entry);
      await windows.flush();
    }
    return {
      ...value,
      displayId: screen.getDisplayMatching(entry.window.getBounds()).id,
      displays: screen
        .getAllDisplays()
        .slice(0, 64)
        .map((display) => ({ id: display.id, label: display.label })),
    };
  }
}

function zoomImage(windows: PetalWindows, entry: PetalWindow, direction: number) {
  if (!entry.instanceId || !windows.layouts.get(entry.libraryId, entry.instanceId)?.imageSize)
    throw petalError('invalidSettings');
  const bounds = entry.window.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.max(1, bounds.width - 16),
    height = Math.max(1, bounds.height - 16);
  const factor = Math.min(
    Math.max(direction > 0 ? 1.1 : 1 / 1.1, 32 / Math.min(width, height)),
    (area.width - 16) / width,
    (area.height - 16) / height,
  );
  windows.resizeNote(entry, { width: Math.round(width * factor) + 16, height: Math.round(height * factor) + 16 });
}
