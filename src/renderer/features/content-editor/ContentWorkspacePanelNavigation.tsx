import { useLayoutEffect, useRef, useState } from 'react';
import { TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { lineTabClassName } from '@/renderer/components/ui/tab-styles';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import type { ContentWorkspacePanelTab } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { cn } from '@/renderer/lib/utils';

const tabSpacing = 'mb-0 gap-1.5 whitespace-nowrap px-2';

function usePanelTabLabels(collapsedRail: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [iconsOnly, setIconsOnly] = useState(true);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurement = measurementRef.current;
    if (collapsedRail || !container || !measurement) return;
    const update = () => {
      const available = container.getBoundingClientRect().width;
      const required = measurement.getBoundingClientRect().width;
      if (available <= 0) return;
      // Leave room before restoring labels so fractional resizes do not toggle them repeatedly.
      setIconsOnly((current) => required + (current ? 8 : 0) > available);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(measurement);
    return () => observer.disconnect();
  }, [collapsedRail]);

  return { containerRef, measurementRef, iconsOnly: collapsedRail || iconsOnly };
}

function PanelTab({
  tab,
  collapsedRail,
  iconsOnly,
  onActivate,
}: {
  tab: ContentWorkspacePanelTab;
  collapsedRail: boolean;
  iconsOnly: boolean;
  onActivate(): void;
}) {
  const Icon = tab.icon;
  const tooltipLabel = tab.count ? `${tab.label} (${tab.count})` : tab.label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TabsTrigger
          value={tab.id}
          aria-label={tooltipLabel}
          onClick={onActivate}
          className={cn(
            tabSpacing,
            iconsOnly && 'size-8 gap-0 px-0',
            collapsedRail &&
              'w-full rounded-sm border-0 data-[state=active]:bg-selected data-[state=active]:text-selected-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {!iconsOnly && <span>{tab.label}</span>}
        </TabsTrigger>
      </TooltipTrigger>
      <TooltipContent side={collapsedRail ? 'left' : 'bottom'}>{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

export function ContentWorkspacePanelNavigation({
  tabs,
  collapsedRail,
  onActivate,
}: {
  tabs: readonly ContentWorkspacePanelTab[];
  collapsedRail: boolean;
  onActivate(): void;
}) {
  const { containerRef, measurementRef, iconsOnly } = usePanelTabLabels(collapsedRail);
  const visibleTabs = tabs.filter((tab) => !tab.hidden);
  return (
    <div
      ref={containerRef}
      className={cn('relative flex min-h-0 min-w-0 flex-1 overflow-hidden', collapsedRail && 'w-full')}
    >
      {/* Measure full labels independently of the visible mode, including selected text weight. */}
      <div
        ref={measurementRef}
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute left-0 top-0 flex w-max gap-0.5"
      >
        {visibleTabs.map((tab) => (
          <span key={tab.id} className={cn(lineTabClassName, tabSpacing, 'font-semibold')}>
            <tab.icon className="size-4 shrink-0" />
            <span>{tab.label}</span>
          </span>
        ))}
      </div>
      <TabsList
        density="compact"
        className={cn(
          'min-w-0 flex-1 justify-start gap-0.5 overflow-x-auto overflow-y-hidden border-b-0 [scrollbar-width:thin]',
          collapsedRail && 'min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto',
        )}
      >
        {visibleTabs.map((tab) => (
          <PanelTab
            key={tab.id}
            tab={tab}
            collapsedRail={collapsedRail}
            iconsOnly={iconsOnly}
            onActivate={onActivate}
          />
        ))}
      </TabsList>
    </div>
  );
}
