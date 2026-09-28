import { useEffect, useRef, type ComponentProps } from 'react';
import { DropdownMenuContent, DropdownMenuTrigger } from '@/renderer/components/ui/dropdown-menu';
import { useHoverIntent } from '@/renderer/components/ui/use-hover-intent';

/** Adds pointer intent to a controlled menu while retaining Radix keyboard and touch behavior. */
export function useHoverDropdown(open: boolean, onOpenChange: (open: boolean) => void, disabled = false) {
  const intent = useHoverIntent();
  const content = useRef<HTMLDivElement>(null);
  const openedByHover = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const current = useRef({ open, onOpenChange, disabled });
  current.current = { open, onOpenChange, disabled };

  useEffect(() => {
    intent.cancel();
    if (disabled && open) current.current.onOpenChange(false);
  }, [disabled, open, intent]);

  const changeOpen = (value: boolean) => {
    intent.cancel();
    if (!value || !current.current.disabled) current.current.onOpenChange(value);
  };
  const leave = () => {
    intent.cancel();
    if (openedByHover.current && current.current.open) intent.schedule(() => changeOpen(false));
  };
  const takeFocus = () => {
    intent.cancel();
    openedByHover.current = false;
    content.current?.focus({ preventScroll: true });
  };
  const triggerProps: ComponentProps<typeof DropdownMenuTrigger> = {
    onPointerEnter: (event) => {
      intent.cancel();
      if (event.pointerType !== 'mouse' || event.buttons || current.current.open || current.current.disabled) return;
      intent.schedule(() => {
        if (current.current.disabled) return;
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        openedByHover.current = true;
        changeOpen(true);
      });
    },
    onPointerLeave: leave,
    onPointerCancel: intent.cancel,
    onPointerDown: (event) => {
      intent.cancel();
      if (event.button !== 0 || event.ctrlKey || current.current.disabled) return;
      if (current.current.open && openedByHover.current) {
        // A click pins a menu that was already revealed by hover.
        event.preventDefault();
        takeFocus();
      } else openedByHover.current = false;
    },
    onKeyDown: (event) => {
      intent.cancel();
      if (current.current.disabled) return;
      openedByHover.current = false;
      if (current.current.open && ['Enter', ' ', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        takeFocus();
      }
    },
  };
  const contentProps: ComponentProps<typeof DropdownMenuContent> = {
    ref: content,
    onPointerEnter: intent.cancel,
    onPointerLeave: leave,
    onPointerCancel: intent.cancel,
    onPointerDownCapture: () => {
      intent.cancel();
      openedByHover.current = false;
    },
    onKeyDownCapture: () => {
      intent.cancel();
      openedByHover.current = false;
    },
    onCloseAutoFocus: (event) => {
      if (!openedByHover.current) return;
      event.preventDefault();
      // Do not take focus back from a newly opened menu or a clicked control.
      if (document.activeElement === document.body && previousFocus.current?.isConnected)
        previousFocus.current.focus({ preventScroll: true });
    },
  };
  return { rootProps: { open: open && !disabled, onOpenChange: changeOpen }, triggerProps, contentProps };
}
