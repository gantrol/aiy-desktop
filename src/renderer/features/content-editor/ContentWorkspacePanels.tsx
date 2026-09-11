import { Button } from '@/renderer/components/ui/button';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Slider } from '@/renderer/components/ui/slider';
import { useContentWorkspacePanelSize } from '@/renderer/features/content-editor/useContentWorkspacePanelSize';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { ChevronDown, ChevronUp, Maximize2Icon, Minimize2Icon, Settings2Icon } from 'lucide-react';
import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const RestorePanelContext = createContext(() => {});
export const useRestoreContentWorkspace = () => useContext(RestorePanelContext);
const ContentWorkspacePanelToolbarContext = createContext<HTMLElement | null>(null);
export const useContentWorkspacePanelToolbar = () => useContext(ContentWorkspacePanelToolbarContext);

export interface ContentWorkspacePanelTab {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

function showResizeSettings(focused: boolean, compact: boolean) {
  return !focused && !compact;
}

export function ContentWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className="@container/content-workspace flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @[960px]/content-workspace:flex-row [&:has(>aside[data-panel-maximized=true])>div]:hidden">
        {children}
      </div>
    </div>
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
}) {
  const copy = useI18n().messages.contentEditor;
  const [localActive, setActive] = useState(tabs[0]?.id);
  const [localOpen, setOpen] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [toolbarRoot, setToolbarRoot] = useState<HTMLDivElement | null>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const selected = tabs.find((tab) => tab.id === (active ?? localActive))?.id ?? tabs[0]?.id;
  const expanded = open ?? localOpen;
  const focused = expanded && maximized;
  const size = useContentWorkspacePanelSize({
    preferenceKey,
    selected,
    panelWidth,
    minimumWidth,
    maximumWidth,
    onPanelWidthChange,
  });
  const axis = size.compact ? 'height' : 'width';
  const minimum = size.compact ? size.minimumHeight : minimumWidth;
  const maximum = size.compact ? size.maximumHeight : size.maximumWidth;
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setMaximized(false);
    onOpenChange?.(value);
  };
  if (!tabs.length) return null;
  return (
    <Collapsible asChild open={expanded} onOpenChange={changeOpen}>
      <aside
        ref={size.asideRef}
        data-panel-maximized={focused}
        style={
          {
            '--content-workspace-panel-width': size.width + 'px',
            '--content-workspace-panel-height': size.height + 'px',
          } as CSSProperties
        }
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return;
          event.preventDefault();
          event.stopPropagation();
          if (focused) setMaximized(false);
          else {
            collapseRef.current?.focus();
            changeOpen(false);
          }
        }}
        className={cn(
          'relative flex min-h-0 min-w-0 w-full shrink-0 flex-col bg-background',
          focused
            ? 'h-full flex-1'
            : 'border-t @[960px]/content-workspace:border-t-0 @[960px]/content-workspace:border-l',
          !focused &&
            (expanded
              ? 'h-[var(--content-workspace-panel-height)] @[960px]/content-workspace:h-auto @[960px]/content-workspace:w-[var(--content-workspace-panel-width)]'
              : '@[960px]/content-workspace:w-24'),
        )}
      >
        {expanded && !focused && (
          <>
            <CreatorPaneResizeHandle
              edge="left"
              label={copy.resizePanelWidth}
              value={size.width}
              min={minimumWidth}
              max={size.maximumWidth}
              onPointerDown={(event) => size.beginResize('width', event)}
              onValueChange={(value) => size.change('width', value)}
              visibility="content-workspace"
            />
            <CreatorPaneResizeHandle
              edge="top"
              label={copy.resizePanelHeight}
              value={size.height}
              min={size.minimumHeight}
              max={size.maximumHeight}
              onPointerDown={(event) => size.beginResize('height', event)}
              onValueChange={(value) => size.change('height', value)}
              visibility="content-workspace"
            />
          </>
        )}
        <Tabs
          value={selected}
          onValueChange={(value) => {
            setActive(value);
            onActiveChange?.(value);
            changeOpen(true);
          }}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-0"
        >
          <div
            className={cn(
              'flex min-h-10 shrink-0 items-center border-b px-1',
              !expanded && '@[960px]/content-workspace:flex-col @[960px]/content-workspace:py-1',
            )}
          >
            <TabsList
              className={cn(
                'h-full min-w-0 flex-1 justify-start overflow-x-auto',
                !expanded && '@[960px]/content-workspace:w-full @[960px]/content-workspace:flex-col',
              )}
            >
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  onClick={() => changeOpen(true)}
                  className={cn('shrink-0 gap-1 px-2 text-xs', !expanded && '@[960px]/content-workspace:w-full')}
                >
                  {tab.label}
                  {Boolean(tab.count) && <span className="tabular-nums text-muted-foreground">{tab.count}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
            {expanded && (
              <>
                <div ref={setToolbarRoot} className="contents" />
                {showResizeSettings(focused, size.compact) && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={copy.resizePanel} title={copy.resizePanel}>
                        <Settings2Icon className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 space-y-3 rounded-sm p-3" align="end">
                      <div className="text-xs font-medium">
                        {size.compact ? copy.resizePanelHeight : copy.resizePanelWidth}
                      </div>
                      <Slider
                        min={minimum}
                        max={maximum}
                        step={1}
                        value={[size[axis]]}
                        onValueChange={([value]) => size.change(axis, value)}
                        aria-label={size.compact ? copy.resizePanelHeight : copy.resizePanelWidth}
                      />
                      <Button variant="ghost" size="sm" onClick={() => size.change(axis, size.compact ? 256 : 320)}>
                        {copy.resetPanelSize}
                      </Button>
                    </PopoverContent>
                  </Popover>
                )}
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
              </>
            )}
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
          </div>
          <CollapsibleContent className="min-h-0 flex-1 overflow-hidden">
            <ContentWorkspacePanelToolbarContext.Provider value={toolbarRoot}>
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
            </ContentWorkspacePanelToolbarContext.Provider>
          </CollapsibleContent>
        </Tabs>
      </aside>
    </Collapsible>
  );
}
