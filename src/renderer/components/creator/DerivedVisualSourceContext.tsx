import { CheckIcon, ExternalLinkIcon, Link2Icon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

interface Props {
  sourceTitle: string;
  assets: readonly AssetDto[];
  referenceAssetIds: readonly string[];
  onOpenSource(): void;
  onToggleReference(asset: AssetDto): void;
}

export function DerivedVisualSourceContext({
  sourceTitle,
  assets,
  referenceAssetIds,
  onOpenSource,
  onToggleReference,
}: Props) {
  const labels = useI18n().messages.creator.derivedVisual;
  const selectedIds = new Set(referenceAssetIds);

  return (
    <div className="flex min-h-11 min-w-0 items-center gap-2 border-b bg-surface-sunken/25 px-3">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground-secondary">
        <Link2Icon className="size-3.5" />
        {labels.source}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 min-w-0 max-w-48 justify-start px-2"
        title={sourceTitle}
        onClick={onOpenSource}
      >
        <span className="truncate">{sourceTitle}</span>
      </Button>
      {assets.length > 0 && (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
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
                  'relative size-7 shrink-0 overflow-hidden rounded-md p-0 ring-1 ring-inset ring-foreground/10',
                  selected && 'ring-2 ring-ring',
                )}
                title={actionLabel}
                aria-label={actionLabel}
                aria-pressed={selected}
                onClick={() => onToggleReference(asset)}
              >
                <AssetThumbnail
                  asset={asset}
                  size={96}
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
      )}
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
