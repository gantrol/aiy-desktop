import {
  CheckCircle2Icon,
  Clock3Icon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ArticleDeliveryJob } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useArticleDeliveries } from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import {
  articleDeliveryErrorMessage,
  articleDeliveryImageSummary,
  articleDeliveryRequestErrorMessage,
  articleDeliveryStatusLabel,
} from '@/renderer/features/article-delivery/presentation';

type DeliveryTargetLabel = {
  extensionId: string;
  channelId: string;
  displayName: string;
};

function jobIcon(job: ArticleDeliveryJob) {
  if (job.status === 'SUCCEEDED') return <CheckCircle2Icon className="size-4 text-success" />;
  if (job.status === 'FAILED') return <XCircleIcon className="size-4 text-destructive" />;
  if (job.status === 'RUNNING') return <LoaderCircleIcon className="size-4 animate-spin text-foreground" />;
  return <Clock3Icon className="size-4 text-muted-foreground" />;
}

function mergeJobs(current: ArticleDeliveryJob[], incoming: ArticleDeliveryJob[]) {
  const byId = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) {
    const existing = byId.get(job.id);
    if (!existing || existing.updatedAt <= job.updatedAt) byId.set(job.id, job);
  }
  return [...byId.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, 20);
}

export function ArticleDeliveryHistoryDialog({
  articleId,
  notify,
  onOpenChange,
  open,
  spaceId,
  targets,
}: {
  articleId: string;
  notify(message: string): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  spaceId: string;
  targets: readonly DeliveryTargetLabel[];
}) {
  const { locale, messages } = useI18n();
  const copy = messages.articleDelivery;
  const [jobs, setJobs] = useState<ArticleDeliveryJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const { entries } = useArticleDeliveries();
  const targetNames = useMemo(
    () => new Map(targets.map((target) => [`${target.extensionId}:${target.channelId}`, target.displayName])),
    [targets],
  );

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const changed = new Map<string, ArticleDeliveryJob>();
    const unsubscribe = window.desktopApi.onArticleDeliveryJobChanged(({ job }) => {
      if (job.spaceId !== spaceId || job.articleId !== articleId) return;
      changed.set(job.id, job);
      setJobs((current) => mergeJobs(current, [job]));
    });
    setJobs([]);
    setLoading(true);
    void window.desktopApi
      .articleDeliveryJobsList({ spaceId, articleId, limit: 20 })
      .then((loaded) => {
        if (!disposed) setJobs(mergeJobs(loaded, [...changed.values()]));
      })
      .catch((reason) => {
        if (!disposed) notify(articleDeliveryRequestErrorMessage(reason, copy, copy.historyFailed));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [articleId, copy, notify, open, spaceId]);

  async function retry(jobId: string) {
    if (retryingId) return;
    setRetryingId(jobId);
    try {
      const job = await window.desktopApi.articleDeliveryJobRetry({ jobId });
      setJobs((current) => mergeJobs(current, [job]));
    } catch (reason) {
      notify(articleDeliveryRequestErrorMessage(reason, copy));
    } finally {
      setRetryingId(null);
    }
  }

  async function openResult(url: string) {
    try {
      await window.desktopApi.contentLibrary.linkOpen(url);
    } catch (reason) {
      notify(articleDeliveryRequestErrorMessage(reason, copy, copy.openFailed));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{copy.history}</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 divide-y divide-border overflow-y-auto">
          {loading && jobs.length === 0 ? (
            <div className="flex h-16 items-center justify-center">
              <LoaderCircleIcon className="size-4 animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{copy.emptyHistory}</div>
          ) : (
            jobs.map((job) => {
              const targetName = targetNames.get(`${job.extensionId}:${job.channelId}`) ?? job.targetSlug;
              const imageSummary = articleDeliveryImageSummary(job.result?.imageSummary, locale, copy);
              return (
                <div key={job.id} className="flex items-start gap-3 py-3">
                  <div className="mt-0.5">{jobIcon(job)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{targetName}</span>
                      {job.result && <span className="text-muted-foreground">v{job.result.version}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {articleDeliveryStatusLabel(
                        job,
                        copy,
                        entries.find((entry) => entry.job.id === job.id)?.progress,
                      )}{' '}
                      · {new Date(job.createdAt).toLocaleString(locale)}
                    </div>
                    {job.result && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {copy.imageCounts
                          .replace('{uploaded}', String(job.result.uploadedMedia))
                          .replace('{reused}', String(job.result.reusedMedia))}
                      </div>
                    )}
                    {imageSummary && <div className="mt-1 text-xs text-muted-foreground">{imageSummary}</div>}
                    {job.status === 'FAILED' && (
                      <div className="mt-1 break-words text-xs text-destructive">
                        {articleDeliveryErrorMessage(job, copy)}
                      </div>
                    )}
                  </div>
                  {job.status === 'FAILED' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={retryingId !== null}
                      className="shrink-0"
                      title={copy.retryHint}
                      aria-label={copy.retry}
                      onClick={() => void retry(job.id)}
                    >
                      {retryingId === job.id ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="size-4" />
                      )}
                      {copy.retry}
                    </Button>
                  )}
                  {job.status === 'SUCCEEDED' && job.result && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() =>
                        void openResult(
                          job.result!.deliveryMode === 'PUBLISH' ? job.result!.publicUrl : job.result!.adminUrl,
                        )
                      }
                    >
                      <ExternalLinkIcon className="size-4" />
                      {job.result.deliveryMode === 'PUBLISH'
                        ? copy.viewPublished
                        : job.result.deliveryMode === 'DRAFT'
                          ? copy.viewDraft
                          : copy.viewUpload}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
