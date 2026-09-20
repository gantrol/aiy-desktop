import { CheckCircle2Icon, Clock3Icon, LoaderCircleIcon, RefreshCwIcon, XCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  useArticleDeliveries,
  type ArticleDeliveryEntry,
} from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import {
  articleDeliveryErrorMessage,
  articleDeliveryStatusLabel,
} from '@/renderer/features/article-delivery/presentation';

export function ArticleDeliveryTaskItem({ entry }: { entry: ArticleDeliveryEntry }) {
  const copy = useI18n().messages.articleDelivery;
  const { retry, retryingId } = useArticleDeliveries();
  const { job, progress } = entry;
  const Icon =
    job.status === 'FAILED'
      ? XCircleIcon
      : job.status === 'SUCCEEDED'
        ? CheckCircle2Icon
        : job.status === 'RUNNING'
          ? LoaderCircleIcon
          : Clock3Icon;
  return (
    <div className="flex items-start gap-2 border-b px-3 py-2 text-xs last:border-b-0">
      <Icon
        className={`mt-0.5 size-3.5 shrink-0 ${job.status === 'FAILED' ? 'text-destructive' : job.status === 'RUNNING' ? 'animate-spin' : 'text-muted-foreground'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate" title={job.targetSlug}>
          {copy.title} · {job.targetSlug}
        </div>
        <div className={job.status === 'FAILED' ? 'mt-1 text-destructive' : 'mt-1 text-muted-foreground'}>
          {articleDeliveryStatusLabel(job, copy, progress)}
        </div>
        {job.status === 'FAILED' && (
          <div className="mt-1 break-words text-destructive">{articleDeliveryErrorMessage(job, copy)}</div>
        )}
      </div>
      {job.status === 'FAILED' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-xs"
          disabled={retryingId !== null}
          title={copy.retryHint}
          onClick={() => void retry(job.id)}
        >
          {retryingId === job.id ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
          {copy.retry}
        </Button>
      )}
    </div>
  );
}
