import { Button } from '@/renderer/components/ui/button';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import { beginPanePointerDrag, createPaneResizeGesture } from '@/renderer/components/workbench/paneResize';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Tabs, TabsContent } from '@/renderer/components/ui/tabs';
import { useContentWorkspacePanelSize } from '@/renderer/features/content-editor/useContentWorkspacePanelSize';
import { ContentWorkspacePanelNavigation } from '@/renderer/features/content-editor/ContentWorkspacePanelNavigation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { ChevronDown, ChevronUp, Maximize2Icon, Minimize2Icon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';

const RestorePanelContext = createContext(() => {});
const DockedWidthContext = createContext<768 | 960>(960);
export const useRestoreContentWorkspace = () => useContext(RestorePanelContext);

export interface ContentWorkspacePanelTab {
  id: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  hidden?: boolean;
  content: ReactNode;
}

function isCollapsedRail(expanded: boolean, compact: boolean) {
  return !expanded && !compact;
}

type ContentWorkspacePanelSize = ReturnType<typeof useContentWorkspacePanelSize>;
type ContentWorkspacePanelCopy = ReturnType<typeof useI18n>['messages']['contentEditor'];

function ContentWorkspacePanelTabs({
  tabs,
  selected,
  expanded,
  focused,
  collapsedRail,
  size,
  copy,
  collapseRef,
  toggleHost,
  contentId,
  keepMounted,
  animate,
  panelWidth,
  setActive,
  onActiveChange,
  changeOpen,
  setMaximized,
}: {
  tabs: readonly ContentWorkspacePanelTab[];
  selected: string | undefined;
  expanded: boolean;
  focused: boolean;
  collapsedRail: boolean;
  size: ContentWorkspacePanelSize;
  copy: ContentWorkspacePanelCopy;
  collapseRef: RefObject<HTMLButtonElement | null>;
  toggleHost?: HTMLElement | null;
  contentId: string;
  keepMounted: boolean;
  animate: boolean;
  panelWidth: number;
  setActive(value: string): void;
  onActiveChange?(id: string): void;
  changeOpen(value: boolean): void;
  setMaximized: Dispatch<SetStateAction<boolean>>;
}) {
  const headerToggleHost = size.compact ? null : toggleHost;
  const restoreToggleFocus = useRef(false);
  const setCollapseRef = useCallback(
    (button: HTMLButtonElement | null) => {
      if (!button) return;
      collapseRef.current = button;
      if (restoreToggleFocus.current) {
        restoreToggleFocus.current = false;
        button.focus({ preventScroll: true });
      }
      // Keep keyboard focus on the control when it moves between headers.
      return () => {
        restoreToggleFocus.current = button.ownerDocument.activeElement === button;
        if (collapseRef.current === button) collapseRef.current = null;
      };
    },
    [collapseRef],
  );
  const panelToggle = !size.compact && (
    <WorkbenchPaneToggle
      ref={setCollapseRef}
      expanded={expanded}
      side="right"
      floating={false}
      label={tabs.find((tab) => tab.id === selected)?.label ?? copy.view}
      aria-controls={contentId}
      onClick={() => changeOpen(!expanded)}
    />
  );
  return (
    <TooltipProvider>
      <Tabs
        value={selected}
        orientation={collapsedRail ? 'vertical' : 'horizontal'}
        activationMode="manual"
        onValueChange={(value) => {
          setActive(value);
          onActiveChange?.(value);
          changeOpen(true);
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div
          className={cn(
            'flex min-h-9 shrink-0 items-center gap-1 border-b px-1',
            collapsedRail && 'min-h-0 flex-1 flex-col border-b-0 py-1',
          )}
        >
          {headerToggleHost ? createPortal(panelToggle, headerToggleHost) : collapsedRail && panelToggle}
          <ContentWorkspacePanelNavigation
            tabs={tabs}
            collapsedRail={collapsedRail}
            onActivate={() => changeOpen(true)}
          />
          {expanded && (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={focused ? copy.restorePanel : copy.maximizePanel}
                title={focused ? copy.restorePanel : copy.maximizePanel}
                aria-pressed={focused}
                onClick={() => setMaximized((value) => !value)}
              >
                {focused ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
              </Button>
            </div>
          )}
          {size.compact && (
            <CollapsibleTrigger asChild>
              <Button
                ref={setCollapseRef}
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? copy.collapse : copy.expand}
                aria-controls={contentId}
                title={expanded ? copy.collapse : copy.expand}
              >
                {expanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              </Button>
            </CollapsibleTrigger>
          )}
          {!headerToggleHost && !collapsedRail && panelToggle}
        </div>
        <CollapsibleContent
          id={contentId}
          forceMount={keepMounted ? true : undefined}
          inert={!expanded}
          aria-hidden={!expanded}
          className={cn(
            'min-h-0 flex-1 overflow-hidden',
            animate && 'motion-safe:transition-[opacity,visibility] duration-fast',
            !expanded && 'invisible opacity-0',
          )}
          style={animate && !size.compact && !focused ? { width: Math.max(panelWidth - 1, 0) } : undefined}
        >
          <RestorePanelContext.Provider value={() => setMaximized(false)}>
            {tabs.map((tab) => (
              <TabsContent
                key={tab.id}
                value={tab.id}
                className="m-0 h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-3"
              >
                {tab.content}
              </TabsContent>
            ))}
          </RestorePanelContext.Provider>
        </CollapsibleContent>
      </Tabs>
    </TooltipProvider>
  );
}

function contentWorkspacePanelClassName(focused: boolean, expanded: boolean, dockedAt: 768 | 960) {
  return cn(
    'relative flex min-h-0 min-w-0 w-full shrink-0 flex-col bg-background',
    focused ? 'h-full flex-1' : 'border-t',
    !focused && dockedAt === 960 && ' @[960px]/content-workspace:border-t-0 @[960px]/content-workspace:border-l',
    !focused && dockedAt === 768 && ' @[768px]/content-workspace:border-t-0 @[768px]/content-workspace:border-l',
    !focused &&
      dockedAt === 960 &&
      (expanded
        ? 'h-[var(--content-workspace-panel-height)] @[960px]/content-workspace:h-auto @[960px]/content-workspace:w-[var(--content-workspace-panel-width)]'
        : 'h-9 @[960px]/content-workspace:h-auto @[960px]/content-workspace:w-[52px]'),
    !focused &&
      dockedAt === 768 &&
      (expanded
        ? 'h-[var(--content-workspace-panel-height)] @[768px]/content-workspace:h-auto @[768px]/content-workspace:w-[var(--content-workspace-panel-width)]'
        : 'h-9 @[768px]/content-workspace:h-auto @[768px]/content-workspace:w-[52px]'),
  );
}

function handleContentWorkspacePanelKeyDown(
  event: KeyboardEvent<HTMLElement>,
  expanded: boolean,
  focused: boolean,
  collapseRef: RefObject<HTMLButtonElement | null>,
  changeOpen: (value: boolean) => void,
  setMaximized: Dispatch<SetStateAction<boolean>>,
) {
  if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return;
  event.preventDefault();
  event.stopPropagation();
  if (focused) setMaximized(false);
  else {
    collapseRef.current?.focus();
    changeOpen(false);
  }
}

export function ContentWorkspace({ children, dockedAt = 960 }: { children: ReactNode; dockedAt?: 768 | 960 }) {
  return (
    <DockedWidthContext.Provider value={dockedAt}>
      <div className="@container/content-workspace flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col [&:has(>aside[data-panel-maximized=true])>div]:hidden',
            dockedAt === 768 ? '@[768px]/content-workspace:flex-row' : '@[960px]/content-workspace:flex-row',
          )}
        >
          {children}
        </div>
      </div>
    </DockedWidthContext.Provider>
  );
}

/** Resizing and maximizing retain the same editor and panel instances. */
export function ContentWorkspacePanels({
  tabs,
  active,
  open,
  onActiveChange,
  onOpenChange,
  preferenceKey,
  panelWidth,
  minimumWidth = 256,
  maximumWidth = 720,
  onPanelWidthChange,
  maximized: controlledMaximized,
  onMaximizedChange,
  toggleHost,
  keepMounted = false,
}: {
  tabs: readonly ContentWorkspacePanelTab[];
  active?: string;
  open?: boolean;
  onActiveChange?(id: string): void;
  onOpenChange?(open: boolean): void;
  preferenceKey?: string;
  panelWidth?: number;
  minimumWidth?: number;
  maximumWidth?: number;
  onPanelWidthChange?(width: number): void;
  maximized?: boolean;
  onMaximizedChange?(maximized: boolean): void;
  /** Host the disclosure control in the work-surface header only while docked to the right. */
  toggleHost?: HTMLElement | null;
  /** Preserve panel-local selection and scroll position while collapsed. */
  keepMounted?: boolean;
}) {
  const copy = useI18n().messages.contentEditor;
  const dockedAt = useContext(DockedWidthContext);
  const [localActive, setActive] = useState(tabs[0]?.id);
  const [localOpen, setOpen] = useState(true);
  const [localMaximized, setLocalMaximized] = useState(false);
  const [disclosureMotion, setDisclosureMotion] = useState(false);
  const maximized = controlledMaximized ?? localMaximized;
  const setMaximized: Dispatch<SetStateAction<boolean>> = (value) => {
    setDisclosureMotion(false);
    const next = typeof value === 'function' ? value(maximized) : value;
    setLocalMaximized(next);
    onMaximizedChange?.(next);
  };
  const [desktopDragWidth, setDesktopDragWidth] = useState<number | null>(null);
  const desktopResizeCleanup = useRef<(() => void) | null>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  useEffect(() => () => desktopResizeCleanup.current?.(), []);
  const selected = tabs.find((tab) => tab.id === (active ?? localActive))?.id ?? tabs[0]?.id;
  const expanded = open ?? localOpen;
  const focused = expanded && maximized;
  const size = useContentWorkspacePanelSize({
    dockedAt,
    preferenceKey,
    selected,
    panelWidth,
    minimumWidth,
    maximumWidth,
    onPanelWidthChange,
  });
  const collapsedRail = isCollapsedRail(expanded, size.compact);
  // Container changes and direct resizing take over without an old disclosure transition.
  useLayoutEffect(() => {
    setDisclosureMotion(false);
    desktopResizeCleanup.current?.();
  }, [size.available.width, size.available.height, preferenceKey]);
  const animate = disclosureMotion && !focused && !size.resizing && desktopDragWidth === null;
  const changeOpen = (value: boolean, animateChange = true) => {
    if (!value && size.asideRef.current?.contains(document.activeElement)) collapseRef.current?.focus();
    if (!value) setMaximized(false);
    setDisclosureMotion(animateChange && !focused && value !== expanded);
    setOpen(value);
    onOpenChange?.(value);
  };
  const desktopCollapsedWidth = 52;
  function beginDesktopResize(event: React.PointerEvent<HTMLDivElement>) {
    if (size.compact || focused || event.button !== 0 || event.isPrimary === false) return;
    desktopResizeCleanup.current?.();
    setDisclosureMotion(false);
    const initialExpanded = expanded;
    const initialWidth = size.width;
    let currentOpen = expanded;
    let currentWidth = initialWidth;
    const gesture = createPaneResizeGesture(
      { collapsed: !expanded, width: initialWidth },
      { minimum: minimumWidth, maximum: size.maximumWidth, collapsedWidth: desktopCollapsedWidth },
    );
    let active = true;
    let removeListeners: (() => void) | null = null;
    const finish = (cancelled: boolean) => {
      if (!active) return;
      active = false;
      removeListeners?.();
      if (cancelled && currentOpen !== initialExpanded) changeOpen(initialExpanded, false);
      if (!cancelled && currentOpen) size.change('width', currentWidth);
      setDesktopDragWidth(null);
      desktopResizeCleanup.current = null;
    };
    removeListeners = beginPanePointerDrag(
      event,
      (delta) => {
        const next = gesture(-delta);
        currentWidth = next.width;
        const nextOpen = !next.collapsed;
        if (nextOpen !== currentOpen) {
          currentOpen = nextOpen;
          changeOpen(nextOpen, false);
        }
        setDesktopDragWidth(nextOpen ? next.width : null);
      },
      finish,
    );
    desktopResizeCleanup.current = () => finish(true);
  }
  function changeDesktopWidth(value: number) {
    if (!Number.isFinite(value)) return;
    setDisclosureMotion(false);
    if (!expanded) {
      if (value > desktopCollapsedWidth) changeOpen(true, false);
      return;
    }
    if (value < minimumWidth - 48) {
      changeOpen(false, false);
      return;
    }
    size.change('width', Math.max(minimumWidth, value));
  }
  if (!tabs.length) return null;
  return (
    <Collapsible asChild open={expanded} onOpenChange={changeOpen}>
      <aside
        ref={size.asideRef}
        data-panel-maximized={focused}
        style={
          {
            '--content-workspace-panel-width': (desktopDragWidth ?? size.width) + 'px',
            '--content-workspace-panel-height': size.height + 'px',
          } as CSSProperties
        }
        onKeyDown={(event) =>
          handleContentWorkspacePanelKeyDown(event, expanded, focused, collapseRef, changeOpen, setMaximized)
        }
        className={cn(
          contentWorkspacePanelClassName(focused, expanded, dockedAt),
          animate && 'motion-safe:transition-[width,height] duration-base ease-[var(--ease-standard)]',
        )}
      >
        {!focused && !size.compact && (
          <CreatorPaneResizeHandle
            edge="left"
            label={copy.resizePanelWidth}
            value={expanded ? (desktopDragWidth ?? size.width) : desktopCollapsedWidth}
            min={desktopCollapsedWidth}
            max={size.maximumWidth}
            onPointerDown={beginDesktopResize}
            onValueChange={changeDesktopWidth}
            visibility="always"
          />
        )}
        {expanded && !focused && size.compact && (
          <CreatorPaneResizeHandle
            edge="top"
            label={copy.resizePanelHeight}
            value={size.height}
            min={size.minimumHeight}
            max={size.maximumHeight}
            onPointerDown={(event) => {
              setDisclosureMotion(false);
              size.beginResize('height', event);
            }}
            onValueChange={(value) => {
              setDisclosureMotion(false);
              size.change('height', value);
            }}
            visibility="always"
          />
        )}
        <ContentWorkspacePanelTabs
          tabs={tabs}
          selected={selected}
          expanded={expanded}
          focused={focused}
          collapsedRail={collapsedRail}
          size={size}
          copy={copy}
          collapseRef={collapseRef}
          toggleHost={toggleHost}
          contentId={contentId}
          keepMounted={keepMounted}
          animate={animate}
          panelWidth={desktopDragWidth ?? size.width}
          setActive={setActive}
          onActiveChange={onActiveChange}
          changeOpen={changeOpen}
          setMaximized={setMaximized}
        />
      </aside>
    </Collapsible>
  );
}
