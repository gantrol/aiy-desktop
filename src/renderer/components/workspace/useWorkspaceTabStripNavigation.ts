import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { shortcutEventAvailable } from '@/renderer/commands/app-shortcuts';
import { workspaceShortcutLayerOpen } from '@/renderer/commands/shortcut-context';
import {
  workspaceTabFocusTarget,
  type WorkspaceTabStripProps,
} from '@/renderer/components/workspace/workspace-tab-strip';

interface Options {
  targets: readonly { id: string }[];
  activeTargetId: string;
  pinnedLayout: string;
  vertical: boolean;
  onClose: WorkspaceTabStripProps['onClose'];
  clearPendingActivation(tabId: string): void;
}

export function useWorkspaceTabStripNavigation({
  targets,
  activeTargetId,
  pinnedLayout,
  vertical,
  onClose,
  clearPendingActivation,
}: Options) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const closeFrames = useRef(new Set<number>());
  const mounted = useRef(false);
  const focusedButton = useRef<HTMLButtonElement | null>(null);
  const restoreTarget = useRef<string | undefined>(undefined);
  const [focusedId, setFocusedId] = useState(activeTargetId);
  const focusableId = targets.some((tab) => tab.id === focusedId) ? focusedId : activeTargetId;

  useEffect(() => {
    setFocusedId(activeTargetId);
    buttons.current.get(activeTargetId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTargetId, vertical]);

  useLayoutEffect(() => {
    if (
      !focusedButton.current ||
      focusedButton.current.isConnected ||
      document.activeElement !== document.body ||
      workspaceShortcutLayerOpen()
    )
      return;
    const target = restoreTarget.current ?? focusedId;
    (buttons.current.get(target) ?? buttons.current.get(activeTargetId))?.focus({ preventScroll: true });
  }, [pinnedLayout, focusedId, activeTargetId]);

  useEffect(() => {
    mounted.current = true;
    const frames = closeFrames.current;
    return () => {
      mounted.current = false;
      frames.forEach(cancelAnimationFrame);
      frames.clear();
    };
  }, []);

  function restoreCloseFocus(nextId = activeTargetId) {
    if (!mounted.current) return;
    restoreTarget.current = nextId;
    const frame = requestAnimationFrame(() => {
      closeFrames.current.delete(frame);
      if (restoreTarget.current === nextId) restoreTarget.current = undefined;
      if (!mounted.current || workspaceShortcutLayerOpen()) return;
      if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
      const entries = [...buttons.current.values()];
      const next = buttons.current.get(nextId) ?? entries.find((button) => button.tabIndex === 0) ?? entries[0];
      next?.focus({ preventScroll: true });
    });
    closeFrames.current.add(frame);
  }

  function closeTab(tabId: string, focusNext = false) {
    clearPendingActivation(tabId);
    const index = targets.findIndex((tab) => tab.id === tabId);
    const nextId = targets[index + 1]?.id ?? targets[index - 1]?.id;
    onClose(tabId, focusNext ? () => restoreCloseFocus(nextId) : undefined);
  }

  function focusTab(event: KeyboardEvent<HTMLButtonElement>, targetId: string, canClose = true) {
    if (
      event.repeat ||
      !shortcutEventAvailable(event.nativeEvent) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (event.key === 'Delete' && canClose) {
      event.preventDefault();
      event.stopPropagation();
      closeTab(targetId, true);
      return;
    }
    const nextId = workspaceTabFocusTarget(targets, targetId, event.key, vertical ? 'vertical' : 'horizontal');
    if (!nextId) return;
    event.preventDefault();
    event.stopPropagation();
    buttons.current.get(nextId)?.focus();
  }

  function register(id: string, node: HTMLButtonElement | null) {
    if (node) buttons.current.set(id, node);
    else buttons.current.delete(id);
  }

  function onFocus(id: string) {
    focusedButton.current = buttons.current.get(id) ?? null;
    restoreTarget.current = undefined;
    setFocusedId(id);
  }

  return { buttons, focusableId, setFocusedId, onFocus, restoreCloseFocus, closeTab, focusTab, register };
}
