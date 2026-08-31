import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface WorkspaceSharedSidebarContextValue {
  enabled: boolean;
  host: HTMLDivElement | null;
}

const WorkspaceSharedSidebarContext = createContext<WorkspaceSharedSidebarContextValue>({
  enabled: false,
  host: null,
});

interface Props {
  children: ReactNode;
  enabled: boolean;
}

export function WorkspaceSharedSidebar({ children, enabled }: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ enabled, host: enabled ? host : null }), [enabled, host]);

  return (
    <WorkspaceSharedSidebarContext.Provider value={value}>
      <div className="flex size-full min-h-0 min-w-0 overflow-hidden">
        {enabled && (
          <div
            ref={setHost}
            className="h-full w-64 min-h-0 shrink-0 overflow-hidden empty:hidden"
            data-workspace-shared-sidebar
          />
        )}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </WorkspaceSharedSidebarContext.Provider>
  );
}

export function useWorkspaceSharedSidebar() {
  return useContext(WorkspaceSharedSidebarContext);
}
