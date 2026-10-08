import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceSidebarMotion } from '@/renderer/components/workspace/WorkspaceSidebarMotion';
import { useWorkspaceSidebarLayout } from '@/renderer/components/workspace/useWorkspaceSidebarLayout';

interface SidebarHeader {
  tabId: string;
  width: number | null;
  animate: boolean;
}

const HeaderContext = createContext<{
  enabled: boolean;
  hosts: ReadonlyMap<string, HTMLDivElement>;
  sidebars: ReadonlyMap<string, SidebarHeader>;
  register(sidebar: SidebarHeader): () => void;
} | null>(null);
const TabContext = createContext<string | null>(null);
const NestedSidebarContext = createContext(false);

export function WorkspaceSidebarContent({ children }: { children: ReactNode }) {
  return <NestedSidebarContext value={true}>{children}</NestedSidebarContext>;
}

function SidebarHeaderSlot({
  tabId,
  visible,
  onHostChange,
}: {
  tabId: string;
  visible: boolean;
  onHostChange(tabId: string, host: HTMLDivElement | null): void;
}) {
  const ref = useCallback((host: HTMLDivElement | null) => onHostChange(tabId, host), [tabId, onHostChange]);
  return (
    <div
      ref={ref}
      data-workspace-sidebar-tab-id={tabId}
      hidden={!visible}
      inert={!visible}
      className="h-full w-full overflow-hidden"
    />
  );
}

/** The header moves; sidebar selection, scroll and editing sessions stay inside their tab. */
export function WorkspaceHeader({
  tabId,
  mountedTabIds,
  enabled,
  navigationKey,
  surfaceKey,
  strip,
  children,
}: {
  tabId: string;
  mountedTabIds: readonly string[];
  enabled: boolean;
  navigationKey: string;
  surfaceKey: string;
  strip: ReactNode;
  children: ReactNode;
}) {
  const [hosts, setHosts] = useState(new Map<string, HTMLDivElement>());
  const [sidebars, setSidebars] = useState(new Map<string, SidebarHeader>());
  const onHostChange = useCallback((id: string, host: HTMLDivElement | null) => {
    setHosts((current) => {
      const next = new Map(current);
      if (host) next.set(id, host);
      else next.delete(id);
      return next;
    });
  }, []);
  const register = useCallback((next: SidebarHeader) => {
    setSidebars((current) => new Map(current).set(next.tabId, next));
    return () =>
      setSidebars((current) => {
        if (current.get(next.tabId) !== next) return current;
        const remaining = new Map(current);
        remaining.delete(next.tabId);
        return remaining;
      });
  }, []);
  const value = useMemo(() => ({ enabled, hosts, sidebars, register }), [enabled, hosts, sidebars, register]);
  const sidebar = sidebars.get(tabId);
  const layout = useWorkspaceSidebarLayout(sidebar ? sidebar.width : 0, sidebar?.animate ?? false, navigationKey);
  return (
    <HeaderContext value={value}>
      <WorkspaceSidebarMotion
        tabId={tabId}
        hasSidebar={(sidebar?.width ?? 0) > 0}
        navigationKey={layout.navigationKey}
        surfaceKey={surfaceKey}
        width={layout.width}
        animate={layout.animate}
      >
        <div className="flex min-w-0 shrink-0">
          <div
            data-workspace-sidebar-header
            hidden={!enabled || layout.width === 0}
            className="h-9 shrink-0 overflow-hidden border-r border-b bg-surface-sunken"
            style={{ width: 'var(--workspace-sidebar-width)' }}
          >
            {mountedTabIds.map((id) => (
              <SidebarHeaderSlot key={id} tabId={id} visible={enabled && id === tabId} onHostChange={onHostChange} />
            ))}
          </div>
          {strip}
        </div>
        {children}
      </WorkspaceSidebarMotion>
    </HeaderContext>
  );
}

export function WorkspaceHeaderTabScope({ tabId, children }: { tabId: string; children: ReactNode }) {
  return <TabContext value={tabId}>{children}</TabContext>;
}

/** Reuse the same resolved width as the sidebar's layout, including its collapsed rail. */
export function useWorkspaceSidebarWidth(width: number, animate = true) {
  const context = useContext(HeaderContext);
  const tabId = useContext(TabContext);
  const nested = useContext(NestedSidebarContext);
  const register = context?.register;
  useLayoutEffect(() => {
    if (!register || !tabId || nested) return;
    return register({ tabId, width, animate });
  }, [register, tabId, nested, width, animate]);
  return context && !nested ? `var(--workspace-sidebar-width, ${width}px)` : `${width}px`;
}

/** Only whole-screen loading owns an unresolved layout; detail loading keeps its existing sidebar. */
export function WorkspaceSidebarLoading({ children }: { children: ReactNode }) {
  const register = useContext(HeaderContext)?.register;
  const tabId = useContext(TabContext);
  const nested = useContext(NestedSidebarContext);
  useLayoutEffect(() => {
    if (!register || !tabId || nested) return;
    return register({ tabId, width: null, animate: false });
  }, [register, tabId, nested]);
  return children;
}

export function useWorkspaceSidebarHeaderHost() {
  const context = useContext(HeaderContext);
  const tabId = useContext(TabContext);
  const nested = useContext(NestedSidebarContext);
  // Keep each mounted tab's portal target stable so switching tabs does not remount search controls.
  return !nested && context?.enabled && tabId && Boolean(context.sidebars.get(tabId)?.width)
    ? (context.hosts.get(tabId) ?? null)
    : null;
}

export function WorkspaceSidebarHeader({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const host = useWorkspaceSidebarHeaderHost();
  return enabled && host ? createPortal(children, host) : children;
}
