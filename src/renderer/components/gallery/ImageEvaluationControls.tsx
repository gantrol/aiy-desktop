import type { GalleryItemDto, ImageRatingDimension } from '@/shared/contracts';
import { HeartIcon, RealityIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageRatingControl } from '@/renderer/components/gallery/ImageRatingControl';

interface Props {
  ratings: GalleryItemDto['ratings'];
  visibleDimensions: ImageRatingDimension[];
  disabled?: boolean;
  onChange(dimension: ImageRatingDimension, score: number | null): void;
}

export function ImageEvaluationControls({ ratings, visibleDimensions, disabled = false, onChange }: Props) {
  const { messages } = useI18n();
  const l = messages.gallery.evaluation;
  return (
    <div className="flex w-full flex-col gap-1">
      {visibleDimensions.includes('AESTHETIC') && (
        <ImageRatingControl
          dimension="AESTHETIC"
          label={l.aesthetic}
          accessibleLabel={l.aestheticAccessible}
          icon={HeartIcon}
          score={ratings.aesthetic?.score ?? null}
          disabled={disabled}
          onChange={(score) => onChange('AESTHETIC', score)}
        />
      )}
      {visibleDimensions.includes('REALISM') && (
        <ImageRatingControl
          dimension="REALISM"
          label={l.realism}
          accessibleLabel={l.realismAccessible}
          icon={RealityIcon}
          iconClassName="size-[18px]"
          score={ratings.realism?.score ?? null}
          disabled={disabled}
          onChange={(score) => onChange('REALISM', score)}
        />
      )}
    </div>
  );
}
