import { LayoutGridIcon, XIcon, ArrowUpRightIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { albumCoverAssets, type AlbumCoverAsset } from '@/renderer/components/albums/albumCoverAssets';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

/** Explicit inspection, independent of opening or moving the album. */
export function AlbumPreviewPopover({
  assets,
  title,
  detail,
  openLabel,
  onOpen,
  children,
}: {
  assets: readonly AlbumCoverAsset[];
  title: string;
  detail?: string;
  openLabel?: string;
  onOpen?(): void;
  children?: ReactElement;
}) {
  const { messages } = useI18n();
  const labels = messages.gallery.albums;
  const previews = albumCoverAssets(assets);
  const [expanded, setExpanded] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const navigating = useRef(false);
  if (!previews.length) return children ?? null;
  return (
    <Popover
      open={expanded}
      onOpenChange={(next) => {
        navigating.current = false;
        if (!next) setSelectedAssetId(null);
        setExpanded(next);
      }}
    >
      <PopoverTrigger asChild>
        {children ?? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-7 shrink-0 gap-1 rounded-sm px-1.5 text-muted-foreground"
            aria-label={`${labels.expandCovers}: ${title}`}
            title={labels.previewTitle(title)}
            data-action="album-preview"
          >
            <LayoutGridIcon className="size-3.5" />
            {labels.expandCovers}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        data-slot="album-preview"
        aria-label={labels.previewTitle(title)}
        align="end"
        sideOffset={8}
        collisionPadding={12}
        tabIndex={0}
        className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[28rem] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain border-border p-0 [scroll-padding-top:3.5rem] [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-ring"
        onCloseAutoFocus={(event) => {
          if (navigating.current) event.preventDefault();
        }}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-overlay px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
            {title}
          </p>
          <span
            className="text-xs tabular-nums text-muted-foreground"
            aria-label={labels.coverPreviews(previews.length)}
          >
            {previews.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mr-1 shrink-0"
            aria-label={labels.closePreview}
            onClick={() => {
              setExpanded(false);
              setSelectedAssetId(null);
            }}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="px-3">
          <div className="grid grid-cols-2 items-start gap-2 pb-3">
            {previews.map((asset, index) => {
              const selected = selectedAssetId === asset.id;
              return (
                <Button
                  key={asset.id}
                  type="button"
                  variant="ghost"
                  data-cover-preview={asset.id}
                  aria-label={labels.coverPreviewNumber(index + 1)}
                  aria-pressed={selected}
                  className={cn(
                    'relative isolate block h-auto w-full min-w-0 overflow-hidden rounded-sm bg-surface-sunken p-0 hover:bg-surface-sunken focus-visible:ring-offset-0',
                    selected || previews.length === 1 ? 'col-span-2 max-h-96' : 'max-h-64',
                    selected && 'ring-2 ring-inset ring-ring',
                  )}
                  style={{
                    aspectRatio: Math.max(
                      0.75,
                      Math.min(1.5, getSourceMediaAspectRatio(asset.width ?? 0, asset.height ?? 0, 4 / 3)),
                    ),
                  }}
                  onClick={() => setSelectedAssetId(selected ? null : asset.id)}
                >
                  <AssetThumbnail
                    asset={asset}
                    errorClassName="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2"
                    size={512}
                    alt=""
                    className="absolute inset-0 size-full object-contain"
                  />
                </Button>
              );
            })}
          </div>
        </div>
        {(detail || onOpen) && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t px-3 py-2">
            {detail && <span className="min-w-0 break-words text-xs text-muted-foreground">{detail}</span>}
            {onOpen && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  navigating.current = true;
                  setExpanded(false);
                  setSelectedAssetId(null);
                  onOpen();
                }}
              >
                {openLabel ?? labels.open}
                <ArrowUpRightIcon className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
