import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { workspaceShortcutLayerOpen } from '@/renderer/commands/shortcut-context';
import { useWorkspaceTabMotion } from '@/renderer/components/workspace/useWorkspaceTabMotion';
import { WorkspaceTabDragSession, type TabDragView } from '@/renderer/components/workspace/workspace-tab-drag-session';
import {
  workspaceTabOrderKey,
  type WorkspaceRuntimeGroup,
  type WorkspaceTabMove,
} from '@/renderer/components/workspace/workspace-state';

export function useWorkspaceTabDrag(
  group: WorkspaceRuntimeGroup,
  layoutKey: string,
  onReorder: (id: string, move: WorkspaceTabMove) => void,
) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const session = useRef<WorkspaceTabDragSession | null>(null);
  const mounted = useRef(true);
  const [view, setView] = useState<TabDragView | null>(null);
  const [openPinned, setOpenPinned] = useState(false);
  const [movedId, setMovedId] = useState<string | null>(null);
  const orderKey = workspaceTabOrderKey(group.tabs);
  const scope = `${group.id}:${group.activeTabId}:${orderKey}:${layoutKey}`;
  const currentScope = useRef(scope);
  const motion = useWorkspaceTabMotion(`${orderKey}:${view?.phase ?? 'idle'}`, root, list);

  useLayoutEffect(() => {
    const changed = currentScope.current !== scope;
    currentScope.current = scope;
    if (session.current?.settling) {
      if (changed && session.current.hasSettled) session.current.dispose();
      else session.current.settle();
    } else if (session.current && !session.current.isValid()) {
      session.current.dispose();
      session.current = null;
    }
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current?.dispose();
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent) {
    if (event.button !== 0 || event.pointerType === 'touch' || event.isPrimary === false) return;
    const handle =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-workspace-tab-handle]') : null;
    const source = handle?.closest<HTMLElement>('[data-workspace-tab-item]');
    const tab = group.tabs.find((candidate) => candidate.id === handle?.dataset.workspaceTabHandle);
    if (!source || !tab) return;
    session.current?.dispose();
    motion.cancel();
    setMovedId(null);
    session.current = new WorkspaceTabDragSession(
      {
        root: () => root.current,
        list: () => list.current,
        ghost: () => ghost.current,
        indicator: () => indicator.current,
        valid: () => currentScope.current === scope,
        view: (next) => {
          if (mounted.current) setView(next);
        },
        openPinned: (next) => {
          if (mounted.current) setOpenPinned(next);
        },
        commit: (id, placement) => {
          const region = group.tabs.filter((candidate) => Boolean(candidate.pinned) === placement.pinned);
          const index = region.findIndex((candidate) => candidate.id === id);
          if (index >= 0 && (region[index + 1]?.id ?? null) === placement.beforeId) return;
          onReorder(id, placement);
          setMovedId(id);
        },
        capture: (id) => motion.capture(id),
        restoreFocus: (node, id) => {
          if (workspaceShortcutLayerOpen()) return;
          if (node?.isConnected) node.focus({ preventScroll: true });
          else if (document.activeElement === document.body) {
            const target = Array.from(
              root.current?.querySelectorAll<HTMLElement>('[data-workspace-tab-handle]') ?? [],
            ).find((candidate) => candidate.dataset.workspaceTabHandle === id);
            (target ?? root.current?.querySelector<HTMLElement>('[data-workspace-pinned-overflow]'))?.focus({
              preventScroll: true,
            });
          }
        },
      },
      tab,
      orderKey,
      event.clientX,
      event.clientY,
      source,
      event.nativeEvent,
    );
  }

  return {
    root,
    list,
    ghost,
    indicator,
    view,
    activeId: view?.id,
    dragging: Boolean(view),
    moving: view?.phase === 'drag',
    openPinned,
    movedId,
    onPointerDown,
    prepareChange: motion.capture,
    orderKey,
  };
}
