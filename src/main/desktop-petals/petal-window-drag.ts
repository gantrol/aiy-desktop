import { screen, type Point, type Rectangle } from 'electron';
import { z } from 'zod';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import { petalPointSchema } from '@/shared/contracts/desktop-petals';

export interface PetalDrag {
  point: Point;
  origin: Rectangle;
}
const endSchema = z.object({ cancel: z.boolean(), released: z.boolean(), point: petalPointSchema.optional() }).strict();

export async function executePetalDrag(
  windows: PetalWindows,
  origins: Map<number, PetalDrag>,
  command: string,
  input: unknown,
  senderId: number,
  entry?: PetalWindow,
) {
  if (!entry) return;
  if (command === 'begin-drag') {
    const point = petalPointSchema.parse(input);
    windows.presentation.preview(entry, false, 'peek');
    entry.previewToken = undefined;
    windows.presentation.clearDock(entry);
    origins.set(senderId, { point, origin: entry.window.getBounds() });
    return;
  }
  const drag = origins.get(senderId);
  if (!drag) return;
  const move = (point: Point) =>
    windows.move(
      entry,
      { x: drag.origin.x + point.x - drag.point.x, y: drag.origin.y + point.y - drag.point.y },
      point,
      drag.origin,
    );
  if (command === 'move') {
    petalPointSchema.parse(input);
    const cursor = screen.getCursorScreenPoint();
    move(cursor);
    windows.onDragMove?.(entry, cursor);
    return;
  }
  const { cancel, released, point } = endSchema.parse(input);
  if (cancel) windows.move(entry, drag.origin, undefined, drag.origin);
  else if (point) move(point);
  const bounds = entry.window.getBounds();
  origins.delete(senderId);
  if (cancel) {
    windows.onDragCancel?.();
    return;
  }
  if (released && (await windows.onDragEnd?.(entry, point ?? screen.getCursorScreenPoint()))) return;
  const hub = released && entry.instanceId && !entry.expanded ? windows.find(entry.libraryId, null) : undefined;
  if (hub && windows.presentation.containsFlower(hub, point ?? screen.getCursorScreenPoint()))
    return windows.collect(entry, drag.origin);
  if (bounds.x === drag.origin.x && bounds.y === drag.origin.y) return;
  windows.presentation.snap(entry);
}
