export const TAB_DRAG_DELAY = 280;
export const TAB_DRAG_THRESHOLD = 6;

export interface TabDragTarget {
  zone: HTMLElement;
  pinned: boolean;
  vertical: boolean;
  beforeId: string | null;
}

export function tabItems(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-tab-item]'));
}

/** Preview translation must not move the logical hit-test boundaries. */
export function tabBounds(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  const translation = getComputedStyle(node).translate.split(' ').map(Number.parseFloat);
  return new DOMRect(rect.x - (translation[0] || 0), rect.y - (translation[1] || 0), rect.width, rect.height);
}

export function containsPoint(rect: DOMRect, x: number, y: number) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function tabDragTarget(
  zone: HTMLElement,
  id: string,
  x: number,
  y: number,
  previous?: TabDragTarget | null,
): TabDragTarget {
  const vertical = zone.dataset.tabAxis === 'vertical';
  const items = tabItems(zone).filter((node) => node.dataset.workspaceTabItem !== id);
  const before = items.find((node) => {
    const bounds = tabBounds(node);
    return vertical ? y < bounds.top + bounds.height / 2 : x < bounds.left + bounds.width / 2;
  });
  // A visible prefix of pinned tabs ends before the first hidden item.
  const beforeId = before?.dataset.workspaceTabItem ?? zone.dataset.tabHiddenFirst ?? null;
  if (previous?.zone === zone && previous.beforeId !== beforeId) {
    const indexOf = (value: string | null) => {
      const index = items.findIndex((node) => node.dataset.workspaceTabItem === value);
      return index < 0 ? items.length : index;
    };
    const oldIndex = indexOf(previous.beforeId);
    const nextIndex = indexOf(beforeId);
    if (Math.abs(oldIndex - nextIndex) === 1) {
      const boundary = tabBounds(items[Math.min(oldIndex, nextIndex)]);
      const distance = vertical ? y - boundary.top - boundary.height / 2 : x - boundary.left - boundary.width / 2;
      if (Math.abs(distance) < 4) return previous;
    }
  }
  return { zone, pinned: zone.dataset.workspaceTabZone !== 'regular', vertical, beforeId };
}

export function tabDragScrollDirection(zone: HTMLElement | null, x: number, y: number) {
  if (!zone) return 0;
  const rect = zone.getBoundingClientRect();
  const vertical = zone.dataset.tabAxis === 'vertical';
  const point = vertical ? y : x;
  if (point < (vertical ? rect.top : rect.left) + 24) return -1;
  if (point > (vertical ? rect.bottom : rect.right) - 24) return 1;
  return 0;
}

export function tabDragExtent(target: TabDragTarget, source: DOMRect, sourcePinned: boolean) {
  const items = tabItems(target.zone);
  if (target.zone.dataset.workspaceTabZone === 'list') return items[0]?.getBoundingClientRect().height ?? 36;
  if (target.pinned) return target.vertical ? 28 : 32;
  if (sourcePinned) {
    const rect = items[0] && tabBounds(items[0]);
    return target.vertical ? (rect?.height ?? 64) : (rect?.width ?? 160);
  }
  return target.vertical ? source.height : source.width;
}

/** Move only visible neighbours; the persisted order remains untouched. */
export function previewTabPositions(
  zone: HTMLElement,
  sourceId: string,
  target: TabDragTarget | null,
  extent: number,
  reduced: boolean,
) {
  const nodes = tabItems(zone);
  if (!nodes.length) return;
  const vertical = zone.dataset.tabAxis === 'vertical';
  const bounds = nodes.map(tabBounds);
  const gap = zone.dataset.workspaceTabZone === 'list' ? 0 : 2;
  let position = vertical ? bounds[0].top : bounds[0].left;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const id = node.dataset.workspaceTabItem;
    if (id === sourceId) {
      node.style.opacity = '0';
      continue;
    }
    if (target?.beforeId === id) position += extent + gap;
    const rect = bounds[index];
    const delta = position - (vertical ? rect.top : rect.left);
    node.style.transition = reduced ? 'none' : 'translate 150ms cubic-bezier(0.2, 0, 0, 1)';
    node.style.translate = vertical ? `0px ${delta}px` : `${delta}px 0px`;
    position += (vertical ? rect.height : rect.width) + gap;
  }
}

export function clearTabPreview(roots: (HTMLElement | null)[]) {
  for (const root of roots) {
    if (!root) continue;
    for (const node of tabItems(root)) {
      node.style.removeProperty('translate');
      node.style.removeProperty('transition');
      node.style.removeProperty('opacity');
    }
  }
}

export function tabInsertionRect(target: TabDragTarget, id: string) {
  const viewport = target.zone.getBoundingClientRect();
  const all = tabItems(target.zone);
  const first = all[0] ? tabBounds(all[0]) : viewport;
  const gap = target.zone.dataset.workspaceTabZone === 'list' ? 0 : 2;
  let position = target.vertical ? first.top : first.left;
  for (const node of all) {
    if (node.dataset.workspaceTabItem === id) continue;
    if (node.dataset.workspaceTabItem === target.beforeId) break;
    const bounds = tabBounds(node);
    position += (target.vertical ? bounds.height : bounds.width) + gap;
  }
  if (target.vertical) {
    return new DOMRect(
      viewport.left + 2,
      Math.max(viewport.top, Math.min(viewport.bottom - 2, position)),
      viewport.width - 4,
      2,
    );
  }
  return new DOMRect(
    Math.max(viewport.left, Math.min(viewport.right - 2, position)),
    viewport.top + 3,
    2,
    viewport.height - 6,
  );
}

export function scrollTabDragZone(zone: HTMLElement, x: number, y: number, elapsed: number) {
  const rect = zone.getBoundingClientRect();
  const vertical = zone.dataset.tabAxis === 'vertical';
  const point = vertical ? y : x;
  const start = vertical ? rect.top : rect.left;
  const end = vertical ? rect.bottom : rect.right;
  const distance = point < start + 24 ? point - start - 24 : point > end - 24 ? point - end + 24 : 0;
  const amount = (Math.max(-1, Math.min(1, distance / 24)) * 360 * Math.min(elapsed, 32)) / 1000;
  if (vertical) zone.scrollTop += amount;
  else zone.scrollLeft += amount;
}
