/** Local coordinates inside the transparent flower host, shared by its controls. */
export function flowerSettingsLayout(view: { x: number; y: number; width: number; height: number }, size: number) {
  const gap = size / 2 + 12;
  const right = view.width - view.x - gap - 8;
  const left = view.x - gap - 8;
  const direction = right >= left ? 1 : -1;
  const available = Math.max(right, left);
  const columns = available >= 288 ? 4 : 2;
  const width = Math.max(120, Math.min(288, available));
  const height = (4 / columns) * 100;
  const x = Math.max(8, direction === 1 ? view.x + gap : view.x - gap - width);
  const y = Math.max(8, Math.min(view.height - height - 8, view.y - height / 2));
  const below = view.height - y - height - 12;
  const above = y - 12;
  const controlsHeight = Math.min(220, Math.max(below, above));
  return {
    x,
    y,
    width,
    height,
    columns,
    direction,
    controlsY: below >= above ? y + height + 8 : y - controlsHeight - 8,
    controlsHeight,
  };
}
