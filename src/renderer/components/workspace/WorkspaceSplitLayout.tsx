import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { WorkspaceArrangementDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  arrangement: WorkspaceArrangementDto;
  childrenByGroupId: ReadonlyMap<string, ReactNode>;
  onRatioCommit(ratio: number): void;
}

function clampRatio(ratio: number) {
  return Math.min(Math.max(Math.round(ratio), 2_500), 7_500);
}

export function WorkspaceSplitLayout({ arrangement, childrenByGroupId, onRatioCommit }: Props) {
  const { messages } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [liveRatio, setLiveRatio] = useState(arrangement.kind === 'split' ? arrangement.ratio : 5_000);
  const ratioRef = useRef(liveRatio);
  ratioRef.current = liveRatio;

  useEffect(() => {
    if (arrangement.kind === 'split') setLiveRatio(arrangement.ratio);
  }, [arrangement]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  if (arrangement.kind === 'single') {
    return <div className="size-full min-h-0 min-w-0">{childrenByGroupId.get(arrangement.groupId)}</div>;
  }

  const columns = arrangement.axis === 'columns';
  const first = childrenByGroupId.get(arrangement.groupIds[0]);
  const second = childrenByGroupId.get(arrangement.groupIds[1]);

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    resizeCleanupRef.current?.();
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = columns ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    const move = (moveEvent: globalThis.PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      const position = columns ? moveEvent.clientX - bounds.left : moveEvent.clientY - bounds.top;
      const length = columns ? bounds.width : bounds.height;
      if (length > 0) setLiveRatio(clampRatio((position / length) * 10_000));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      resizeCleanupRef.current = null;
    };
    const finish = () => {
      cleanup();
      onRatioCommit(ratioRef.current);
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta =
      (columns && event.key === 'ArrowLeft') || (!columns && event.key === 'ArrowUp')
        ? -250
        : (columns && event.key === 'ArrowRight') || (!columns && event.key === 'ArrowDown')
          ? 250
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = clampRatio(liveRatio + delta);
    setLiveRatio(next);
    onRatioCommit(next);
  }

  return (
    <div ref={containerRef} className={cn('flex size-full min-h-0 min-w-0', columns ? 'flex-row' : 'flex-col')}>
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexBasis: `${liveRatio / 100}%`, flexGrow: 0, flexShrink: 0 }}
      >
        {first}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation={columns ? 'vertical' : 'horizontal'}
        aria-label={columns ? messages.app.workspace.resizeColumns : messages.app.workspace.resizeRows}
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(liveRatio / 100)}
        className={cn(
          'group relative z-20 shrink-0 touch-none bg-border-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          columns ? 'h-full w-px cursor-col-resize' : 'h-px w-full cursor-row-resize',
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
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{second}</div>
    </div>
  );
}
