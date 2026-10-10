import { useI18n } from '@/renderer/i18n/useI18n';
import { searchRelevanceLevel, type SearchRelevanceChannel } from '@/shared/search-relevance';

const levels = ['LOW', 'BORDERLINE', 'MODERATE', 'HIGH', 'VERY_HIGH'] as const;

export function SearchRelevance({
  score,
  channel,
  borderline = false,
}: {
  score: number | null | undefined;
  channel: SearchRelevanceChannel;
  borderline?: boolean;
}) {
  const { messages } = useI18n();
  const copy = messages.imageSearch;
  const level = searchRelevanceLevel(score, channel, borderline);
  if (!level) return null;
  const filled = levels.indexOf(level) + 1;
  return (
    <span
      role="meter"
      aria-label={copy.relevance}
      aria-valuemin={1}
      aria-valuemax={levels.length}
      aria-valuenow={filled}
      aria-valuetext={copy.relevanceLevels[level]}
      className="inline-flex h-1.5 w-12 shrink-0 gap-px overflow-hidden rounded-[1px] align-middle forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText] forced-colors:forced-color-adjust-none"
    >
      {levels.map((segment, index) => (
        <span
          key={segment}
          aria-hidden="true"
          className={`min-w-0 flex-1 ${index < filled ? 'bg-foreground-secondary forced-colors:bg-[CanvasText]' : 'bg-foreground/15 forced-colors:bg-[Canvas]'}`}
        />
      ))}
    </span>
  );
}
