import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  Minimize2Icon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import { useElementFullscreen } from '@/renderer/hooks/useElementFullscreen';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { AssetDto } from '@/shared/contracts';
import { useEffect, useLayoutEffect } from 'react';

interface Props {
  assetIds: readonly string[];
  assetsById: ReadonlyMap<string, AssetDto>;
  coverAssetId: string | null;
  copyingAssetId: string | null;
  openAssetId: string | null;
  notify(message: string): void;
  onCopy(assetId: string): void;
  onOpenAssetIdChange(assetId: string | null): void;
  onRemove(assetId: string): void;
  onSetCover(assetId: string): void;
}

export function SocialPostMediaPreview({
  assetIds,
  assetsById,
  coverAssetId,
  copyingAssetId,
  openAssetId,
  notify,
  onCopy,
  onOpenAssetIdChange,
  onRemove,
  onSetCover,
}: Props) {
  const { messages } = useI18n();
  const copy = messages.creator.socialPostEditor;
  const fileCopy = messages.assetFile;
  const { fullscreen, targetRef, toggleFullscreen } = useElementFullscreen<HTMLDivElement>();
  const availableAssets = assetIds.flatMap((assetId) => assetsById.get(assetId) ?? []);
  const selectedIndex = availableAssets.findIndex((asset) => asset.id === openAssetId);
  const selectedAsset = availableAssets[selectedIndex];
  useEffect(() => {
    if (!selectedAsset && fullscreen) void toggleFullscreen();
  }, [fullscreen, selectedAsset, toggleFullscreen]);
  useLayoutEffect(() => {
    if (selectedIndex >= 0 && !fullscreen) targetRef.current?.scrollIntoView({ block: 'nearest' });
  }, [fullscreen, selectedIndex, targetRef]);
  if (!selectedAsset) return null;

  function selectRelative(offset: number) {
    const nextIndex = (selectedIndex + offset + availableAssets.length) % availableAssets.length;
    onOpenAssetIdChange(availableAssets[nextIndex].id);
  }

  return (
    <div
      ref={targetRef}
      data-social-post-media-preview
      data-fullscreen={fullscreen || undefined}
      className={cn(
        'relative isolate flex min-w-0 flex-col overflow-hidden rounded-sm bg-surface-sunken',
        !fullscreen &&
          '@[960px]/content-workspace:sticky @[960px]/content-workspace:top-8 @[960px]/content-workspace:z-20',
        fullscreen && 'fixed inset-0 z-fullscreen h-dvh w-dvw rounded-none bg-background',
      )}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !fullscreen) return;
        event.preventDefault();
        event.stopPropagation();
        void toggleFullscreen();
      }}
    >
      <div className="flex min-h-10 shrink-0 items-center gap-1 bg-background px-1">
        <span className="min-w-0 flex-1 truncate px-1 text-xs tabular-nums text-muted-foreground">
          {selectedIndex + 1}/{availableAssets.length} · {selectedAsset.width} × {selectedAsset.height}
        </span>
        {availableAssets.length > 1 && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={copy.previousImage}
              aria-label={copy.previousImage}
              onClick={() => selectRelative(-1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={copy.nextImage}
              aria-label={copy.nextImage}
              onClick={() => selectRelative(1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
          aria-label={fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
          aria-pressed={fullscreen}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
        </Button>
        {!fullscreen && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={copy.closePreview}
            aria-label={copy.closePreview}
            onClick={() => onOpenAssetIdChange(null)}
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
      <div
        className={cn(
          'relative isolate min-w-0 overflow-hidden',
          fullscreen ? 'min-h-0 flex-1' : 'h-48 @[960px]/content-workspace:h-72',
        )}
      >
        <AssetFileContextMenu assetId={selectedAsset.id} notify={notify}>
          <div className="relative isolate size-full overflow-hidden">
            <ImageAmbientBackdrop src={selectedAsset.mediaUrl} />
            <img
              src={selectedAsset.mediaUrl}
              alt={copy.previewImage.replace('{index}', String(selectedIndex + 1))}
              width={selectedAsset.width}
              height={selectedAsset.height}
              draggable={false}
              className="relative z-10 size-full object-contain"
            />
          </div>
        </AssetFileContextMenu>
      </div>
      <div className="flex min-h-10 shrink-0 items-center justify-end gap-1 bg-background px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={fileCopy.copy}
          aria-label={fileCopy.copy}
          disabled={Boolean(copyingAssetId)}
          onClick={() => onCopy(selectedAsset.id)}
        >
          {copyingAssetId === selectedAsset.id ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={copy.setCover}
          aria-label={copy.setCover}
          disabled={coverAssetId === selectedAsset.id}
          onClick={() => onSetCover(selectedAsset.id)}
        >
          <StarIcon className={cn('size-4', coverAssetId === selectedAsset.id && 'fill-current')} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive"
          title={copy.removeImage}
          aria-label={copy.removeImage}
          onClick={() => onRemove(selectedAsset.id)}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
      {fullscreen && availableAssets.length > 1 && (
        <div className="flex h-20 shrink-0 items-center gap-2 overflow-x-auto border-t bg-background px-3 py-2">
          {availableAssets.map((asset, index) => (
            <Button
              key={asset.id}
              type="button"
              variant="ghost"
              className={cn(
                'h-14 w-11 shrink-0 overflow-hidden rounded-sm p-0',
                asset.id === selectedAsset.id && 'ring-2 ring-ring',
              )}
              aria-label={copy.previewImage.replace('{index}', String(index + 1))}
              aria-pressed={asset.id === selectedAsset.id}
              onClick={() => onOpenAssetIdChange(asset.id)}
            >
              <img
                src={mediaThumbnailUrl(asset, 192)}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="size-full object-contain"
              />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
