/** Geometry only: never include note contents or library data in these logs. */
export function tracePetalGeometry(event: string, details: Record<string, unknown> = {}) {
  console.debug(
    '[aiy-petal-geometry]',
    JSON.stringify({
      at: performance.timeOrigin + performance.now(),
      event,
      viewport: { x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight },
      ...details,
    }),
  );
}
