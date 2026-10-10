import { useMemo, useRef, useState, type RefObject } from 'react';
import { PlayIcon } from 'lucide-react';
import type { AssetDto, GalleryItemDto } from '@/shared/contracts';
import type { MaterialImagePickerImage } from '@/renderer/components/gallery/materialImagePicker';
import type { useMaterialImagePickerMaterials } from '@/renderer/components/gallery/useMaterialImagePickerData';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { AssetNavigationButton } from '@/renderer/components/media/AssetNavigationButton';
import { AssetMedia, isVideoAsset } from '@/renderer/components/media/AssetMedia';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { useWorkspacePaneContainer, useWorkspaceVisible } from '@/renderer/components/workspace/WorkspacePaneScope';
import { ShortestColumnMasonry } from '@/renderer/components/ui/shortest-column-masonry';
import { formatVideoDocumentDuration } from '@/renderer/features/video-documents/useVideoDocumentLocalFile';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

function MaterialImagePickerCandidate({
  asset,
  index,
  selectedIndex,
  disabled,
  chooseLabel,
  disabledReason,
  durationMs,
  onPreview,
  onToggle,
}: {
  asset: AssetDto;
  index: number;
  selectedIndex: number;
  disabled: boolean;
  chooseLabel: string;
  disabledReason?: string;
  durationMs?: number;
  onPreview(): void;
  onToggle(assetId: string): void;
}) {
  const selected = selectedIndex >= 0;
  const labels = useI18n().messages.gallery.imagePicker;
  return (
    <div className="group/candidate relative min-w-0">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        title={disabledReason}
        aria-label={`${chooseLabel}: ${index + 1} · ${asset.width}×${asset.height}`}
        data-picker-asset-id={asset.id}
        aria-pressed={selected}
        className={cn(
          'relative isolate block aspect-[4/3] h-auto w-full overflow-hidden rounded-sm border-2 border-transparent bg-surface-sunken p-0 hover:border-border-strong focus-visible:ring-inset focus-visible:ring-offset-0',
          selected && 'border-selected-border ring-2 ring-ring',
        )}
        onClick={() => onToggle(asset.id)}
      >
        <AssetThumbnail
          asset={asset}
          size={512}
          ambient
          width={asset.width}
          height={asset.height}
          className="relative z-10 size-full object-contain"
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        {selected && (
          <span className="absolute right-2 top-2 z-20 grid size-6 place-items-center rounded-sm border border-selected-border bg-selected text-xs font-semibold tabular-nums text-selected-foreground">
            {selectedIndex + 1}
          </span>
        )}
        {isVideoAsset(asset) && durationMs !== undefined && (
          <span className="absolute bottom-1 right-1 z-20 rounded-sm bg-overlay/90 px-1 text-xs tabular-nums">
            {formatVideoDocumentDuration(durationMs)}
          </span>
        )}
      </Button>
      <div className="absolute left-1 top-1 z-20 rounded-sm bg-overlay/90 opacity-0 group-hover/candidate:opacity-100 group-focus-within/candidate:opacity-100 [@media(hover:none)]:opacity-100">
        <AssetNavigationButton assetId={asset.id} intent="MATERIAL" />
      </div>
      {isVideoAsset(asset) && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="absolute bottom-1 left-1 z-20 bg-overlay/90"
          aria-label={labels.previewVideo}
          onClick={onPreview}
        >
          <PlayIcon className="size-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}

export function MaterialImagePickerResults({
  state,
  pending,
  selectedImages,
  maxSelected,
  selectionDisabledReason,
  chooseLabel,
  emptyLabel,
  viewportRef,
  onToggle,
}: {
  state: ReturnType<typeof useMaterialImagePickerMaterials>;
  pending: boolean;
  selectedImages: readonly MaterialImagePickerImage[];
  maxSelected: number;
  selectionDisabledReason?(item: GalleryItemDto): string | undefined;
  chooseLabel: string;
  emptyLabel: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  onToggle(assetId: string): void;
}) {
  const { messages } = useI18n();
  const paneContainer = useWorkspacePaneContainer();
  const visible = useWorkspaceVisible();
  const layoutItems = useMemo(
    () => state.images.map(({ asset }) => ({ id: asset.id, aspectRatio: 4 / 3 })),
    [state.images],
  );
  const [preview, setPreview] = useState<AssetDto | null>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  return (
    <>
      <ScrollArea
        aria-busy={state.loading}
        data-stale={state.stale ? 'true' : undefined}
        className="min-h-0 flex-1"
        viewportRef={viewportRef}
      >
        <div className="p-3">
          {pending && state.images.length === 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="aspect-[4/3] animate-none rounded-sm" />
              ))}
            </div>
          )}
          <ShortestColumnMasonry
            items={layoutItems}
            viewportRef={viewportRef}
            virtualize
            minColumnWidth={144}
            gap={8}
            virtualOverscan={320}
            renderItem={(_entry, index) => {
              if (!visible) return null;
              const { asset, item } = state.images[index];
              const selectedIndex = selectedImages.findIndex((image) => image.id === asset.id);
              const disabledReason = selectedIndex < 0 ? selectionDisabledReason?.(item) : undefined;
              return (
                <MaterialImagePickerCandidate
                  key={asset.id}
                  asset={asset}
                  index={index}
                  selectedIndex={selectedIndex}
                  disabled={
                    state.stale ||
                    Boolean(disabledReason) ||
                    (selectedIndex < 0 && selectedImages.length >= maxSelected)
                  }
                  disabledReason={disabledReason}
                  durationMs={item.durationMs}
                  onPreview={() => {
                    previewTrigger.current =
                      document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    setPreview(asset);
                  }}
                  chooseLabel={chooseLabel}
                  onToggle={onToggle}
                />
              );
            }}
          />
          {state.loaded && !state.loading && !state.failed && !state.nextCursor && state.images.length === 0 && (
            <div role="status" className="col-span-full grid min-h-32 place-items-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          )}
          {state.nextCursor && (
            <div className="col-span-full flex justify-center py-2">
              <Button
                type="button"
                variant="outline"
                disabled={state.stale || state.loadingMore}
                onClick={() => void state.loadMore()}
              >
                {state.loadingMore ? messages.gallery.screen.loadingMore : messages.gallery.screen.loadMore}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
      <Dialog container={paneContainer} open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-3xl rounded-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previewTrigger.current?.isConnected) previewTrigger.current.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>{messages.gallery.imagePicker.previewVideo}</DialogTitle>
          {preview && (
            <AssetMedia asset={preview} controls preload="none" className="max-h-[70dvh] w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
