import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import type { AssetDto, Locale } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';

interface Props {
  assetIds: readonly string[];
  assetsById: ReadonlyMap<string, AssetDto>;
  copyingAssetId: string | null;
  copyLabel: string;
  locale: Locale;
  openAssetId: string | null;
  notify(message: string): void;
  onCopy(assetId: string): void;
  onOpenAssetIdChange(assetId: string | null): void;
  coverAssetId?: string | null;
  dataDialog?: string;
  onRemove?(assetId: string): void;
  onSetCover?(assetId: string): void;
}

function PreviewThumbnail({
  asset,
  index,
  selected,
  zh,
  onSelect,
}: {
  asset: AssetDto;
  index: number;
  selected: boolean;
  zh: boolean;
  onSelect(): void;
}) {
  const thumbnailUrl = mediaThumbnailUrl(asset, 192);
  return (
    <button
      type="button"
      className={cn(
        'relative isolate h-14 w-11 shrink-0 overflow-hidden rounded-md bg-surface-sunken ring-1 ring-inset ring-foreground/10 outline-none hover:ring-2 hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-ring',
      )}
      aria-label={zh ? `查看图片 ${index + 1}` : `View image ${index + 1}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <ImageAmbientBackdrop src={thumbnailUrl} loading="lazy" />
      <img
        src={thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="relative z-10 size-full object-contain"
      />
    </button>
  );
}

export function MediaPreviewDialog({
  assetIds,
  assetsById,
  copyingAssetId,
  copyLabel,
  locale,
  openAssetId,
  notify,
  onCopy,
  onOpenAssetIdChange,
  coverAssetId = null,
  dataDialog = 'media-preview',
  onRemove,
  onSetCover,
}: Props) {
  const zh = locale === 'zh';
  const availableAssets = assetIds.flatMap((assetId) => assetsById.get(assetId) ?? []);
  const selectedIndex = Math.max(
    0,
    availableAssets.findIndex((asset) => asset.id === openAssetId),
  );
  const selectedAsset = availableAssets[selectedIndex] ?? null;
  const open = Boolean(openAssetId && selectedAsset);

  function selectRelative(offset: number) {
    if (!availableAssets.length) return;
    const nextIndex = (selectedIndex + offset + availableAssets.length) % availableAssets.length;
    onOpenAssetIdChange(availableAssets[nextIndex].id);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenAssetIdChange(null)}>
      <DialogContent
        data-dialog={dataDialog}
        className="h-[calc(100vh-2rem)] max-w-[min(96vw,96rem)] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{zh ? '图片预览' : 'Image preview'}</DialogTitle>
        <DialogClose asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute top-4 right-4 z-30 shadow-overlay"
            title={zh ? '关闭' : 'Close'}
            aria-label={zh ? '关闭' : 'Close'}
          >
            <XIcon className="size-4" />
          </Button>
        </DialogClose>
        {selectedAsset && (
          <>
            <div className="relative isolate min-h-0 overflow-hidden bg-surface-sunken">
              <AssetFileContextMenu assetId={selectedAsset.id} notify={notify}>
                <div className="relative isolate size-full overflow-hidden">
                  <ImageAmbientBackdrop src={selectedAsset.mediaUrl} />
                  <img
                    src={selectedAsset.mediaUrl}
                    alt=""
                    width={selectedAsset.width}
                    height={selectedAsset.height}
                    draggable={false}
                    className="relative z-10 size-full object-contain"
                  />
                </div>
              </AssetFileContextMenu>
              <span className="absolute top-4 left-4 z-20 rounded-md bg-overlay/90 px-2 py-1 text-xs tabular-nums shadow-overlay">
                {selectedIndex + 1}/{availableAssets.length} · {selectedAsset.width} × {selectedAsset.height}
              </span>
              {availableAssets.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute top-1/2 left-4 z-20 -translate-y-1/2 shadow-overlay"
                    title={zh ? '上一张' : 'Previous image'}
                    aria-label={zh ? '上一张' : 'Previous image'}
                    onClick={() => selectRelative(-1)}
                  >
                    <ChevronLeftIcon className="size-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute top-1/2 right-4 z-20 -translate-y-1/2 shadow-overlay"
                    title={zh ? '下一张' : 'Next image'}
                    aria-label={zh ? '下一张' : 'Next image'}
                    onClick={() => selectRelative(1)}
                  >
                    <ChevronRightIcon className="size-5" />
                  </Button>
                </>
              )}
              <div className="absolute right-4 bottom-4 z-20 flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shadow-overlay"
                  disabled={Boolean(copyingAssetId)}
                  onClick={() => onCopy(selectedAsset.id)}
                >
                  {copyingAssetId === selectedAsset.id ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )}
                  {copyLabel}
                </Button>
                {onSetCover && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shadow-overlay"
                    disabled={coverAssetId === selectedAsset.id}
                    onClick={() => onSetCover(selectedAsset.id)}
                  >
                    <StarIcon className={cn('size-4', coverAssetId === selectedAsset.id && 'fill-current')} />
                    {zh ? '设为首图' : 'Set as cover'}
                  </Button>
                )}
                {onRemove && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shadow-overlay"
                    onClick={() => onRemove(selectedAsset.id)}
                  >
                    <Trash2Icon className="size-4" />
                    {zh ? '移除' : 'Remove'}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex h-20 items-center gap-2 overflow-x-auto border-t bg-surface-sunken px-12 py-2">
              {availableAssets.map((asset, index) => (
                <PreviewThumbnail
                  key={asset.id}
                  asset={asset}
                  index={index}
                  selected={asset.id === selectedAsset.id}
                  zh={zh}
                  onSelect={() => onOpenAssetIdChange(asset.id)}
                />
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
