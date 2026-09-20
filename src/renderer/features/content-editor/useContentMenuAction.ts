import { useRef } from 'react';

/** Commands choose their destination focus; cancelling a menu restores its trigger. */
export function useContentMenuAction() {
  const performed = useRef(false);
  return {
    run(action: () => void) {
      performed.current = true;
      action();
    },
    onCloseAutoFocus(event: Event) {
      if (performed.current) event.preventDefault();
      performed.current = false;
    },
  };
}
