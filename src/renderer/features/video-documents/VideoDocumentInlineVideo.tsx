import { ChevronUpIcon, PlayIcon, VideoIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';

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
          className="group relative block aspect-video w-full overflow-hidden bg-media-surround-dark outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={expandLabel}
          onClick={() => setExpanded(true)}
        >
          {posterUrl ? (
            <img src={posterUrl} alt="" className="size-full object-contain" loading="lazy" />
          ) : (
            <span className="grid size-full place-items-center text-white/70">
              <VideoIcon className="size-9" />
            </span>
          )}
          <span className="absolute inset-0 grid place-items-center bg-black/10 transition-colors group-hover:bg-black/20">
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
