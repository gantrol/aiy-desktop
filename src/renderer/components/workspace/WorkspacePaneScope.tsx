import { createContext, useContext, useState, type ReactNode } from 'react';

const WorkspacePaneContainer = createContext<HTMLElement | null>(null);
const WorkspaceVisibility = createContext(true);

/** Retained tabs keep editing state, but may not start background reads. */
export function useWorkspaceVisible() {
  return useContext(WorkspaceVisibility);
}

export function useWorkspacePaneContainer() {
  return useContext(WorkspacePaneContainer);
}

/** Each tab owns its overlays, including when it is hidden or moved to another split. */
export function WorkspacePaneScope({ children, visible = true }: { children: ReactNode; visible?: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <WorkspaceVisibility value={visible}>
      <WorkspacePaneContainer.Provider value={container}>
        <div className="relative flex size-full min-h-0 min-w-0 flex-col">
          {children}
          <div
            ref={setContainer}
            data-workspace-pane-overlays=""
            className="@container/workspace-pane pointer-events-none absolute inset-0 z-modal isolate transform-gpu"
          />
        </div>
      </WorkspacePaneContainer.Provider>
    </WorkspaceVisibility>
  );
}
