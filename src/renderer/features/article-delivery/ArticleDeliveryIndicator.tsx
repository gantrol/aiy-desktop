import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useArticleDeliveries } from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import {
  articleDeliveryActive,
  articleDeliveryErrorMessage,
  articleDeliveryStatusLabel,
} from '@/renderer/features/article-delivery/presentation';

export function ArticleDeliveryIndicator({
  articleId,
  spaceId,
  zh,
  onOpenHistory,
}: {
  articleId: string;
  spaceId: string;
  zh: boolean;
  onOpenHistory(): void;
}) {
  const { entries } = useArticleDeliveries();
  const relevant = entries.filter(({ job }) => job.articleId === articleId && job.spaceId === spaceId);
  const entry =
    relevant.find(({ job }) => job.status === 'FAILED') ?? relevant.find(({ job }) => articleDeliveryActive(job));
  if (!entry) return null;
  const failed = entry.job.status === 'FAILED';
  const label = articleDeliveryStatusLabel(entry.job, zh, entry.progress);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={failed ? 'h-7 gap-1 text-xs text-destructive' : 'h-7 gap-1 text-xs text-muted-foreground'}
      aria-label={`${label} · ${zh ? '查看投递记录' : 'View delivery history'}`}
      title={failed ? articleDeliveryErrorMessage(entry.job, zh) : label}
      onClick={onOpenHistory}
    >
      {failed ? <CircleAlertIcon className="size-3.5" /> : <LoaderCircleIcon className="size-3.5 animate-spin" />}
      <span role="status" aria-live="polite">
        {label}
      </span>
    </Button>
  );
}
