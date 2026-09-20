import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useArticleDeliveries } from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import {
  articleDeliveryActive,
  articleDeliveryErrorMessage,
  articleDeliveryStatusLabel,
} from '@/renderer/features/article-delivery/presentation';

export function ArticleDeliveryIndicator({
  articleId,
  spaceId,
  onOpenHistory,
}: {
  articleId: string;
  spaceId: string;
  onOpenHistory(): void;
}) {
  const copy = useI18n().messages.articleDelivery;
  const { entries } = useArticleDeliveries();
  const relevant = entries.filter(({ job }) => job.articleId === articleId && job.spaceId === spaceId);
  const entry =
    relevant.find(({ job }) => job.status === 'FAILED') ?? relevant.find(({ job }) => articleDeliveryActive(job));
  if (!entry) return null;
  const failed = entry.job.status === 'FAILED';
  const label = articleDeliveryStatusLabel(entry.job, copy, entry.progress);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={failed ? 'h-7 gap-1 text-xs text-destructive' : 'h-7 gap-1 text-xs text-muted-foreground'}
      aria-label={`${label} · ${copy.viewHistory}`}
      title={failed ? articleDeliveryErrorMessage(entry.job, copy) : label}
      onClick={onOpenHistory}
    >
      {failed ? <CircleAlertIcon className="size-3.5" /> : <LoaderCircleIcon className="size-3.5 animate-spin" />}
      <span role="status" aria-live="polite">
        {label}
      </span>
    </Button>
  );
}
