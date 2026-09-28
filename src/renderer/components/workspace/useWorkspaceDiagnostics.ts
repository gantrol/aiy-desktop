import { useEffect, useRef } from 'react';
import { recordRendererDiagnostic } from '@/renderer/lib/rendererDiagnostics';
import {
  activeLocation,
  activeWorkspaceTab,
  type WorkspaceRuntimeState,
} from '@/renderer/components/workspace/workspace-state';

/** Records navigation identities and memory counters without article content. */
export function useWorkspaceDiagnostics(state: WorkspaceRuntimeState | null) {
  const diagnosticKey = useRef('');
  useEffect(() => {
    if (!state) return;
    const key = JSON.stringify([
      state.spaceId,
      state.activeGroupId,
      state.groups.map((group) => [
        group.id,
        group.activeTabId,
        group.tabsCollapsed,
        group.tabs.map((tab) => [tab.id, activeLocation(tab).view]),
      ]),
    ]);
    if (key === diagnosticKey.current) return;
    diagnosticKey.current = key;
    const tab = activeWorkspaceTab(state);
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } })
      .memory;
    recordRendererDiagnostic('workspace-navigation', {
      groupId: state.activeGroupId,
      tabId: tab.id,
      view: activeLocation(tab).view,
      groupCount: state.groups.length,
      tabCount: state.groups.reduce((count, group) => count + group.tabs.length, 0),
      collapsedCount: state.groups.filter((group) => group.tabsCollapsed).length,
      usedHeapBytes: memory?.usedJSHeapSize,
      heapLimitBytes: memory?.jsHeapSizeLimit,
    });
  }, [state]);
}
