import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { WorkspaceArrangementDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { clampWorkspaceRatio, workspaceSplitTracks } from '@/renderer/components/workspace/workspaceSplitGeometry';
import './workspace-split.css';

interface Props {
  arrangement: WorkspaceArrangementDto;
  childrenByGroupId: ReadonlyMap<string, ReactNode>;
  collapsedGroupId?: string;
  onRatioCommit(ratio: number): void;
}

export function WorkspaceSplitLayout({ arrangement, childrenByGroupId, collapsedGroupId, onRatioCommit }: Props) {
  const { messages } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [liveRatio, setLiveRatio] = useState(arrangement.kind === 'split' ? arrangement.ratio : 5_000);
  const [resizing, setResizing] = useState(false);
  const axis = arrangement.kind === 'split' ? arrangement.axis : null;

  const savedRatio = arrangement.kind === 'split' ? arrangement.ratio : 5_000;
  const firstGroupId = arrangement.kind === 'split' ? arrangement.groupIds[0] : arrangement.groupId;
  const secondGroupId = arrangement.kind === 'split' ? arrangement.groupIds[1] : null;

  useLayoutEffect(() => {
    resizeCleanupRef.current?.();
    setLiveRatio(savedRatio);
  }, [savedRatio, axis, firstGroupId, secondGroupId]);

  useLayoutEffect(() => {
    resizeCleanupRef.current?.();
  }, [collapsedGroupId]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  if (arrangement.kind === 'single') {
    return <div className="size-full min-h-0 min-w-0">{childrenByGroupId.get(arrangement.groupId)}</div>;
  }

  const columns = arrangement.axis === 'columns';
  const firstCollapsed = collapsedGroupId === arrangement.groupIds[0];
  const secondCollapsed = collapsedGroupId === arrangement.groupIds[1];
  const folded = firstCollapsed || secondCollapsed;
  const tracks = workspaceSplitTracks(liveRatio, firstCollapsed, secondCollapsed, columns);

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.isPrimary === false || folded) return;
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    resizeCleanupRef.current?.();
    const pointerId = event.pointerId;
    const originalRatio = liveRatio;
    let nextRatio = liveRatio;
    let active = true;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = columns ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    setResizing(true);
    const move = (pointer: globalThis.PointerEvent) => {
      if (!active || pointer.pointerId !== pointerId) return;
      const bounds = container.getBoundingClientRect();
      const position = columns ? pointer.clientX - bounds.left : pointer.clientY - bounds.top;
      const length = (columns ? bounds.width : bounds.height) - 1;
      if (length > 0) {
        nextRatio = clampWorkspaceRatio((position / length) * 10_000);
        setLiveRatio(nextRatio);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key, true);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      resizeCleanupRef.current = null;
    };
    const finish = (cancelled: boolean) => {
      if (!active) return;
      active = false;
      cleanup();
      setResizing(false);
      if (cancelled) setLiveRatio(originalRatio);
      else onRatioCommit(nextRatio);
    };
    const up = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId === pointerId) finish(false);
    };
    const cancel = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId === pointerId) finish(true);
    };
    const blur = () => finish(true);
    const key = (keyboard: globalThis.KeyboardEvent) => {
      if (keyboard.key !== 'Escape' || keyboard.isComposing) return;
      keyboard.preventDefault();
      keyboard.stopPropagation();
      finish(true);
    };
    resizeCleanupRef.current = () => finish(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key, true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (folded || resizing || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const delta =
      (columns && event.key === 'ArrowLeft') || (!columns && event.key === 'ArrowUp')
        ? -250
        : (columns && event.key === 'ArrowRight') || (!columns && event.key === 'ArrowDown')
          ? 250
          : 0;
    const next = event.key === 'Home' ? 2_500 : event.key === 'End' ? 7_500 : clampWorkspaceRatio(liveRatio + delta);
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    event.stopPropagation();
    setLiveRatio(next);
    onRatioCommit(next);
  }

  return (
    <div
      ref={containerRef}
      data-resizing={resizing}
      data-split-axis={arrangement.axis}
      className="workspace-split-layout grid size-full min-h-0 min-w-0 overflow-hidden transition-[grid-template-columns,grid-template-rows] delay-[60ms] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] data-[resizing=true]:transition-none motion-reduce:transition-none"
      style={
        columns
          ? { gridTemplateColumns: tracks, gridTemplateRows: 'minmax(0, 1fr)' }
          : { gridTemplateRows: tracks, gridTemplateColumns: 'minmax(0, 1fr)' }
      }
    >
      <div className="min-h-0 min-w-0 overflow-hidden">{childrenByGroupId.get(arrangement.groupIds[0])}</div>
      <div
        role="separator"
        tabIndex={folded ? -1 : 0}
        aria-hidden={folded}
        aria-orientation={columns ? 'vertical' : 'horizontal'}
        aria-label={columns ? messages.app.workspace.resizeColumns : messages.app.workspace.resizeRows}
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(liveRatio / 100)}
        className={cn(
          'group relative z-20 touch-none bg-border-strong outline-none transition-opacity delay-200 duration-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none',
          columns ? 'cursor-col-resize' : 'cursor-row-resize',
          folded && 'pointer-events-none opacity-0 delay-0 duration-[60ms]',
        )}
        onPointerDown={beginResize}
        onKeyDown={handleKeyDown}
      >
        <span
          className={cn(
            'absolute bg-transparent group-hover:bg-selected-foreground/20',
            columns ? 'inset-y-0 -left-1 w-2' : 'inset-x-0 -top-1 h-2',
          )}
        />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">{childrenByGroupId.get(arrangement.groupIds[1])}</div>
    </div>
  );
}
