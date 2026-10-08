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
import {
  createContext,
  useContext,
  useEffect,
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
  setActive(value: string): void;
  onActiveChange?(id: string): void;
  changeOpen(value: boolean): void;
  setMaximized: Dispatch<SetStateAction<boolean>>;
}) {
  const panelToggle = !size.compact && (
    <WorkbenchPaneToggle
      ref={collapseRef}
      expanded={expanded}
      side="right"
      floating={false}
      label={tabs.find((tab) => tab.id === selected)?.label ?? copy.view}
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
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-0"
      >
        <div
          className={cn(
            'flex min-h-9 shrink-0 items-center gap-1 border-b px-1',
            collapsedRail && 'min-h-0 flex-1 flex-col border-b-0 py-1',
          )}
        >
          {collapsedRail && panelToggle}
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
                ref={collapseRef}
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? copy.collapse : copy.expand}
                title={expanded ? copy.collapse : copy.expand}
              >
                {expanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              </Button>
            </CollapsibleTrigger>
          )}
          {!collapsedRail && panelToggle}
        </div>
        <CollapsibleContent className="min-h-0 flex-1 overflow-hidden">
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
        : '@[960px]/content-workspace:w-[52px]'),
    !focused &&
      dockedAt === 768 &&
      (expanded
        ? 'h-[var(--content-workspace-panel-height)] @[768px]/content-workspace:h-auto @[768px]/content-workspace:w-[var(--content-workspace-panel-width)]'
        : '@[768px]/content-workspace:w-[52px]'),
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
}) {
  const copy = useI18n().messages.contentEditor;
  const dockedAt = useContext(DockedWidthContext);
  const [localActive, setActive] = useState(tabs[0]?.id);
  const [localOpen, setOpen] = useState(true);
  const [localMaximized, setLocalMaximized] = useState(false);
  const maximized = controlledMaximized ?? localMaximized;
  const setMaximized: Dispatch<SetStateAction<boolean>> = (value) => {
    const next = typeof value === 'function' ? value(maximized) : value;
    setLocalMaximized(next);
    onMaximizedChange?.(next);
  };
  const [desktopDragWidth, setDesktopDragWidth] = useState<number | null>(null);
  const desktopResizeCleanup = useRef<(() => void) | null>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
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
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setMaximized(false);
    onOpenChange?.(value);
  };
  const desktopCollapsedWidth = 52;
  function beginDesktopResize(event: React.PointerEvent<HTMLDivElement>) {
    if (size.compact || focused || event.button !== 0 || event.isPrimary === false) return;
    desktopResizeCleanup.current?.();
    const initialExpanded = expanded;
    const initialWidth = size.width;
    let currentOpen = expanded;
    let currentWidth = initialWidth;
    const gesture = createPaneResizeGesture(
      { collapsed: !expanded, width: initialWidth },
      { minimum: minimumWidth, maximum: size.maximumWidth, collapsedWidth: desktopCollapsedWidth },
    );
    desktopResizeCleanup.current = beginPanePointerDrag(
      event,
      (delta) => {
        const next = gesture(-delta);
        currentWidth = next.width;
        const nextOpen = !next.collapsed;
        if (nextOpen !== currentOpen) {
          currentOpen = nextOpen;
          changeOpen(nextOpen);
        }
        setDesktopDragWidth(nextOpen ? next.width : null);
      },
      (cancelled) => {
        if (cancelled && currentOpen !== initialExpanded) changeOpen(initialExpanded);
        if (!cancelled && currentOpen) size.change('width', currentWidth);
        setDesktopDragWidth(null);
        desktopResizeCleanup.current = null;
      },
    );
  }
  function changeDesktopWidth(value: number) {
    if (!Number.isFinite(value)) return;
    if (!expanded) {
      if (value > desktopCollapsedWidth) changeOpen(true);
      return;
    }
    if (value < minimumWidth - 48) {
      changeOpen(false);
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
        className={contentWorkspacePanelClassName(focused, expanded, dockedAt)}
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
            onPointerDown={(event) => size.beginResize('height', event)}
            onValueChange={(value) => size.change('height', value)}
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
          setActive={setActive}
          onActiveChange={onActiveChange}
          changeOpen={changeOpen}
          setMaximized={setMaximized}
        />
      </aside>
    </Collapsible>
  );
}
