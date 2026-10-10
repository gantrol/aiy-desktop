import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, ImagesIcon, Link2Icon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { cn } from '@/renderer/lib/utils';
import type { TaskRecipeSnapshot } from '@/shared/contracts/task-recipe';
import { TaskRecipeHistory } from '@/renderer/components/palette/TaskRecipeHistory';

interface Props {
  recipe?: TaskRecipeSnapshot;
  sourceTitle: string;
  assets: readonly AssetDto[];
  referenceAssetIds: readonly string[];
  onOpenSource(): void;
  onToggleReference(asset: AssetDto): void;
}

export function DerivedVisualSourceContext({
  recipe,
  sourceTitle,
  assets,
  referenceAssetIds,
  onOpenSource,
  onToggleReference,
}: Props) {
  const { locale, messages } = useI18n();
  const labels = messages.creator.derivedVisual;
  const selectedIds = new Set(referenceAssetIds);

  return (
    <div className="flex min-h-10 min-w-0 items-center gap-2 border-b border-border/60 px-8">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground-secondary">
        <Link2Icon className="size-3.5" />
        {labels.source}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 min-w-0 flex-1 shrink justify-start px-0"
        title={sourceTitle}
        onClick={onOpenSource}
      >
        <span className="truncate">{sourceTitle}</span>
      </Button>
      {assets.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2" aria-label={labels.sourceImages}>
              <ImagesIcon className="size-3.5" />
              <span className="hidden @min-[560px]:inline [@media(pointer:coarse)]:inline">{labels.sourceImages}</span>
              <span className="tabular-nums">{new Intl.NumberFormat(locale).format(assets.length)}</span>
              <ChevronDownIcon className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] p-3" aria-label={labels.sourceImages}>
            <div className="mb-2 text-xs font-medium">{labels.sourceImages}</div>
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto p-1">
              {assets.map((asset, index) => {
                const selected = selectedIds.has(asset.id);
                const actionLabel = selected ? labels.removeReference(index + 1) : labels.useSourceReference(index + 1);
                return (
                  <Button
                    key={asset.id}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      'relative aspect-square size-auto overflow-hidden rounded-sm p-0 ring-1 ring-inset ring-foreground/10',
                      selected && 'ring-2 ring-ring',
                    )}
                    title={actionLabel}
                    aria-label={actionLabel}
                    aria-pressed={selected}
                    onClick={() => onToggleReference(asset)}
                  >
                    <AssetThumbnail
                      asset={asset}
                      size={192}
                      alt=""
                      width={asset.width}
                      height={asset.height}
                      className="size-full bg-media-surround-light object-contain"
                      draggable={false}
                    />
                    {selected && (
                      <span className="pointer-events-none absolute right-0.5 bottom-0.5 grid size-3.5 place-items-center rounded-sm bg-overlay text-foreground">
                        <CheckIcon className="size-2.5" />
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
      <TaskRecipeHistory recipe={recipe} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        title={labels.openSource}
        aria-label={labels.openSource}
        onClick={onOpenSource}
      >
        <ExternalLinkIcon className="size-3.5" />
      </Button>
    </div>
  );
}
