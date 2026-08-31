import { useCallback, useEffect, useRef, useState } from 'react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export function useWorkspaceTabActivationTransition(activeTabId: string, onActivate: (tabId: string) => void) {
  const activate = useStableCallback(onActivate);
  const [pendingTabId, setPendingTabId] = useState<string | null>(null);
  const pendingTabIdRef = useRef<string | null>(null);
  const firstFrameRef = useRef<number | null>(null);
  const secondFrameRef = useRef<number | null>(null);

  const cancelScheduledActivation = useCallback(() => {
    if (firstFrameRef.current !== null) cancelAnimationFrame(firstFrameRef.current);
    if (secondFrameRef.current !== null) cancelAnimationFrame(secondFrameRef.current);
    firstFrameRef.current = null;
    secondFrameRef.current = null;
  }, []);

  const clearPendingActivation = useCallback(
    (tabId?: string) => {
      if (tabId && pendingTabIdRef.current !== tabId) return;
      cancelScheduledActivation();
      pendingTabIdRef.current = null;
      setPendingTabId(null);
    },
    [cancelScheduledActivation],
  );

  const requestActivation = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) {
        clearPendingActivation();
        activate(tabId);
        return;
      }
      if (pendingTabIdRef.current === tabId) return;

      cancelScheduledActivation();
      pendingTabIdRef.current = tabId;
      setPendingTabId(tabId);

      firstFrameRef.current = requestAnimationFrame(() => {
        firstFrameRef.current = null;
        secondFrameRef.current = requestAnimationFrame(() => {
          secondFrameRef.current = null;
          if (pendingTabIdRef.current !== tabId) return;
          pendingTabIdRef.current = null;
          setPendingTabId(null);
          activate(tabId);
        });
      });
    },
    [activate, activeTabId, cancelScheduledActivation, clearPendingActivation],
  );

  useEffect(() => {
    if (pendingTabId === activeTabId) clearPendingActivation(pendingTabId);
  }, [activeTabId, clearPendingActivation, pendingTabId]);

  useEffect(
    () => () => {
      cancelScheduledActivation();
      pendingTabIdRef.current = null;
    },
    [cancelScheduledActivation],
  );

  return { pendingTabId, requestActivation, clearPendingActivation };
}
