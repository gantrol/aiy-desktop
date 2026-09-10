import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { PetalDrawerFrame, PetalDrawerState } from '@/shared/contracts/petal-drawer';
import { DRAWER_ROW, type useDrawerScroll } from '@/renderer/features/desktop-petals/use-drawer-scroll';
interface Options {
  frame: PetalDrawerFrame;
  state: PetalDrawerState;
  menu: unknown;
  enabled: boolean;
  focused: string | null;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  scroll: ReturnType<typeof useDrawerScroll>;
  setFocused(id: string): void;
  onError(error: unknown): void;
  showMenu(point: { x: number; y: number }, id?: string): Promise<void>;
}
export function useDrawerKeyboard({
  frame,
  state,
  menu,
  enabled,
  focused,
  buttons,
  scroll,
  setFocused,
  onError,
  showMenu,
}: Options) {
  const handle = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (frame.progress === 0 && !frame.menu && document.hasFocus()) handle.current?.focus();
  }, [frame.progress, frame.menu]);
  const keyboard = (event: KeyboardEvent) => {
    if (menu || event.defaultPrevented) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const element = event.target as HTMLElement;
      const id = [...buttons.current].find(([, button]) => button === element)?.[0];
      const rect = element.getBoundingClientRect();
      void showMenu(
        { x: Math.round(window.screenX + rect.left + rect.width / 2), y: Math.round(window.screenY + rect.bottom) },
        id,
      );
      return;
    }
    if (frame.moving) {
      const movement = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key];
      if (movement || event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        void window.desktopPetals
          .drawer({
            kind: 'move-key',
            dx: movement?.[0] ?? 0,
            dy: movement?.[1] ?? 0,
            finish: event.key === 'Enter',
            cancel: event.key === 'Escape',
          })
          .catch(onError);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      void window.desktopPetals
        .drawer({ kind: 'collapse', reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
        .catch(onError);
      return;
    }
    if (!enabled || !state.items.length) return;
    if (event.key === 'Tab') {
      const firstId = state.items[Math.round(scroll.top / DRAWER_ROW) * frame.columns]?.id;
      if (!event.shiftKey && event.target === handle.current && firstId) {
        event.preventDefault();
        buttons.current.get(firstId)?.focus();
      } else if (event.shiftKey && firstId && event.target === buttons.current.get(firstId)) {
        event.preventDefault();
        handle.current?.focus();
      }
      return;
    }
    const index = Math.max(
      0,
      state.items.findIndex((item) => item.id === focused),
    );
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -frame.columns,
      ArrowDown: frame.columns,
      PageUp: -frame.rows * frame.columns,
      PageDown: frame.rows * frame.columns,
      Home: -state.items.length,
      End: state.items.length,
    };
    if (event.key in offsets) {
      event.preventDefault();
      const next = Math.max(0, Math.min(state.items.length - 1, index + offsets[event.key]));
      const id = state.items[next].id;
      setFocused(id);
      scroll.reveal(next);
      requestAnimationFrame(() => buttons.current.get(id)?.focus());
    }
  };

  return { handle, keyboard };
}
