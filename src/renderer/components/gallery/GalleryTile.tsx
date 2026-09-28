import type { GalleryItemDto, GallerySourceFilter, ImageRatingDimension } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Badge } from '@/renderer/components/ui/badge';
import { ImageEvaluationControls } from '@/renderer/components/gallery/ImageEvaluationControls';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { MediaCardCaption } from '@/renderer/components/media/MediaCardCaption';

interface Props {
  item: GalleryItemDto;
  filter: GallerySourceFilter;
  visibleDimensions: ImageRatingDimension[];
  ratingBusy: boolean;
  onOpen(item: GalleryItemDto): void;
  onScore(item: GalleryItemDto, dimension: ImageRatingDimension, score: number | null): void;
}

export function GalleryTile({ item, filter, visibleDimensions, ratingBusy, onOpen, onScore }: Props) {
  const { messages } = useI18n();
  const labels = messages.gallery.tile;
  const dictionaryFirst = filter === 'DICTIONARY' || (!item.creation && Boolean(item.dictionary));
  const favoriteOnly = !item.creation && !item.dictionary && Boolean(item.favorite);
  const keyboardRatingDimension = visibleDimensions[0];
  const title = favoriteOnly
    ? labels.favorite
    : dictionaryFirst
      ? item.dictionary?.termName
      : item.creation?.seriesTitle;
  const dimensions = `${item.asset.width} × ${item.asset.height}`;
  const detail = favoriteOnly
    ? dimensions
    : dictionaryFirst
      ? `${labels.dictionary}${item.dictionary?.additionalTermCount ? ` +${item.dictionary.additionalTermCount}` : ''} · ${dimensions}`
      : item.creation?.versionNo == null
        ? `${labels.imported} · ${dimensions}`
        : `V${String(item.creation.versionNo).padStart(2, '0')} · ${dimensions}`;
  const openLabel = labels.open(title ?? labels.image);

  return (
    <article
      data-media-card
      data-gallery-item={item.id}
      data-gallery-source={item.source}
      className="group overflow-hidden rounded-md bg-surface"
    >
      <button
        type="button"
        className="relative block w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={openLabel}
        onClick={() => onOpen(item)}
        onKeyDown={(event) => {
          const value = Number(event.key);
          if (keyboardRatingDimension && Number.isInteger(value) && value >= 1 && value <= 5) {
            event.preventDefault();
            onScore(item, keyboardRatingDimension, value);
          }
        }}
      >
        <div className="relative isolate grid aspect-[3/4] place-items-center overflow-hidden bg-surface-sunken">
          <ImageAmbientBackdrop src={item.asset.mediaUrl} loading="lazy" />
          <img
            className="relative z-10 size-full object-contain"
            src={item.asset.mediaUrl}
            alt=""
            loading="lazy"
            draggable={false}
          />
        </div>
        {item.source === 'BOTH' && (
          <Badge variant="outline" className="absolute top-2 left-2 z-20 bg-overlay/90 text-[10px] backdrop-blur-sm">
            {labels.both}
          </Badge>
        )}
        <MediaCardCaption>
          <strong className="block truncate text-sm font-semibold">{title}</strong>
          <span className="block truncate text-xs font-normal opacity-85">{detail}</span>
        </MediaCardCaption>
      </button>
      {visibleDimensions.length > 0 && (
        <div
          data-gallery-visible-ratings={visibleDimensions.join(',')}
          className={cn('flex items-center justify-center px-2', visibleDimensions.length === 1 ? 'h-11' : 'h-[68px]')}
        >
          <ImageEvaluationControls
            ratings={item.ratings}
            visibleDimensions={visibleDimensions}
            disabled={ratingBusy}
            onChange={(dimension, nextScore) => onScore(item, dimension, nextScore)}
          />
        </div>
      )}
    </article>
  );
}
