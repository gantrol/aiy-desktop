/** A cached segment of the real child rail, in scroll-content coordinates. */
interface RailSegment {
  geometry: SVGGeometryElement;
  matrix: DOMMatrix;
  length: number;
  top: number;
  bottom: number;
  start: DOMPoint;
  end: DOMPoint;
  color: string;
  width: number;
}

export interface CreationLibraryPathConnection {
  x: number;
  dx: number;
  dy: number;
  color: string;
  width: number;
}

/** Read only the active branch's direct child rails, never a descendant's bus. */
export function measureCreationLibraryRails(branch: HTMLElement, viewport: HTMLDivElement): RailSegment[] {
  const content = branch.querySelector(':scope > .tree-branch-content');
  if (!content) return [];
  const bounds = viewport.getBoundingClientRect();
  const segments: RailSegment[] = [];
  const selector = [
    '[data-tree-branch-node-connector] > .tree-branch-selected-connector',
    '[data-tree-branch-node-connector]:is([data-position="last"], [data-position="only"]) > path:first-child',
    '[data-tree-branch-transit-rail] line',
  ];
  // Selected terminal curves take precedence over the quiet continuing rail.
  for (const query of selector) {
    for (const geometry of content.querySelectorAll<SVGGeometryElement>(query)) {
      if (geometry.closest('.tree-branch-content') !== content || typeof geometry.getTotalLength !== 'function')
        continue;
      const style = getComputedStyle(geometry);
      if (style.display === 'none') continue;
      const matrix = geometry.getScreenCTM();
      if (!matrix) continue;
      matrix.e -= bounds.left;
      matrix.f += viewport.scrollTop - bounds.top;
      const length = geometry.getTotalLength();
      if (!length) continue;
      const start = geometry.getPointAtLength(0).matrixTransform(matrix);
      const end = geometry.getPointAtLength(length).matrixTransform(matrix);
      segments.push({
        geometry,
        matrix,
        length,
        top: start.y,
        bottom: end.y,
        start,
        end,
        color: style.color,
        width: parseFloat(style.strokeWidth) || 1.75,
      });
    }
  }
  return segments;
}

/** Find the actual cut through a vertical rail or its terminal bend. */
export function creationLibraryRailConnection(
  segments: readonly RailSegment[],
  cutY: number,
): CreationLibraryPathConnection | null {
  const segment = segments.find(({ top, bottom }) => top <= cutY && bottom > cutY);
  if (!segment) return null;
  const { geometry, matrix, length, color, width } = segment;
  if (geometry.tagName.toLowerCase() === 'line') {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const distance = Math.hypot(dx, dy) || 1;
    return {
      x: segment.start.x + (dx * (cutY - segment.top)) / (segment.bottom - segment.top),
      dx: dx / distance,
      dy: dy / distance,
      color,
      width,
    };
  }
  let low = 0;
  let high = length;
  // These tree paths are monotone in y. Subpixel accuracy preserves the join at zoomed scales.
  for (let step = 0; step < 24 && high - low > 0.01; step++) {
    const middle = (low + high) / 2;
    if (geometry.getPointAtLength(middle).matrixTransform(matrix).y < cutY) low = middle;
    else high = middle;
  }
  const position = (low + high) / 2;
  const point = geometry.getPointAtLength(position).matrixTransform(matrix);
  const before = geometry.getPointAtLength(Math.max(0, position - 0.25)).matrixTransform(matrix);
  const after = geometry.getPointAtLength(Math.min(length, position + 0.25)).matrixTransform(matrix);
  const distance = Math.hypot(after.x - before.x, after.y - before.y) || 1;
  return { x: point.x, dx: (after.x - before.x) / distance, dy: (after.y - before.y) / distance, color, width };
}

export function creationLibraryPathConnectionShape(
  startX: number,
  connection: CreationLibraryPathConnection,
  height: number,
) {
  const { x, dx, dy } = connection;
  // The short shelf belongs to the last breadcrumb. Its tail meets the real rail
  // on the same tangent, with half a pixel of overlap to avoid a raster seam.
  return `M${startX + 12} 25H${startX + 4}C${startX} 25 ${x - dx * 4} ${height - dy * 4} ${x} ${height}l${dx * 0.5} ${dy * 0.5}`;
}
