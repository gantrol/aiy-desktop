/** A pane's saved expanded size is independent from its collapsed edge/rail. */
export interface PaneResizeState {
  collapsed: boolean;
  width: number;
}

export interface PaneResizeBounds {
  minimum: number;
  maximum: number;
  collapsedWidth: number;
}

export function createPaneResizeGesture(initial: PaneResizeState, bounds: PaneResizeBounds) {
  let state = { ...initial };
  let requested = initial.collapsed ? bounds.collapsedWidth : initial.width;
  let previousDelta = 0;
  return (delta: number): PaneResizeState => {
    if (!Number.isFinite(delta) || bounds.maximum < bounds.minimum) return state;
    requested = Math.max(bounds.collapsedWidth, Math.min(bounds.maximum, requested + delta - previousDelta));
    previousDelta = delta;
    const collapsed = state.collapsed ? requested < bounds.collapsedWidth + 32 : requested < bounds.minimum - 48;
    const next = {
      collapsed,
      width: collapsed ? state.width : Math.max(bounds.minimum, Math.min(bounds.maximum, requested)),
    };
    // Rebase after snapping. Otherwise the next event re-collapses a just-opened pane.
    if (collapsed !== state.collapsed) requested = collapsed ? bounds.collapsedWidth : next.width;
    state = next;
    return next;
  };
}

interface PanePointerStart {
  button: number;
  pointerId: number;
  clientX: number;
  isPrimary?: boolean;
  preventDefault(): void;
}

/** Window listeners survive a disappearing separator; unrelated pointers cannot end the drag. */
export function beginPanePointerDrag(
  event: PanePointerStart,
  onDelta: (delta: number) => void,
  onFinish?: (cancelled: boolean) => void,
): () => void {
  if (event.button !== 0 || event.isPrimary === false) return () => {};
  event.preventDefault();
  const { pointerId, clientX } = event;
  const cursor = document.body.style.cursor;
  const selection = document.body.style.userSelect;
  let active = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const cleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', blur);
    window.removeEventListener('keydown', key, true);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = selection;
  };
  const finish = (cancelled: boolean) => {
    if (!active) return;
    cleanup();
    onFinish?.(cancelled);
  };
  const move = (pointer: PointerEvent) => {
    if (active && pointer.pointerId === pointerId) onDelta(pointer.clientX - clientX);
  };
  const up = (pointer: PointerEvent) => {
    if (pointer.pointerId === pointerId) finish(false);
  };
  const cancel = (pointer: PointerEvent) => {
    if (pointer.pointerId === pointerId) finish(true);
  };
  const blur = () => finish(true);
  const key = (keyboard: KeyboardEvent) => {
    if (keyboard.key !== 'Escape' || keyboard.isComposing) return;
    keyboard.preventDefault();
    keyboard.stopPropagation();
    finish(true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', blur);
  window.addEventListener('keydown', key, true);
  return cleanup;
}
