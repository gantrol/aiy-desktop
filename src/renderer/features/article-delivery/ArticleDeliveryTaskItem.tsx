import { useState } from 'react';
import {
  CheckCircle2Icon,
  Clock3Icon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  useArticleDeliveries,
  type ArticleDeliveryEntry,
} from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import {
  articleDeliveryErrorMessage,
  articleDeliveryStatusLabel,
} from '@/renderer/features/article-delivery/presentation';

export function ArticleDeliveryTaskItem({
  entry,
  onNavigate,
  onDismiss,
}: {
  entry: ArticleDeliveryEntry;
  onNavigate?(): void;
  onDismiss?(): void;
}) {
  const copy = useI18n().messages.articleDelivery;
  const { dismiss, retry, retryingId } = useArticleDeliveries();
  const [actionError, setActionError] = useState('');
  const { job, progress } = entry;
  function openArticle() {
    setActionError('');
    if (openAppContentLink(`aiy://open/space/${job.spaceId}/article/${job.articleId}`)) onNavigate?.();
    else setActionError(copy.openArticleFailed);
  }

  async function openResult() {
    if (!job.result) return;
    setActionError('');
    try {
      await window.desktopApi.contentLibrary.linkOpen(
        job.result.deliveryMode === 'PUBLISH' ? job.result.publicUrl : job.result.adminUrl,
      );
      onNavigate?.();
    } catch {
      setActionError(copy.openFailed);
    }
  }
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
        {actionError && (
          <div role="alert" className="mt-1 break-words text-destructive">
            {actionError}
          </div>
        )}
      </div>
      {job.status === 'FAILED' && job.retryable && (
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
      {job.status === 'FAILED' && !job.retryable && (
        <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={openArticle}>
          {copy.openArticle}
        </Button>
      )}
      {job.status === 'FAILED' && job.backgroundIssue && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          title={copy.dismiss}
          aria-label={copy.dismiss}
          onClick={() => {
            void dismiss(job.id);
            onDismiss?.();
          }}
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
      {job.status === 'SUCCEEDED' && job.result && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          title={copy.viewUpload}
          aria-label={copy.viewUpload}
          onClick={() => void openResult()}
        >
          <ExternalLinkIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
