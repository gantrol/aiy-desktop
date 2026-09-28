import { screen, type Point, type Rectangle } from 'electron';
import { z } from 'zod';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import { petalPointSchema } from '@/shared/contracts/desktop-petals';

export interface PetalDrag {
  point: Point;
  origin: Rectangle;
  ending?: boolean;
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
  if (!entry || entry.window.isDestroyed()) {
    origins.delete(senderId);
    return;
  }
  if (command === 'begin-drag') {
    const point = petalPointSchema.parse(input);
    entry.previewToken = undefined;
    windows.presentation.clearDock(entry);
    origins.set(senderId, { point, origin: entry.window.getBounds() });
    return;
  }
  const drag = origins.get(senderId);
  if (!drag || drag.ending) return;
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
  // Reject late moves, but retain identity until asynchronous drop handling settles.
  drag.ending = true;
  try {
    if (cancel) {
      try {
        windows.move(entry, drag.origin, undefined, drag.origin);
      } finally {
        if (origins.get(senderId) === drag) windows.onDragCancel?.();
      }
      return;
    }
    // Capture the fallback once; a pending drop must not resample a later cursor position.
    const releasePoint = released ? (point ?? screen.getCursorScreenPoint()) : undefined;
    if (point) move(point);
    const bounds = entry.window.getBounds();
    if (!released) windows.onDragCancel?.();
    if (releasePoint && (await windows.onDragEnd?.(entry, releasePoint))) return;
    if (entry.window.isDestroyed() || origins.get(senderId) !== drag) return;
    const hub = released && entry.instanceId && !entry.expanded ? windows.find(entry.libraryId, null) : undefined;
    if (hub && releasePoint && windows.presentation.containsFlower(hub, releasePoint))
      return await windows.collect(entry, drag.origin);
    if (bounds.x === drag.origin.x && bounds.y === drag.origin.y) return;
    windows.presentation.snap(entry);
  } finally {
    if (origins.get(senderId) === drag) origins.delete(senderId);
  }
}
