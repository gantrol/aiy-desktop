import type { ImageEditDocument, ImageEditMark } from '@/shared/contracts/image-edit';

export type Point = { x: number; y: number };
export type ImageEditTool = 'select' | 'pan' | 'crop' | ImageEditMark['kind'];
export function cornerHandles(box: ImageEditDocument['crop'] | null) {
  return box
    ? ([
        ['nw', box.x, box.y],
        ['ne', box.x + box.width, box.y],
        ['sw', box.x, box.y + box.height],
        ['se', box.x + box.width, box.y + box.height],
      ] as const)
    : [];
}
export function imageViewport(document: ImageEditDocument, full = false) {
  const crop = full ? { x: 0, y: 0, width: document.width, height: document.height } : document.crop;
  const project = ({ x, y }: Point) => {
    const u = document.flipX ? crop.width - (x - crop.x) : x - crop.x;
    const v = document.flipY ? crop.height - (y - crop.y) : y - crop.y;
    switch (document.rotation) {
      case 1:
        return { x: crop.height - v, y: u };
      case 2:
        return { x: crop.width - u, y: crop.height - v };
      case 3:
        return { x: v, y: crop.width - u };
      default:
        return { x: u, y: v };
    }
  };
  const p = project({ x: 0, y: 0 }),
    x = project({ x: 1, y: 0 }),
    y = project({ x: 0, y: 1 });
  const matrix: [number, number, number, number, number, number] = [
    x.x - p.x,
    x.y - p.y,
    y.x - p.x,
    y.y - p.y,
    p.x,
    p.y,
  ];
  return {
    width: document.rotation % 2 ? crop.height : crop.width,
    height: document.rotation % 2 ? crop.width : crop.height,
    matrix,
  };
}
export function markBounds(mark: ImageEditMark) {
  if (mark.kind === 'pen' && mark.points?.length) {
    const xs = mark.points.map((p) => p.x),
      ys = mark.points.map((p) => p.y);
    return {
      x: mark.x + Math.min(...xs),
      y: mark.y + Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    };
  }
  return {
    x: Math.min(mark.x, mark.x + mark.width),
    y: Math.min(mark.y, mark.y + mark.height),
    width: Math.max(1, Math.abs(mark.width)),
    height: Math.max(1, Math.abs(mark.height)),
  };
}
export function arrowPath(mark: ImageEditMark) {
  const angle = Math.atan2(mark.height, mark.width),
    length = Math.max(12, mark.stroke * 4);
  const x = mark.x + mark.width,
    y = mark.y + mark.height;
  return `M${mark.x} ${mark.y}L${x} ${y}M${x - length * Math.cos(angle - 0.45)} ${y - length * Math.sin(angle - 0.45)}L${x} ${y}L${x - length * Math.cos(angle + 0.45)} ${y - length * Math.sin(angle + 0.45)}`;
}
export function linePath(mark: ImageEditMark) {
  return `M${mark.x} ${mark.y}L${mark.x + mark.width} ${mark.y + mark.height}`;
}
export function penPath(mark: ImageEditMark) {
  return (mark.points ?? []).map((point, i) => `${i ? 'L' : 'M'}${mark.x + point.x} ${mark.y + point.y}`).join(' ');
}
export function cropBetween(a: Point, b: Point, document: ImageEditDocument) {
  const x = Math.max(0, Math.min(document.width - 1, Math.round(Math.min(a.x, b.x))));
  const y = Math.max(0, Math.min(document.height - 1, Math.round(Math.min(a.y, b.y))));
  return {
    x,
    y,
    width: Math.max(1, Math.min(document.width - x, Math.round(Math.abs(b.x - a.x)))),
    height: Math.max(1, Math.min(document.height - y, Math.round(Math.abs(b.y - a.y)))),
  };
}
