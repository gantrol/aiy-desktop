export interface TabMorphSnapshot {
  id: string;
  rect: DOMRect;
  title: string;
  icon: SVGElement | null;
  iconOnly: boolean;
}

export function tabMorphSnapshot(node: HTMLElement): TabMorphSnapshot {
  return {
    id: node.dataset.workspaceTabItem!,
    rect: node.getBoundingClientRect(),
    title: node.querySelector('[data-workspace-tab-title]')?.textContent ?? '',
    icon: node.querySelector<SVGElement>('[data-workspace-tab-icon] svg'),
    iconOnly: node.closest('[data-workspace-tab-zone="pinned"]') !== null,
  };
}

/** Only an inert icon and label move; the live header and editor keep their identity. */
export function animateTabMorph(from: TabMorphSnapshot, destination: HTMLElement, finished: () => void) {
  const to = destination.getBoundingClientRect();
  const pinned = destination.closest('[data-workspace-tab-zone="pinned"]') !== null;
  const preview = document.createElement('div');
  preview.className =
    'pointer-events-none fixed z-drag flex items-center overflow-hidden rounded-sm border border-border bg-background text-sm text-foreground shadow-overlay';
  preview.setAttribute('aria-hidden', 'true');
  preview.inert = true;
  Object.assign(preview.style, {
    left: `${from.rect.left}px`,
    top: `${from.rect.top}px`,
    width: `${from.rect.width}px`,
    height: `${from.rect.height}px`,
    padding: `0 ${from.iconOnly ? 9 : 12}px`,
    gap: from.iconOnly ? '0px' : '8px',
  });
  if (from.icon) preview.append(from.icon.cloneNode(true));
  const label = document.createElement('span');
  label.className = 'min-w-0 flex-1 truncate';
  label.textContent = from.title;
  label.style.opacity = from.iconOnly ? '0' : '1';
  preview.append(label);
  document.body.append(preview);
  const previousOpacity = destination.style.opacity;
  destination.style.opacity = '0';
  const animation = preview.animate(
    [
      {
        left: `${from.rect.left}px`,
        top: `${from.rect.top}px`,
        width: `${from.rect.width}px`,
        height: `${from.rect.height}px`,
      },
      {
        left: `${to.left}px`,
        top: `${to.top}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
        paddingLeft: pinned ? '9px' : '12px',
        paddingRight: pinned ? '9px' : '12px',
        gap: pinned ? '0px' : '8px',
      },
    ],
    { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' },
  );
  const fade = label.animate([{ opacity: from.iconOnly ? 0 : 1 }, { opacity: pinned ? 0 : 1 }], {
    duration: 100,
    fill: 'forwards',
  });
  const cleanup = () => {
    animation.onfinish = null;
    animation.cancel();
    fade.cancel();
    preview.remove();
    destination.style.opacity = previousOpacity;
    finished();
  };
  animation.onfinish = cleanup;
  return cleanup;
}
