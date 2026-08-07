import { useCallback, useEffect, useMemo, type MouseEventHandler } from 'react';

type ClickAction = () => void;

export interface DeferredSingleDoubleClickHandlers<Element extends HTMLElement> {
  onClick: MouseEventHandler<Element>;
  onDoubleClick: MouseEventHandler<Element>;
}

export interface DeferredSingleDoubleClickCoordinator {
  cancel(): void;
  click(detail: number, onSingleClick: ClickAction): void;
  doubleClick(onDoubleClick: ClickAction): void;
}

export function createDeferredSingleDoubleClick(delayMs = 280): DeferredSingleDoubleClickCoordinator {
  let pendingClick: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (pendingClick === null) return;
    clearTimeout(pendingClick);
    pendingClick = null;
  }

  return {
    cancel,
    click(detail, onSingleClick) {
      if (detail === 0) {
        cancel();
        onSingleClick();
        return;
      }
      if (detail !== 1) {
        cancel();
        return;
      }
      cancel();
      pendingClick = setTimeout(() => {
        pendingClick = null;
        onSingleClick();
      }, delayMs);
    },
    doubleClick(onDoubleClick) {
      cancel();
      onDoubleClick();
    },
  };
}

/**
 * Coordinates single and double click for any number of rows without requiring
 * a hook call per row. Keyboard-generated clicks have `detail === 0`, so they
 * run immediately instead of inheriting the pointer double-click delay.
 */
export function useDeferredSingleDoubleClick(delayMs = 280) {
  const coordinator = useMemo(() => createDeferredSingleDoubleClick(delayMs), [delayMs]);
  const cancelPendingClick = useCallback(() => coordinator.cancel(), [coordinator]);

  useEffect(() => cancelPendingClick, [cancelPendingClick]);

  const handlers = useCallback(
    function handlersFor<Element extends HTMLElement>(
      onSingleClick: ClickAction,
      onDoubleClick: ClickAction,
    ): DeferredSingleDoubleClickHandlers<Element> {
      return {
        onClick(event) {
          coordinator.click(event.detail, onSingleClick);
        },
        onDoubleClick() {
          coordinator.doubleClick(onDoubleClick);
        },
      };
    },
    [coordinator],
  );

  return { handlers, cancelPendingClick };
}
