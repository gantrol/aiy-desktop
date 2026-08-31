import { CheckIcon, ExternalLinkIcon, Link2Icon } from 'lucide-react';
import type { AssetDto, Locale } from '@/shared/contracts';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

interface Props {
  locale: Locale;
  sourceTitle: string;
  assets: readonly AssetDto[];
  referenceAssetIds: readonly string[];
  onOpenSource(): void;
  onToggleReference(asset: AssetDto): void;
}

export function DerivedVisualSourceContext({
  locale,
  sourceTitle,
  assets,
  referenceAssetIds,
  onOpenSource,
  onToggleReference,
}: Props) {
  const zh = locale === 'zh';
  const selectedIds = new Set(referenceAssetIds);

  return (
    <div className="flex min-h-11 min-w-0 items-center gap-2 border-b bg-surface-sunken/25 px-3">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground-secondary">
        <Link2Icon className="size-3.5" />
        {zh ? '来源' : 'Source'}
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
            const actionLabel = selected
              ? zh
                ? `移除参考图 ${index + 1}`
                : `Remove reference ${index + 1}`
              : zh
                ? `使用贴图图片 ${index + 1} 作为参考`
                : `Use post image ${index + 1} as reference`;
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
                <img
                  src={mediaThumbnailUrl(asset, 96)}
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
        title={zh ? '查看来源贴图' : 'Open source post'}
        aria-label={zh ? '查看来源贴图' : 'Open source post'}
        onClick={onOpenSource}
      >
        <ExternalLinkIcon className="size-3.5" />
      </Button>
    </div>
  );
}
