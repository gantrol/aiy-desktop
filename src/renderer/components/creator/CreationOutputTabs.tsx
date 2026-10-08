import { HistoryIcon, ImagesIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';

export type CreationOutputMode = 'results' | 'inputs' | 'records';

interface Props {
  value: CreationOutputMode;
  onValueChange(value: CreationOutputMode): void;
  collapsed?: boolean;
}

export function CreationOutputTabs({ value, onValueChange, collapsed = false }: Props) {
  const labels = useI18n().messages.creator.outputTabs;
  const modes = [
    { value: 'results', Icon: ImagesIcon },
    { value: 'inputs', Icon: SlidersHorizontalIcon },
    { value: 'records', Icon: HistoryIcon },
  ] as const;
  return (
    <TooltipProvider>
      <Segmented
        type="single"
        appearance="line"
        value={value}
        className="min-w-0 shrink-0 border-b-0"
        onValueChange={(next) => next && onValueChange(next as CreationOutputMode)}
        aria-label={labels.title}
      >
        {modes.map(({ value: mode, Icon }) => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <SegmentedItem value={mode} className={collapsed ? 'size-8 p-0' : 'px-2'} aria-label={labels[mode]}>
                <Icon className="size-4" aria-hidden="true" />
                {!collapsed && <span className="hidden @min-[24rem]/output:inline">{labels[mode]}</span>}
              </SegmentedItem>
            </TooltipTrigger>
            <TooltipContent>{labels[mode]}</TooltipContent>
          </Tooltip>
        ))}
      </Segmented>
    </TooltipProvider>
  );
}
