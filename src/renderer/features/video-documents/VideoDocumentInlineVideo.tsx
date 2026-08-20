import { ChevronUpIcon, PlayIcon, VideoIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { cn } from '@/renderer/lib/utils';

interface Props {
  mediaUrl: string;
  posterUrl: string | null;
  title: string;
  children: ReactNode;
  expandLabel: string;
  collapseLabel: string;
}

export function VideoDocumentInlineVideo({ mediaUrl, posterUrl, title, children, expandLabel, collapseLabel }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <figure className="overflow-hidden rounded-lg border bg-surface">
      {expanded ? (
        <video
          className="aspect-video w-full bg-media-surround-dark object-contain"
          src={mediaUrl}
          poster={posterUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
        />
      ) : (
        <button
          type="button"
          className={cn(
            'group relative isolate block aspect-video w-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            posterUrl ? 'bg-surface-sunken' : 'bg-media-surround-dark',
          )}
          aria-label={expandLabel}
          onClick={() => setExpanded(true)}
        >
          {posterUrl ? (
            <>
              <ImageAmbientBackdrop src={posterUrl} loading="lazy" />
              <img src={posterUrl} alt="" className="relative z-10 size-full object-contain" loading="lazy" />
            </>
          ) : (
            <span className="grid size-full place-items-center text-white/70">
              <VideoIcon className="size-9" />
            </span>
          )}
          <span className="absolute inset-0 z-20 grid place-items-center bg-black/10 transition-colors group-hover:bg-black/20">
            <span className="grid size-12 place-items-center rounded-full bg-black/65 text-white shadow-sm">
              <PlayIcon className="ml-0.5 size-5 fill-current" />
            </span>
          </span>
        </button>
      )}
      <figcaption className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={title}>
          {children}
        </span>
        {expanded && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            aria-label={collapseLabel}
            onClick={() => setExpanded(false)}
          >
            <ChevronUpIcon className="size-3.5" />
          </Button>
        )}
      </figcaption>
    </figure>
  );
}
