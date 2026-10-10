import type { EmbeddedWebBounds } from '@/shared/contracts/embedded-web';

/** Native views must stay inside the visible portion of the owning content pane. */
export function embeddedWebBounds(element: HTMLElement): EmbeddedWebBounds {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left),
    top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right),
    bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
    const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const box = parent.getBoundingClientRect();
    if (clipsX) {
      left = Math.max(left, box.left + parent.clientLeft);
      right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
    }
    if (clipsY) {
      top = Math.max(top, box.top + parent.clientTop);
      bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
    }
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
