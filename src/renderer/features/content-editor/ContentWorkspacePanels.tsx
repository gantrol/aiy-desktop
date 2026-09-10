import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export interface ContentWorkspacePanelTab {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

export function ContentWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className="@container/content-workspace flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @[960px]/content-workspace:flex-row">{children}</div>
    </div>
  );
}

/** Layout panel: no overlay, focus trap, editor remount, or separate mobile state. */
export function ContentWorkspacePanels({
  tabs,
  active,
  open,
  onActiveChange,
  onOpenChange,
}: {
  tabs: readonly ContentWorkspacePanelTab[];
  active?: string;
  open?: boolean;
  onActiveChange?(id: string): void;
  onOpenChange?(open: boolean): void;
}) {
  const copy = useI18n().messages.contentEditor;
  const [localActive, setActive] = useState(tabs[0]?.id);
  const [localOpen, setOpen] = useState(true);
  const selected = tabs.find((tab) => tab.id === (active ?? localActive))?.id ?? tabs[0]?.id;
  const expanded = open ?? localOpen;
  const changeOpen = (value: boolean) => {
    setOpen(value);
    onOpenChange?.(value);
  };
  if (!tabs.length) return null;
  return (
    <Collapsible asChild open={expanded} onOpenChange={changeOpen}>
      <aside
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return;
          event.preventDefault();
          event.stopPropagation();
          changeOpen(false);
        }}
        className={cn(
          'flex min-h-0 w-full shrink-0 flex-col border-t bg-background @[960px]/content-workspace:w-80 @[960px]/content-workspace:border-t-0 @[960px]/content-workspace:border-l',
          expanded &&
            'h-[min(18rem,40dvh)] max-h-[40%] @[960px]/content-workspace:h-auto @[960px]/content-workspace:max-h-none',
        )}
      >
        <Tabs
          value={selected}
          onValueChange={(value) => {
            setActive(value);
            onActiveChange?.(value);
            changeOpen(true);
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="flex h-10 shrink-0 items-center border-b px-2">
            <TabsList className="h-full min-w-0 flex-1 justify-start">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  onClick={() => changeOpen(true)}
                  className="gap-1 px-2 text-xs"
                >
                  {tab.label}
                  {Boolean(tab.count) && <span className="tabular-nums text-muted-foreground">{tab.count}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
            <CollapsibleTrigger asChild>
              <Button
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
            {tabs.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="m-0 h-full min-h-0 overflow-y-auto p-3">
                {tab.content}
              </TabsContent>
            ))}
          </CollapsibleContent>
        </Tabs>
      </aside>
    </Collapsible>
  );
}
