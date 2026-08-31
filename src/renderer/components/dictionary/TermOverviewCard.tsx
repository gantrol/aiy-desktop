import { CheckIcon, PlusIcon } from 'lucide-react';
import type { CSSProperties, SyntheticEvent } from 'react';
import type { TermListItem } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import './TermOverviewCard.css';
import { DEFAULT_MEDIA_ASPECT_RATIO, getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import {
  chooseImageOverlayTone,
  sampleImageOverlayTone,
  type ImageOverlayTone,
} from '@/renderer/components/media/imageOverlayTone';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { MediaOverlayActionButton } from '@/renderer/components/media/MediaOverlayActionButton';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';

export type TermCardOverlayTone = ImageOverlayTone;
/** @deprecated Term cards now use a fixed light foreground over a dark scrim. */
export const chooseTermCardOverlayTone = chooseImageOverlayTone;
/** @deprecated Term cards no longer sample media at render time. */
export const sampleTermCardOverlayTone = sampleImageOverlayTone;

export interface TermOverviewCardProps {
  term: TermListItem;
  selected: boolean;
  addLabel: string;
  selectedLabel: string;
  openLabel?: string;
  className?: string;
  onOpen(term: TermListItem): void;
  onToggle(term: TermListItem): void;
}

const DEFAULT_CARD_ASPECT_RATIO = DEFAULT_MEDIA_ASPECT_RATIO;
const TERM_CARD_THUMBNAIL_SIZE = 512;
const TERM_CARD_BACKDROP_THUMBNAIL_SIZE = 192;
const TERM_CARD_OVERLAY_MOTION_STYLE = {
  transitionDuration: 'var(--motion-overlay)',
  transitionTimingFunction: 'var(--ease-enter)',
} satisfies CSSProperties;

/** Matches gallery cards by preserving the uncropped source image ratio. */
export function getTermCardAspectRatio(width: number, height: number) {
  return getSourceMediaAspectRatio(width, height, DEFAULT_CARD_ASPECT_RATIO);
}

function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  image.hidden = false;
  const card = image.closest('[data-term-overview-card]') as HTMLElement | null;
  const fallback = card?.querySelector('[data-media-fallback]') as HTMLElement | null;
  if (fallback) fallback.hidden = true;
}

function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  image.hidden = true;
  const card = image.closest('[data-term-overview-card]') as HTMLElement | null;
  const fallback = card?.querySelector('[data-media-fallback]') as HTMLElement | null;
  if (fallback) fallback.hidden = false;
}

export function TermOverviewCard({
  term,
  selected,
  addLabel,
  selectedLabel,
  openLabel,
  className,
  onOpen,
  onToggle,
}: TermOverviewCardProps) {
  const preview = term.mediaPreview.items[0];
  const secondaryName = term.localizations.find((item) => item.title !== term.title)?.title ?? '';
  const placeholder = (term.title || secondaryName || '?').slice(0, 1).toUpperCase();
  const cardAspectRatio = preview
    ? getTermCardAspectRatio(preview.asset.width, preview.asset.height)
    : DEFAULT_CARD_ASPECT_RATIO;

  return (
    <article
      data-term-overview-card
      data-term-id={term.id}
      data-selected={selected}
      data-media-aspect-ratio={cardAspectRatio.toFixed(3)}
      className={cn(
        'corner-continuous group relative isolate h-auto min-w-0 self-start overflow-hidden rounded-xl border border-border bg-surface transition-colors duration-fast hover:border-border-strong',
        selected && 'border-selected-border hover:border-selected-border',
        className,
        'h-auto',
      )}
    >
      <button
        type="button"
        data-action="open-term"
        className="relative z-10 block w-full min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={openLabel ? `${openLabel}: ${term.title}` : undefined}
        onClick={() => onOpen(term)}
      >
        <span
          data-media-frame
          data-overlay-tone="light"
          className="relative isolate block w-full overflow-hidden bg-surface-sunken"
          style={{ aspectRatio: cardAspectRatio }}
        >
          {preview && (
            <>
              <ImageAmbientBackdrop
                src={mediaThumbnailUrl(preview.asset, TERM_CARD_BACKDROP_THUMBNAIL_SIZE)}
                loading="lazy"
                crossOrigin="anonymous"
              />
              <img
                data-asset-id={preview.asset.id}
                className="absolute inset-0 z-10 size-full object-contain transition-transform duration-overlay ease-enter motion-reduce:transform-none motion-reduce:transition-none group-hover:scale-[1.015]"
                crossOrigin="anonymous"
                src={mediaThumbnailUrl(preview.asset, TERM_CARD_THUMBNAIL_SIZE)}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                style={{
                  objectPosition: `${preview.focalX * 100}% ${preview.focalY * 100}%`,
                  transformOrigin: `${preview.focalX * 100}% ${preview.focalY * 100}%`,
                }}
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
            </>
          )}
          <span
            data-media-fallback
            hidden={Boolean(preview)}
            className="absolute inset-0 z-10 grid place-items-center bg-surface-sunken text-4xl font-semibold text-foreground"
            aria-hidden="true"
          >
            {placeholder}
          </span>
          <span
            data-term-overlay
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex min-w-0 flex-col px-3 py-3 text-media-checker-a"
          >
            <span
              data-image-overlay-copy-scrim
              aria-hidden="true"
              className="absolute inset-x-0 -top-20 bottom-0 z-0 [background:var(--image-overlay-copy-scrim)]"
            />
            <span
              data-term-copy
              className="relative z-10 flex min-w-0 flex-col gap-1 opacity-100 transition-[color,opacity] duration-base ease-enter motion-reduce:transition-none group-hover:duration-fast group-hover:ease-exit group-hover:opacity-0 group-has-[:focus-visible]:opacity-100"
              style={TERM_CARD_OVERLAY_MOTION_STYLE}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <strong className="min-w-0 truncate text-sm font-semibold">{term.title}</strong>
                {secondaryName && <span className="min-w-0 truncate text-xs opacity-75">{secondaryName}</span>}
              </span>
              {term.definition && <span className="line-clamp-2 text-xs leading-5 opacity-85">{term.definition}</span>}
            </span>
          </span>
        </span>
      </button>
      <MediaOverlayActionButton
        type="button"
        data-action="toggle-term"
        active={selected}
        aria-pressed={selected}
        onClick={() => onToggle(term)}
      >
        {selected ? <CheckIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
        <span className="truncate">{selected ? selectedLabel : addLabel}</span>
      </MediaOverlayActionButton>
    </article>
  );
}
