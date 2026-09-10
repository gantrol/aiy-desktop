import { createContext, useContext, useState, type ReactNode, type CSSProperties } from 'react';

const OverlayPortalContainerContext = createContext<HTMLElement | null>(null);

export const OVERLAY_SURFACE_SELECTOR = '[data-overlay-surface]';

export function useOverlayPortalContainer() {
  return useContext(OverlayPortalContainerContext);
}

export function ModalOverlayScope({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const parentContainer = useOverlayPortalContainer();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  return (
    <OverlayPortalContainerContext.Provider value={container ?? parentContainer}>
      {children}
      <div
        ref={setContainer}
        style={style}
        data-overlay-root="modal"
        // Radix hideOthers must keep this sibling host accessible to nested dialogs and menus.
        // "off" keeps the host exempt without announcing every popup mutation as a live update.
        aria-live="off"
        className="pointer-events-none fixed inset-0 z-modal-nested"
      />
    </OverlayPortalContainerContext.Provider>
  );
}
