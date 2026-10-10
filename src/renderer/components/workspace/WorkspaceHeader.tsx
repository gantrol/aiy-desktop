import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { WorkspaceSidebarMotion } from '@/renderer/components/workspace/WorkspaceSidebarMotion';
import { useWorkspaceSidebarLayout } from '@/renderer/components/workspace/useWorkspaceSidebarLayout';

interface SidebarLayout {
  tabId: string;
  width: number | null;
  animate: boolean;
}

const HeaderContext = createContext<{
  sidebars: ReadonlyMap<string, SidebarLayout>;
  register(sidebar: SidebarLayout): () => void;
} | null>(null);
const TabContext = createContext<string | null>(null);
const NestedSidebarContext = createContext(false);

export function WorkspaceSidebarContent({ children }: { children: ReactNode }) {
  return <NestedSidebarContext value={true}>{children}</NestedSidebarContext>;
}

/** Tabs own the top row; sidebar geometry and sessions remain scoped to their tab. */
export function WorkspaceHeader({
  tabId,
  navigationKey,
  surfaceKey,
  strip,
  children,
}: {
  tabId: string;
  navigationKey: string;
  surfaceKey: string;
  strip: ReactNode;
  children: ReactNode;
}) {
  const [sidebars, setSidebars] = useState(new Map<string, SidebarLayout>());
  const register = useCallback((next: SidebarLayout) => {
    setSidebars((current) => new Map(current).set(next.tabId, next));
    return () =>
      setSidebars((current) => {
        if (current.get(next.tabId) !== next) return current;
        const remaining = new Map(current);
        remaining.delete(next.tabId);
        return remaining;
      });
  }, []);
  const value = useMemo(() => ({ sidebars, register }), [sidebars, register]);
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
        {strip && <div className="flex min-w-0 shrink-0">{strip}</div>}
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
