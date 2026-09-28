import type { DragEvent, DragEventHandler, PointerEvent } from 'react';

export type ItemDragIntent = 'MOVE' | 'COPY' | 'REFERENCE' | 'NONE';
export function itemDragIntent(event: Pick<DragEvent, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): ItemDragIntent {
  const reference = event.ctrlKey || event.metaKey;
  if (event.altKey || (event.shiftKey && reference)) return 'NONE';
  return reference ? 'REFERENCE' : event.shiftKey ? 'COPY' : 'MOVE';
}

/** A destination with only a move command must never silently consume a copy/reference gesture. */
export function acceptsItemMove(event: DragEvent) {
  return itemDragIntent(event) === 'MOVE';
}

export function acceptsItemTransfer(event: DragEvent) {
  const intent = itemDragIntent(event);
  return intent === 'MOVE' || intent === 'COPY';
}

/** Reorder-only lists cannot create copies or references. Block unsupported gestures at both hover and drop. */
export function itemReorderHandler<T extends HTMLElement>(handle: DragEventHandler<T>): DragEventHandler<T> {
  return (event) => {
    if (!acceptsItemMove(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    handle(event);
  };
}

const origins = new WeakMap<HTMLElement, Element>();

export const itemDragScopeProps = {
  'data-item-drag-scope': true,
  onPointerDownCapture(event: PointerEvent<HTMLElement>) {
    if (event.target instanceof Element) origins.set(event.currentTarget, event.target);
  },
  onDragStartCapture(event: DragEvent<HTMLElement>) {
    const origin = origins.get(event.currentTarget);
    if (
      origin?.closest('input, textarea, select, [contenteditable="true"], [role="checkbox"], [data-item-drag-ignore]')
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  },
};

/** The item is the drag surface; editing and auxiliary controls keep their own gestures. */
export function itemDragStart<T extends HTMLElement>(start: DragEventHandler<T>): DragEventHandler<T> {
  return (event: DragEvent<T>) => {
    const target = event.target;
    if (target instanceof Element) {
      const control = target.closest(
        'input, textarea, select, [contenteditable="true"], [role="menuitem"], [role="checkbox"], [data-item-drag-ignore]',
      );
      if (control && event.currentTarget.contains(control)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    event.stopPropagation();
    start(event);
  };
}
