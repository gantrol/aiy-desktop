type Point = { x: number; y: number };

function eraseStroke(ctx: CanvasRenderingContext2D, from: Point, to: Point, radius: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineWidth = radius * 2;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(to.x, to.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Fine, partially erased grooves soften the edge; only the opaque core counts toward reveal.
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance > 0) {
    const normalX = -(to.y - from.y) / distance;
    const normalY = (to.x - from.x) / distance;
    ctx.lineWidth = Math.max(0.5, radius * 0.035);
    for (const side of [-1, 1]) {
      for (let groove = 0; groove < 3; groove++) {
        const offset = side * radius * (1.04 + groove * 0.09);
        const inset = Math.min(distance * 0.2, groove * 2);
        ctx.globalAlpha = 0.48 - groove * 0.12;
        ctx.beginPath();
        ctx.moveTo(from.x + normalX * offset - normalY * inset, from.y + normalY * offset + normalX * inset);
        ctx.lineTo(to.x + normalX * offset + normalY * inset, to.y + normalY * offset - normalX * inset);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Fixed sampling grid avoids reading every pixel of a large, high-DPI preview. */
export function createScratchSurface(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  coating?: CanvasImageSource,
) {
  const scale = Math.min(window.devicePixelRatio || 1, 2, 1024 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(canvas.width / width, canvas.height / height);
  ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--media-surround-light').trim() || 'Canvas';
  ctx.fillRect(0, 0, width, height);
  // Reuse the resting cover so the silver material does not change at the first stroke.
  if (coating) ctx.drawImage(coating, 0, 0, width, height);
  const cells = 48;
  const cleared = new Uint8Array(cells * cells);
  const radius = Math.max(8, Math.min(36, Math.min(width, height) * 0.12));
  let clearedCount = 0;
  let distanceTravelled = 0;
  let last: Point | null = null;

  return {
    end() {
      last = null;
    },
    scratch(point: Point) {
      const from = last ?? point;
      eraseStroke(ctx, from, point, radius);
      const dx = point.x - from.x,
        dy = point.y - from.y;
      const distanceSquared = dx * dx + dy * dy;
      distanceTravelled += Math.sqrt(distanceSquared);
      const minX = Math.max(0, Math.floor(((Math.min(from.x, point.x) - radius) / width) * cells));
      const maxX = Math.min(cells - 1, Math.ceil(((Math.max(from.x, point.x) + radius) / width) * cells));
      const minY = Math.max(0, Math.floor(((Math.min(from.y, point.y) - radius) / height) * cells));
      const maxY = Math.min(cells - 1, Math.ceil(((Math.max(from.y, point.y) + radius) / height) * cells));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const index = y * cells + x;
          if (cleared[index]) continue;
          const px = ((x + 0.5) / cells) * width,
            py = ((y + 0.5) / cells) * height;
          const t = distanceSquared
            ? Math.max(0, Math.min(1, ((px - from.x) * dx + (py - from.y) * dy) / distanceSquared))
            : 0;
          if (Math.hypot(px - from.x - t * dx, py - from.y - t * dy) <= radius) {
            cleared[index] = 1;
            clearedCount++;
          }
        }
      last = point;
      return distanceTravelled >= radius && clearedCount / cleared.length >= 0.5;
    },
  };
}
