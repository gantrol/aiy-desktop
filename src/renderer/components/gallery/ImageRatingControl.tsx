import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';

interface Props {
  dimension: 'AESTHETIC' | 'REALISM';
  label: string;
  accessibleLabel: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconClassName?: string;
  score: number | null;
  disabled?: boolean;
  onChange(score: number | null): void;
}

export function ImageRatingControl({
  dimension,
  label,
  accessibleLabel,
  icon: RatingIcon,
  iconClassName,
  score,
  disabled = false,
  onChange,
}: Props) {
  const { messages } = useI18n();
  return (
    <div
      data-rating-control={dimension}
      className="flex w-full items-center justify-between gap-1"
      role="group"
      aria-label={accessibleLabel}
    >
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((value) => {
          const selected = score != null && value <= score;
          const buttonLabel = messages.gallery.rating.score(accessibleLabel, value, score === value);

          return (
            <Button
              key={value}
              type="button"
              data-rating-score={value}
              variant="ghost"
              size="icon-sm"
              className="size-6 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={buttonLabel}
              aria-pressed={score === value}
              title={buttonLabel}
              disabled={disabled}
              onClick={() => onChange(score === value ? null : value)}
            >
              <RatingIcon className={cn('size-3.5', iconClassName, selected && 'fill-current text-foreground')} />
            </Button>
          );
        })}
      </div>
    </div>
  );
}
