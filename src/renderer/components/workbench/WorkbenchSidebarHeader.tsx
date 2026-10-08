import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { WorkspaceSidebarHeader, useWorkspaceSidebarHeaderHost } from '@/renderer/components/workspace/WorkspaceHeader';
import { cn } from '@/renderer/lib/utils';

export const sidebarRailWidth = 52;

const SidebarContext = createContext<{ toggle: ReactNode; expanded: boolean; docked?: boolean } | null>(null);
export const WorkbenchSidebarHeaderScope = SidebarContext.Provider;

/** Keep the disclosure button on the same axis in the expanded header and the rail. */
export function WorkbenchSidebarHeader({ className, children, ...props }: ComponentProps<'header'>) {
  const sidebar = useContext(SidebarContext);
  const availableHost = useWorkspaceSidebarHeaderHost();
  const host = sidebar?.docked === false ? null : availableHost;
  return (
    <WorkspaceSidebarHeader enabled={sidebar?.docked !== false}>
      <header
        {...props}
        className={cn('flex h-9 min-w-0 shrink-0 items-center bg-surface-sunken', !host && 'border-b', className)}
      >
        {sidebar && <div className="flex h-full w-[52px] shrink-0 items-center justify-center">{sidebar.toggle}</div>}
        {(!sidebar || sidebar.expanded) && (
          <div className="relative flex h-full min-w-0 flex-1 items-center gap-1 pr-2.5">{children}</div>
        )}
      </header>
    </WorkspaceSidebarHeader>
  );
}
