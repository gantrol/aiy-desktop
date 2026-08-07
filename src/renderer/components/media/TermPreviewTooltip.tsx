import { useState, type ReactElement, type SyntheticEvent } from 'react';
import type { TermListItem } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { sampleImageOverlayTone, type ImageOverlayTone } from '@/renderer/components/media/imageOverlayTone';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';

interface Props {
  term: TermListItem;
  children: ReactElement;
}

export function TermPreviewTooltip({ term, children }: Props) {
  const preview = term.mediaPreview.items[0];
  const [tone, setTone] = useState<ImageOverlayTone>('light');
  const secondaryName = term.localizations.find((item) => item.title !== term.title)?.title ?? '';

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    setTone(sampleImageOverlayTone(event.currentTarget));
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className={preview ? 'w-44 overflow-hidden p-0' : 'max-w-80'}>
        {preview ? (
          <div className="relative">
            <img
              className="max-h-72 w-full bg-background/10 object-contain"
              crossOrigin="anonymous"
              src={preview.asset.mediaUrl}
              alt=""
              style={{ aspectRatio: `${preview.asset.width} / ${preview.asset.height}` }}
              onLoad={handleImageLoad}
            />
            <div
              data-overlay-tone={tone}
              className={cn(
                'pointer-events-none absolute inset-x-0 bottom-0 grid gap-0.5 p-2.5',
                tone === 'dark' ? 'text-media-surround-dark' : 'text-media-checker-a',
              )}
            >
              <strong className="truncate text-xs font-medium">{term.title}</strong>
              {secondaryName && <span className="truncate text-[11px] opacity-70">{secondaryName}</span>}
            </div>
          </div>
        ) : (
          term.modelExpressions[0]?.positive || secondaryName
        )}
      </TooltipContent>
    </Tooltip>
  );
}
