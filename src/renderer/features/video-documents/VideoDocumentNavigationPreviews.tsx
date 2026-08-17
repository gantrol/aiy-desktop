import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon, VideoIcon } from 'lucide-react';
import type { VideoDocumentNavigationEntry, VideoDocumentSummaryDto } from '@/shared/contracts';
import { AlbumCoverBadge } from '@/renderer/components/albums/AlbumTreePreview';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import { cn } from '@/renderer/lib/utils';

export function formatVideoDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function VideoDocumentAlbumPreview({
  entry,
  expanded = false,
  loading = false,
}: {
  entry: Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>;
  expanded?: boolean;
  loading?: boolean;
}) {
  return (
    <span className="relative flex h-11 w-[4.25rem] shrink-0 items-center" aria-hidden="true">
      <MediaStackPreview
        items={entry.previewAssets.map((asset) => ({ asset }))}
        size="xs"
        spread={expanded ? 'settled' : 'collapsed'}
        maxItems={3}
      />
      <AlbumCoverBadge compact />
      {(loading || entry.childCount > 0) && (
        <span className="absolute bottom-0.5 right-0.5 grid size-4 place-items-center rounded-[4px] border border-selected-border bg-overlay/95 text-selected-foreground shadow-sm backdrop-blur-sm">
          {loading ? (
            <LoaderCircleIcon className="size-2.5 animate-spin" />
          ) : expanded ? (
            <ChevronDownIcon className="size-2.5" />
          ) : (
            <ChevronRightIcon className="size-2.5" />
          )}
        </span>
      )}
    </span>
  );
}

export function VideoDocumentPreview({
  document,
  className,
}: {
  document: VideoDocumentSummaryDto;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative grid aspect-video w-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-surface text-muted-foreground shadow-sm',
        className,
      )}
    >
      <VideoIcon className="size-4" />
      {document.thumbnail ? (
        <img
          src={document.thumbnail.mediaUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : document.source.available ? (
        <AssetMedia
          asset={document.source.asset}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          muted
          preload="metadata"
        />
      ) : null}
    </span>
  );
}
