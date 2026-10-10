import { screen, type Point, type Rectangle } from 'electron';
import { z } from 'zod';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import { petalPointSchema } from '@/shared/contracts/desktop-petals';

export interface PetalDrag {
  point: Point;
  origin: Rectangle;
  ending?: boolean;
  nativeCoordinates?: boolean;
  collectionLibraryId?: string;
}
const endSchema = z.object({ cancel: z.boolean(), released: z.boolean(), point: petalPointSchema.optional() }).strict();

function beginDrag(
  windows: PetalWindows,
  origins: Map<number, PetalDrag>,
  entry: PetalWindow,
  senderId: number,
  input: unknown,
  collectionLibraryId?: string,
) {
  if (windows.tools.locked(entry)) return;
  const request = petalPointSchema.extend({ local: petalPointSchema.optional() }).parse(input);
  const origin = entry.window.getBounds();
  const zoom = request.local ? entry.window.webContents.getZoomFactor() : 1;
  const point = request.local
    ? { x: Math.round(origin.x + request.local.x * zoom), y: Math.round(origin.y + request.local.y * zoom) }
    : { x: request.x, y: request.y };
  entry.previewToken = undefined;
  windows.presentation.clearDock(entry);
  origins.set(senderId, { point, origin, nativeCoordinates: Boolean(request.local), collectionLibraryId });
}

function collectionHub(windows: PetalWindows, entry: PetalWindow, libraryId?: string) {
  if (!entry.instanceId) return undefined;
  return windows.find(libraryId ?? entry.libraryId, null);
}

function previewCollection(
  windows: PetalWindows,
  entry: PetalWindow,
  drag: PetalDrag,
  cursor: Point,
  libraryId?: string,
) {
  const hub = drag.collectionLibraryId === libraryId ? collectionHub(windows, entry, libraryId) : undefined;
  windows.collectionPreview?.update(entry, hub && windows.presentation.containsFlower(hub, cursor) ? hub : undefined);
}

function releasePosition(drag: PetalDrag, released: boolean, point?: Point) {
  if (!released) return undefined;
  return drag.nativeCoordinates ? screen.getCursorScreenPoint() : (point ?? screen.getCursorScreenPoint());
}

export async function executePetalDrag(
  windows: PetalWindows,
  origins: Map<number, PetalDrag>,
  command: string,
  input: unknown,
  senderId: number,
  entry?: PetalWindow,
  collectionLibraryId?: string,
) {
  if (!entry || entry.window.isDestroyed()) {
    origins.delete(senderId);
    return;
  }
  if (command === 'begin-drag') {
    return beginDrag(windows, origins, entry, senderId, input, collectionLibraryId);
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
    previewCollection(windows, entry, drag, cursor, collectionLibraryId);
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
    const releasePoint = releasePosition(drag, released, point);
    if (releasePoint) move(releasePoint);
    else if (point && !drag.nativeCoordinates) move(point);
    const bounds = entry.window.getBounds();
    if (!released) windows.onDragCancel?.();
    if (releasePoint && (await windows.onDragEnd?.(entry, releasePoint))) return;
    if (entry.window.isDestroyed() || origins.get(senderId) !== drag) return;
    // A temporary petal may target the active library's flower without changing its content scope.
    // Switching libraries during the gesture invalidates that target.
    const hub =
      released && drag.collectionLibraryId === collectionLibraryId
        ? collectionHub(windows, entry, collectionLibraryId)
        : undefined;
    if (hub && releasePoint && windows.presentation.containsFlower(hub, releasePoint))
      return await windows.collect(entry, drag.origin, hub.libraryId);
    if (bounds.x === drag.origin.x && bounds.y === drag.origin.y) return;
    windows.presentation.snap(entry);
  } finally {
    windows.collectionPreview?.clear(entry);
    if (origins.get(senderId) === drag) origins.delete(senderId);
  }
}
