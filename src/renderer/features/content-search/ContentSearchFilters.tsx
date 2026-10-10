import { useId } from 'react';
import { ChevronDownIcon, FileTextIcon, ImagesIcon, LayersIcon, MessageSquareTextIcon, VideoIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useI18n } from '@/renderer/i18n/useI18n';
import { workspaceSearchKindSchema } from '@/shared/contracts/image-search';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

const contentIcons = {
  ALL: LayersIcon,
  ARTICLE: FileTextIcon,
  SOCIAL_POST: MessageSquareTextIcon,
  VIDEO_DOCUMENT: VideoIcon,
  IMAGE: ImagesIcon,
};

export function ContentSearchFilters({
  value,
  onChange,
  compact = false,
}: {
  value: AppLocation['search']['type'];
  onChange(value: AppLocation['search']['type']): void;
  compact?: boolean;
}) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline.lookup;
  const typeLabel = (type: AppLocation['search']['type']) =>
    type === 'ALL' ? copy.workspaceAll : type === 'VIDEO_DOCUMENT' ? messages.imageSearch.videos.title : copy[type];
  const descriptionId = useId();
  const selectType = (next: string) => {
    const parsed = workspaceSearchKindSchema.safeParse(next);
    if (parsed.success) onChange(parsed.data);
  };
  if (compact) {
    const CurrentIcon = contentIcons[value];
    const currentLabel = typeLabel(value);
    return (
      <DropdownMenu>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2"
                  aria-label={copy.contentType}
                  aria-describedby={descriptionId}
                >
                  <CurrentIcon aria-hidden="true" className="size-4" />
                  <span id={descriptionId} className="sr-only">
                    {currentLabel}
                  </span>
                  <ChevronDownIcon aria-hidden="true" className="size-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{currentLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup aria-label={copy.contentType} value={value} onValueChange={selectType}>
            {workspaceSearchKindSchema.options.map((type) => {
              const Icon = contentIcons[type];
              return (
                <DropdownMenuRadioItem key={type} value={type} className="gap-2">
                  <Icon aria-hidden="true" className="size-4" />
                  {typeLabel(type)}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <Segmented
      type="single"
      value={value}
      onValueChange={selectType}
      aria-label={copy.contentType}
      className="h-8 justify-start gap-0.5 bg-transparent p-0"
    >
      {workspaceSearchKindSchema.options.map((type) => {
        const Icon = contentIcons[type];
        const label = typeLabel(type);
        return (
          <SegmentedItem
            key={type}
            value={type}
            aria-label={label}
            title={label}
            className="size-8 shrink-0 p-0 data-[state=on]:border-transparent data-[state=on]:bg-selected data-[state=on]:text-selected-foreground data-[state=on]:hover:bg-selected data-[state=on]:active:bg-selected"
          >
            <Icon aria-hidden="true" className="size-4" />
          </SegmentedItem>
        );
      })}
    </Segmented>
  );
}
