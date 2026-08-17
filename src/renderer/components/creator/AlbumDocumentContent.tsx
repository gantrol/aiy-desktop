import { LoaderCircleIcon } from 'lucide-react';
import type { VideoDocumentSummaryDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import {
  formatVideoDuration,
  VideoDocumentPreview,
} from '@/renderer/features/video-documents/VideoDocumentNavigationPreviews';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AlbumDocumentRow({
  document,
  albumId,
  onSelectDocument,
}: {
  document: VideoDocumentSummaryDto;
  albumId: string;
  onSelectDocument?(documentId: string, albumId: string | null): void;
}) {
  const openDocument = () => onSelectDocument?.(document.id, albumId);
  return (
    <li
      data-album-direct-document
      className="group flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover focus-within:bg-hover"
    >
      <button
        type="button"
        className="flex h-[4.25rem] w-16 shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        title={document.title}
        aria-label={document.title}
        onClick={openDocument}
      >
        <VideoDocumentPreview document={document} />
      </button>
      <button
        type="button"
        className="flex h-[4.25rem] min-w-0 flex-1 flex-col justify-center overflow-hidden rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        title={document.title}
        aria-label={document.title}
        onClick={openDocument}
      >
        <strong className="line-clamp-2 block w-full min-w-0 whitespace-normal break-words text-base font-medium leading-5">
          {document.title}
        </strong>
        <span className="mt-0.5 text-xs text-muted-foreground">
          {formatVideoDuration(document.source.asset.durationMs)}
        </span>
      </button>
    </li>
  );
}

export function AlbumDocumentView({
  documents,
  total,
  loading,
  loadingMore,
  hasMore,
  onSelectDocument,
  onLoadMore,
}: {
  documents: readonly VideoDocumentSummaryDto[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onLoadMore(): void;
}) {
  const labels = useI18n().messages.videoDocuments;

  if (loading && documents.length === 0) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4 overflow-hidden p-4 sm:p-6">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="aspect-[4/3] rounded-xl" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <strong className="text-sm font-medium">{labels.empty}</strong>
      </div>
    );
  }

  return (
    <ScrollArea
      type="always"
      className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
    >
      <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4 p-4 sm:p-6">
        {documents.map((document) => (
          <button
            key={document.id}
            type="button"
            className="group min-w-0 overflow-hidden rounded-xl border bg-surface text-left shadow-sm outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
            title={document.title}
            aria-label={`${labels.sidebar.open}: ${document.title}`}
            onClick={() => onSelectDocument(document.id, document.albumId)}
          >
            <VideoDocumentPreview
              document={document}
              className="w-full rounded-b-none border-x-0 border-t-0 shadow-none"
            />
            <span className="block min-w-0 p-3">
              <strong className="line-clamp-2 block break-words text-sm font-medium leading-5">{document.title}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                {formatVideoDuration(document.source.asset.durationMs)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex min-h-16 items-center justify-center px-4 pb-6 text-xs text-muted-foreground">
        {loadingMore ? (
          <LoaderCircleIcon className="size-4 animate-spin" aria-label={labels.loadMore} />
        ) : hasMore ? (
          <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
            {labels.loadMore}
          </Button>
        ) : (
          <span>{labels.sidebar.itemCount(total)}</span>
        )}
      </div>
    </ScrollArea>
  );
}
