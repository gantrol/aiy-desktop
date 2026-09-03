import { createContext, useContext, useState, type ReactNode } from 'react';

const OverlayPortalContainerContext = createContext<HTMLElement | null>(null);

export const OVERLAY_SURFACE_SELECTOR = '[data-overlay-surface]';

export function useOverlayPortalContainer() {
  return useContext(OverlayPortalContainerContext);
}

export function ModalOverlayScope({ children }: { children: ReactNode }) {
  const parentContainer = useOverlayPortalContainer();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  return (
    <OverlayPortalContainerContext.Provider value={container ?? parentContainer}>
      {children}
      <div ref={setContainer} data-overlay-root="modal" className="pointer-events-none fixed inset-0 z-modal-nested" />
    </OverlayPortalContainerContext.Provider>
  );
}
