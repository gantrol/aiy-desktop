import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type PointerEvent } from 'react';
import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import { WorkbenchPaneResizeHandle } from '@/renderer/components/workbench/WorkbenchPaneResizeHandle';
import { useWorkbenchLayout } from '@/renderer/components/workbench/useWorkbenchLayout';
import { beginPanePointerDrag } from '@/renderer/components/workbench/paneResize';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

/** Direct child of a horizontal flex workspace. Compact mode hides, never unmounts, its content siblings. */
export function WorkbenchNavigationPane({
  layoutKey,
  label,
  selectionKey,
  initialWidth = 256,
  minimumContentWidth = 480,
  children,
  className,
  ...props
}: ComponentProps<'div'> & {
  layoutKey: string;
  label: string;
  selectionKey: string | number;
  initialWidth?: number;
  minimumContentWidth?: number;
}) {
  const layout = useWorkbenchLayout(layoutKey, initialWidth, minimumContentWidth, true);
  const [compactOpen, setCompactOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const selected = useRef(selectionKey);
  const cleanup = useRef<(() => void) | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const expanded = layout.wide ? layout.expanded : compactOpen;
  const copy = useI18n().messages.workbench;
  useLayoutEffect(() => setHost(layout.root.current?.parentElement ?? null), [layout.root]);
  useEffect(() => () => cleanup.current?.(), []);
  useLayoutEffect(() => {
    cleanup.current?.();
    cleanup.current = null;
  }, [layout.scopeKey, layout.wide, selectionKey]);
  useLayoutEffect(() => {
    if (selected.current === selectionKey) return;
    selected.current = selectionKey;
    if (!compactOpen) return;
    setCompactOpen(false);
    if (!layout.wide) button.current?.focus({ preventScroll: true });
  }, [selectionKey, layout.wide, compactOpen]);
  function toggle() {
    if (layout.wide) layout.setExpanded(!layout.expanded);
    else setCompactOpen(!compactOpen);
  }
  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (layout.wide) return layout.beginResize(event);
    if (event.button !== 0 || event.isPrimary === false) return;
    cleanup.current?.();
    let delta = 0;
    cleanup.current = beginPanePointerDrag(
      event,
      (value) => {
        delta = value;
      },
      (cancelled) => {
        cleanup.current = null;
        if (!cancelled && (compactOpen ? delta < -48 : delta > 48)) {
          setCompactOpen(!compactOpen);
          button.current?.focus({ preventScroll: true });
        }
      },
    );
  }
  return (
    <div
      {...props}
      ref={layout.root}
      data-workbench-navigation-pane
      data-mode={layout.wide ? 'split' : 'compact'}
      data-open={expanded}
      data-resizing={layout.resizing}
      className={cn('relative flex min-h-0 min-w-0 shrink-0 flex-col', className)}
      style={layout.wide ? { width: expanded ? layout.collectionWidth : 0 } : { width: compactOpen ? '100%' : 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !layout.wide && compactOpen && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setCompactOpen(false);
          button.current?.focus({ preventScroll: true });
        }
      }}
    >
      <aside
        id={id}
        aria-label={label}
        hidden={!expanded}
        inert={!expanded}
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r bg-surface-sunken/45',
          expanded ? 'flex' : 'hidden',
        )}
      >
        {children}
      </aside>
      <WorkbenchPaneResizeHandle
        edge="right"
        visibility="always"
        label={copy.resizePane(label)}
        value={layout.wide ? (expanded ? Math.round(layout.collectionWidth) : 0) : Number(compactOpen)}
        min={0}
        max={layout.wide ? Math.round(layout.maximumWidth) : 1}
        step={layout.wide ? 16 : 1}
        onValueChange={layout.wide ? layout.resize : (value) => setCompactOpen(Boolean(value))}
        onPointerDown={beginResize}
      />
      <WorkbenchPaneToggle
        ref={button}
        floatingHost={host}
        data-pane-toggle
        expanded={expanded}
        label={label}
        aria-controls={id}
        onClick={toggle}
      />
    </div>
  );
}
