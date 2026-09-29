import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import { WorkbenchPaneResizeHandle } from '@/renderer/components/workbench/WorkbenchPaneResizeHandle';
import { useWorkbenchLayout } from '@/renderer/components/workbench/useWorkbenchLayout';
import { beginPanePointerDrag } from '@/renderer/components/workbench/paneResize';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export interface WorkbenchRegionControls {
  toggle: ReactNode;
  visible: boolean;
  wide: boolean;
  revealDetail(): void;
}

function canReceivePaneFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  if (
    !element?.isConnected ||
    element.closest('[hidden], [inert], [aria-disabled="true"]') ||
    element.matches(':disabled')
  )
    return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).visibility === 'visible';
}

/** Hosts own selection, saving and data. Hiding a region never unmounts its editing session. */
export function CollectionDetailLayout({
  layoutKey,
  collectionLabel,
  selectionKey,
  collectionWidth = 280,
  minimumDetailWidth = 480,
  revealDetailOnSelection = true,
  toggleHost,
  collection,
  children,
  className,
}: {
  layoutKey: string;
  collectionLabel: string;
  selectionKey: string | null;
  collectionWidth?: number;
  minimumDetailWidth?: number;
  /** Disable for background/automatic selection; explicit row activation still calls revealDetail. */
  revealDetailOnSelection?: boolean;
  /** Use an existing page toolbar when the regions do not have their own headers. */
  toggleHost?: HTMLElement | null;
  collection(controls: WorkbenchRegionControls): ReactNode;
  children(controls: WorkbenchRegionControls): ReactNode;
  className?: string;
}) {
  const layout = useWorkbenchLayout(layoutKey, collectionWidth, minimumDetailWidth);
  const [compactCollection, setCompactCollection] = useState(!selectionKey);
  const id = useId();
  const previousSelection = useRef(selectionKey);
  const previousScope = useRef(layout.scopeKey);
  const origin = useRef<HTMLElement | null>(null);
  const collectionRoot = useRef<HTMLElement>(null);
  const detailRoot = useRef<HTMLDivElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const restoreToggleFocus = useRef(false);
  const compactDrag = useRef<(() => void) | null>(null);
  const focusFrame = useRef<number | null>(null);
  const root = layout.root;
  const copy = useI18n().messages.workbench;
  const focusVisibleRegion = useCallback(
    (element: HTMLElement | null, preferred?: HTMLElement | null) => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
      const previousFocus = document.activeElement;
      // Background selection updates must not move focus out of another workspace.
      if (previousFocus && previousFocus !== document.body && !root.current?.contains(previousFocus)) return;
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        const currentFocus = document.activeElement;
        if (currentFocus !== previousFocus && currentFocus !== document.body && currentFocus !== element) return;
        if (!document.hasFocus() || !canReceivePaneFocus(element) || !root.current?.contains(element)) return;
        const target = canReceivePaneFocus(preferred) && element.contains(preferred) ? preferred : element;
        target.focus({ preventScroll: true });
      });
    },
    [root],
  );
  useEffect(
    () => () => {
      compactDrag.current?.();
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    },
    [],
  );
  // Releasing an old pointer must not toggle a new selection, pane, or workspace.
  useLayoutEffect(() => {
    compactDrag.current?.();
    compactDrag.current = null;
  }, [layout.wide, selectionKey, compactCollection, layout.scopeKey, layout.visible]);
  // Preserve an explicit revealDetail request across its paired selection update.
  useLayoutEffect(() => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
  }, [layout.scopeKey, layout.wide, layout.visible]);
  useLayoutEffect(() => {
    if (previousScope.current === layout.scopeKey) return;
    previousScope.current = layout.scopeKey;
    previousSelection.current = selectionKey;
    origin.current = null;
    setCompactCollection(!selectionKey);
  }, [layout.scopeKey, selectionKey]);
  useLayoutEffect(() => {
    if (previousSelection.current === selectionKey) return;
    previousSelection.current = selectionKey;
    if (!selectionKey || revealDetailOnSelection) {
      setCompactCollection(!selectionKey);
      if (!layout.wide) {
        focusVisibleRegion(
          selectionKey ? detailRoot.current : collectionRoot.current,
          selectionKey ? null : origin.current,
        );
      }
    }
  }, [selectionKey, layout.wide, revealDetailOnSelection, focusVisibleRegion]);
  const collectionVisible = layout.wide ? layout.expanded : compactCollection;
  const detailVisible = layout.wide || !compactCollection;
  useLayoutEffect(() => {
    // Inline controls move between headers; keep keyboard focus on the replacement button.
    if (restoreToggleFocus.current) toggleButton.current?.focus({ preventScroll: true });
    restoreToggleFocus.current = false;
  }, [collectionVisible]);
  const revealDetail = () => {
    if (layout.wide) return;
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      collectionRoot.current?.contains(focused) &&
      focused !== collectionRoot.current &&
      focused.getAttribute('role') !== 'separator'
    )
      origin.current = focused;
    setCompactCollection(false);
    focusVisibleRegion(detailRoot.current);
  };
  const toggleCollection = () => {
    compactDrag.current?.();
    compactDrag.current = null;
    if (layout.wide) {
      restoreToggleFocus.current = document.activeElement === toggleButton.current;
      layout.setExpanded(!layout.expanded);
    } else {
      setCompactCollection(!compactCollection);
      focusVisibleRegion(
        compactCollection ? detailRoot.current : collectionRoot.current,
        compactCollection ? null : origin.current,
      );
    }
  };
  const beginCompactDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || layout.wide) return;
    compactDrag.current?.();
    let delta = 0;
    compactDrag.current = beginPanePointerDrag(
      event,
      (next) => {
        delta = next;
      },
      (cancelled) => {
        compactDrag.current = null;
        if (!cancelled && (compactCollection ? delta < -48 : delta > 48)) toggleCollection();
      },
    );
  };
  const toggle = (
    <WorkbenchPaneToggle
      ref={toggleButton}
      data-pane-toggle
      floating={false}
      expanded={collectionVisible}
      label={collectionLabel}
      aria-controls={id}
      onClick={toggleCollection}
    />
  );
  return (
    <div
      ref={layout.root}
      data-workbench-layout={layoutKey}
      data-layout={layout.wide ? 'split' : 'compact'}
      data-resizing={layout.resizing}
      className={cn('relative flex size-full min-h-0 min-w-0 overflow-hidden bg-background', className)}
    >
      <aside
        ref={collectionRoot}
        data-workbench-collection
        tabIndex={-1}
        aria-label={collectionLabel}
        className={cn(
          'relative min-h-0 min-w-0 shrink-0 bg-surface-sunken outline-none',
          collectionVisible && 'border-r',
          !layout.wide && !collectionVisible ? 'hidden' : 'flex flex-col',
          !layout.wide && 'flex-1',
        )}
        style={layout.wide ? { width: layout.expanded ? layout.collectionWidth : 0 } : undefined}
      >
        <div
          id={id}
          onFocusCapture={(event) => {
            // Remember content controls, not the region wrapper or its resize handle.
            if (event.target !== event.currentTarget) origin.current = event.target as HTMLElement;
          }}
          hidden={!collectionVisible}
          inert={!collectionVisible}
          className={cn('min-h-0 min-w-0 flex-1 flex-col', collectionVisible ? 'flex' : 'hidden')}
        >
          {collection({
            toggle: toggleHost === undefined && collectionVisible ? toggle : null,
            visible: collectionVisible,
            wide: layout.wide,
            revealDetail,
          })}
        </div>
        {layout.wide && (
          <WorkbenchPaneResizeHandle
            edge="right"
            visibility="always"
            label={copy.resizePane(collectionLabel)}
            value={layout.expanded ? Math.round(layout.collectionWidth) : 0}
            min={0}
            max={Math.round(layout.maximumWidth)}
            onValueChange={layout.resize}
            onPointerDown={layout.beginResize}
          />
        )}
      </aside>
      <div
        ref={detailRoot}
        tabIndex={-1}
        hidden={!detailVisible}
        inert={!detailVisible}
        className={cn('min-h-0 min-w-0 flex-1 flex-col outline-none', detailVisible ? 'flex' : 'hidden')}
      >
        {children({
          toggle: toggleHost === undefined && !collectionVisible ? toggle : null,
          visible: detailVisible,
          wide: layout.wide,
          revealDetail,
        })}
      </div>
      {!layout.wide && (
        <div className={cn('absolute inset-y-0 w-0', compactCollection ? 'right-0' : 'left-0')}>
          <WorkbenchPaneResizeHandle
            edge="right"
            visibility="always"
            label={copy.resizePane(collectionLabel)}
            value={compactCollection ? 1 : 0}
            min={0}
            max={1}
            step={1}
            onValueChange={(value) => {
              if (Boolean(value) !== compactCollection) toggleCollection();
            }}
            onPointerDown={beginCompactDrag}
          />
        </div>
      )}
      {toggleHost && createPortal(toggle, toggleHost)}
    </div>
  );
}
