import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useId,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import { WorkbenchPaneResizeHandle } from '@/renderer/components/workbench/WorkbenchPaneResizeHandle';
import { useWorkbenchLayout } from '@/renderer/components/workbench/useWorkbenchLayout';
import { beginPanePointerDrag } from '@/renderer/components/workbench/paneResize';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { WorkbenchSidebar } from '@/renderer/components/workbench/WorkbenchSidebar';
import { sidebarRailWidth } from '@/renderer/components/workbench/WorkbenchSidebarHeader';
import { WorkspaceSidebarContent } from '@/renderer/components/workspace/WorkspaceHeader';

export interface WorkbenchRegionControls {
  toggle: ReactNode;
  visible: boolean;
  wide: boolean;
  revealDetail(): void;
}

export interface CollectionDetailLayoutHandle {
  revealCollection(): void;
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

function toolbarRegionClassName(wide: boolean, fullWidth: boolean) {
  return wide ? (fullWidth ? 'col-span-2' : 'col-start-2') : 'col-start-1';
}

function collectionRegionClassName(hasToolbar: boolean, wide: boolean, fullWidthToolbar: boolean) {
  if (!hasToolbar) return undefined;
  return cn('col-start-1', wide && !fullWidthToolbar ? 'row-span-2 row-start-1' : 'row-start-2');
}

function CollectionDetailToolbar({
  wide,
  fullWidth,
  children,
}: {
  wide: boolean;
  fullWidth: boolean;
  children: ReactNode;
}) {
  return <div className={cn('row-start-1 min-w-0', toolbarRegionClassName(wide, fullWidth))}>{children}</div>;
}

function CollectionDetailToggle({
  ref,
  expanded,
  label,
  controlsId,
  onToggle,
}: {
  ref: Ref<HTMLButtonElement>;
  expanded: boolean;
  label: string;
  controlsId: string;
  onToggle(): void;
}) {
  return (
    <WorkbenchPaneToggle
      ref={ref}
      data-pane-toggle
      floating={false}
      expanded={expanded}
      label={label}
      aria-controls={controlsId}
      onClick={onToggle}
    />
  );
}

/** Hosts own selection, saving and data. Hiding a region never unmounts its editing session. */
export function CollectionDetailLayout({
  ref,
  layoutKey,
  collectionLabel,
  selectionKey,
  collectionWidth = 280,
  minimumDetailWidth = 480,
  revealDetailOnSelection = true,
  toolbarPlacement = 'detail',
  toggleHost,
  toolbar,
  collectionHeader,
  collection,
  children,
  className,
}: {
  ref?: Ref<CollectionDetailLayoutHandle>;
  layoutKey: string;
  collectionLabel: string;
  selectionKey: string | null;
  collectionWidth?: number;
  minimumDetailWidth?: number;
  /** Disable for background/automatic selection; explicit row activation still calls revealDetail. */
  revealDetailOnSelection?: boolean;
  /** Place the toolbar above the complete collection/detail work surface. */
  toolbarPlacement?: 'detail' | 'full';
  /** Use an existing page toolbar when the regions do not have their own headers. */
  toggleHost?: HTMLElement | null;
  /** Stays above the detail pane by default; full placement spans the collection and detail regions. */
  toolbar?: ReactNode | ((controls: Omit<WorkbenchRegionControls, 'toggle'>) => ReactNode);
  collectionHeader?: (controls: Omit<WorkbenchRegionControls, 'toggle'>) => ReactNode;
  collection(controls: Omit<WorkbenchRegionControls, 'toggle'>): ReactNode;
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
  useImperativeHandle(ref, () => ({
    revealCollection() {
      compactDrag.current?.();
      if (layout.wide) layout.setExpanded(true);
      else setCompactCollection(true);
    },
  }));
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
  const fullWidthToolbar = Boolean(toolbar && toolbarPlacement === 'full');
  useLayoutEffect(() => {
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
    <CollectionDetailToggle
      ref={toggleButton}
      expanded={collectionVisible}
      label={collectionLabel}
      controlsId={id}
      onToggle={toggleCollection}
    />
  );
  const collectionControls = { visible: collectionVisible, wide: layout.wide, revealDetail };
  return (
    <div
      ref={layout.root}
      data-workbench-layout={layoutKey}
      data-layout={layout.wide ? 'split' : 'compact'}
      data-resizing={layout.resizing}
      className={cn(
        'relative flex size-full min-h-0 min-w-0 overflow-hidden bg-background',
        toolbar && 'grid grid-rows-[auto_minmax(0,1fr)]',
        toolbar && (layout.wide ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1'),
        className,
      )}
    >
      {toolbar && (
        <CollectionDetailToolbar wide={layout.wide} fullWidth={fullWidthToolbar}>
          {typeof toolbar === 'function' ? toolbar(collectionControls) : toolbar}
        </CollectionDetailToolbar>
      )}
      <WorkbenchSidebar
        ref={collectionRoot}
        data-workbench-collection
        label={collectionLabel}
        wide={layout.wide}
        expanded={collectionVisible}
        width={layout.collectionWidth}
        animate={layout.animateDisclosure}
        className={collectionRegionClassName(Boolean(toolbar), layout.wide, fullWidthToolbar)}
        toggle={layout.wide || toggleHost === undefined ? toggle : null}
        header={collectionHeader?.(collectionControls)}
        contentId={id}
        onContentFocus={(event) => {
          if (event.target !== event.currentTarget) origin.current = event.target as HTMLElement;
        }}
        resizeHandle={
          layout.wide && (
            <WorkbenchPaneResizeHandle
              edge="right"
              visibility="always"
              label={copy.resizePane(collectionLabel)}
              value={layout.expanded ? Math.round(layout.collectionWidth) : sidebarRailWidth}
              min={sidebarRailWidth}
              max={Math.round(layout.maximumWidth)}
              onValueChange={layout.resize}
              onPointerDown={layout.beginResize}
            />
          )
        }
      >
        {collection(collectionControls)}
      </WorkbenchSidebar>
      <div
        ref={detailRoot}
        tabIndex={-1}
        hidden={!detailVisible}
        inert={!detailVisible}
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col outline-none',
          detailVisible ? 'flex' : 'hidden',
          toolbar && 'row-start-2',
          toolbar && (layout.wide ? 'col-start-2' : 'col-start-1'),
        )}
      >
        <WorkspaceSidebarContent>
          {children({
            toggle: toggleHost === undefined && !layout.wide && !collectionVisible ? toggle : null,
            visible: detailVisible,
            wide: layout.wide,
            revealDetail,
          })}
        </WorkspaceSidebarContent>
      </div>
      {!layout.wide && (
        <CompactCollectionHandle
          label={copy.resizePane(collectionLabel)}
          expanded={compactCollection}
          onToggle={toggleCollection}
          onPointerDown={beginCompactDrag}
        />
      )}
      {!layout.wide && toggleHost && createPortal(toggle, toggleHost)}
    </div>
  );
}

function CompactCollectionHandle({
  label,
  expanded,
  onToggle,
  onPointerDown,
}: {
  label: string;
  expanded: boolean;
  onToggle(): void;
  onPointerDown(event: PointerEvent<HTMLDivElement>): void;
}) {
  return (
    <div className={cn('absolute inset-y-0 w-0', expanded ? 'right-0' : 'left-0')}>
      <WorkbenchPaneResizeHandle
        edge="right"
        visibility="always"
        label={label}
        value={expanded ? 1 : 0}
        min={0}
        max={1}
        step={1}
        onValueChange={(value) => {
          if (Boolean(value) !== expanded) onToggle();
        }}
        onPointerDown={onPointerDown}
      />
    </div>
  );
}
