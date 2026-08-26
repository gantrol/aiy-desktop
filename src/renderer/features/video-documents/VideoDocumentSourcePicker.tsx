import { FileVideoIcon, ImagesIcon, LoaderCircleIcon, UploadIcon, VideoIcon, XIcon } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import type { GalleryItemDto } from '@/shared/contracts';
import { materialTitle, mediaMaterial } from '@/renderer/components/gallery/materialLibraryTypes';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  localFile: File | null;
  selectedGalleryVideo: GalleryItemDto | null;
  localSourceUrl: string;
  localReading: boolean;
  localDetails: string;
  localError: string;
  galleryVideos: readonly GalleryItemDto[];
  galleryLoading: boolean;
  disabled: boolean;
  onChooseGalleryVideo(item: GalleryItemDto): void;
  onClear(): void;
}

function LocalVideoPreview({ sourceUrl }: { sourceUrl: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [sourceUrl]);

  return (
    <div className="relative grid min-h-52 place-items-center">
      <video
        src={sourceUrl}
        className={cn('size-full min-h-52 object-contain transition-opacity', ready ? 'opacity-100' : 'opacity-0')}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration) && video.duration > 0)
            video.currentTime = Math.min(0.05, video.duration / 2);
        }}
        onLoadedData={() => setReady(true)}
      />
      {!ready && <LoaderCircleIcon className="absolute size-7 animate-spin text-media-checker-a/70" />}
    </div>
  );
}

function GalleryVideoGrid({
  items,
  loading,
  selectedMaterialId,
  onSelect,
}: {
  items: readonly GalleryItemDto[];
  loading: boolean;
  selectedMaterialId: string | null;
  onSelect(item: GalleryItemDto): void;
}) {
  const labels = useI18n().messages.videoDocuments.start;
  if (loading) {
    return (
      <div className="grid h-40 place-items-center">
        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!items.length) {
    return <div className="grid h-40 place-items-center text-sm text-muted-foreground">{labels.noGalleryVideos}</div>;
  }
  return (
    <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3">
      {items.map((item) => {
        const title = materialTitle(mediaMaterial(item), labels.sourceVideoFallback);
        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              'min-w-0 rounded-lg border bg-background p-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              selectedMaterialId === item.materialId && 'border-selected-border bg-selected ring-1 ring-ring',
            )}
            title={title}
            onClick={() => onSelect(item)}
          >
            <AssetMedia
              asset={item.asset}
              className="aspect-video w-full rounded-md bg-media-surround-dark object-contain"
              loading="lazy"
              muted
            />
            <span className="mt-1.5 block truncate px-0.5 text-xs">{title}</span>
          </button>
        );
      })}
    </div>
  );
}

function GalleryVideoPicker({
  items,
  loading,
  selectedMaterialId,
  disabled,
  onSelect,
}: {
  items: readonly GalleryItemDto[];
  loading: boolean;
  selectedMaterialId: string | null;
  disabled: boolean;
  onSelect(item: GalleryItemDto): void;
}) {
  const labels = useI18n().messages.videoDocuments.start;
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <ImagesIcon className="size-4" />
          {labels.chooseFromGallery}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[520px] max-w-[calc(100vw-2rem)] p-2">
        <div className="px-2 py-1.5 text-sm font-medium">{labels.galleryVideos}</div>
        <GalleryVideoGrid
          items={items}
          loading={loading}
          selectedMaterialId={selectedMaterialId}
          onSelect={(item) => {
            onSelect(item);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function VideoDocumentSourcePicker({
  inputRef,
  localFile,
  selectedGalleryVideo,
  localSourceUrl,
  localReading,
  localDetails,
  localError,
  galleryVideos,
  galleryLoading,
  disabled,
  onChooseGalleryVideo,
  onClear,
}: Props) {
  const labels = useI18n().messages.videoDocuments.start;
  const selected = Boolean(localFile || selectedGalleryVideo);
  const selectedTitle = localFile
    ? localFile.name
    : selectedGalleryVideo
      ? materialTitle(mediaMaterial(selectedGalleryVideo), labels.sourceVideoFallback)
      : '';

  return (
    <section
      className={cn(
        'relative flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-5',
        !selected && 'border-dashed border-accent-foreground/50',
      )}
    >
      {selected ? (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-media-surround-dark">
            {localFile ? (
              localSourceUrl ? (
                <LocalVideoPreview sourceUrl={localSourceUrl} />
              ) : (
                <div className="grid min-h-52 place-items-center text-media-checker-a/70">
                  {localReading ? (
                    <LoaderCircleIcon className="size-7 animate-spin" />
                  ) : (
                    <FileVideoIcon className="size-8" />
                  )}
                </div>
              )
            ) : selectedGalleryVideo ? (
              <AssetMedia
                asset={selectedGalleryVideo.asset}
                className="size-full min-h-52 object-contain"
                muted
                preload="metadata"
              />
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute top-2 right-2"
              title={labels.clearVideo}
              aria-label={labels.clearVideo}
              disabled={disabled}
              onClick={onClear}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
          <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <strong className="block truncate text-sm">{selectedTitle}</strong>
              {localDetails && <span className="mt-0.5 block text-xs text-muted-foreground">{localDetails}</span>}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
              >
                <UploadIcon className="size-4" />
                {labels.replaceVideo}
              </Button>
              <GalleryVideoPicker
                items={galleryVideos}
                loading={galleryLoading}
                selectedMaterialId={selectedGalleryVideo?.materialId ?? null}
                disabled={disabled}
                onSelect={onChooseGalleryVideo}
              />
            </div>
          </div>
          {localError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {localError}
            </p>
          )}
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center py-6 text-center">
          <div className="max-w-sm">
            <VideoIcon className="mx-auto size-14 stroke-[1.35] text-accent-foreground/75" />
            <h2 className="mt-5 text-lg font-semibold">{labels.dropOrChooseVideo}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{labels.videoRequirements}</p>
            <div className="mx-auto mt-6 grid max-w-72 gap-2.5">
              <Button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
                <UploadIcon className="size-4" />
                {labels.chooseLocalVideo}
              </Button>
              <GalleryVideoPicker
                items={galleryVideos}
                loading={galleryLoading}
                selectedMaterialId={selectedGalleryVideo?.materialId ?? null}
                disabled={disabled}
                onSelect={onChooseGalleryVideo}
              />
            </div>
            {localError && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {localError}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
