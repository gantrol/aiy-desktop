import { CheckCircle2Icon, Clock3Icon, LoaderCircleIcon, RefreshCwIcon, XCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ArticleDeliveryJob } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useArticleDeliveries } from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import {
  articleDeliveryErrorMessage,
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
  zh,
}: {
  articleId: string;
  notify(message: string): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  spaceId: string;
  targets: readonly DeliveryTargetLabel[];
  zh: boolean;
}) {
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
        if (!disposed) notify(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [articleId, notify, open, spaceId]);

  async function retry(jobId: string) {
    if (retryingId) return;
    setRetryingId(jobId);
    try {
      const job = await window.desktopApi.articleDeliveryJobRetry({ jobId });
      setJobs((current) => mergeJobs(current, [job]));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{zh ? '投递记录' : 'Delivery history'}</DialogTitle>
        </DialogHeader>
        {jobs.some((job) => job.status === 'FAILED') && (
          <p className="text-xs text-muted-foreground">
            {zh
              ? '重试会使用当时的文章版本；修改图片或正文后，请重新投递。'
              : 'Retry uses the original article version. After editing images or text, deliver the article again.'}
          </p>
        )}
        <div className="max-h-96 divide-y divide-border overflow-y-auto">
          {loading && jobs.length === 0 ? (
            <div className="flex h-16 items-center justify-center">
              <LoaderCircleIcon className="size-4 animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{zh ? '暂无记录' : 'No deliveries'}</div>
          ) : (
            jobs.map((job) => {
              const targetName = targetNames.get(`${job.extensionId}:${job.channelId}`) ?? job.targetSlug;
              return (
                <div key={job.id} className="flex items-start gap-3 py-3">
                  <div className="mt-0.5">{jobIcon(job)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{targetName}</span>
                      {job.result && <span className="text-muted-foreground">v{job.result.version}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {articleDeliveryStatusLabel(job, zh, entries.find((entry) => entry.job.id === job.id)?.progress)}{' '}
                      · {new Date(job.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}
                    </div>
                    {job.result && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {zh
                          ? `图片：新增 ${job.result.uploadedMedia} · 复用 ${job.result.reusedMedia}`
                          : `Images: ${job.result.uploadedMedia} new · ${job.result.reusedMedia} reused`}
                      </div>
                    )}
                    {job.status === 'FAILED' && (
                      <div className="mt-1 break-words text-xs text-destructive">
                        {articleDeliveryErrorMessage(job, zh)}
                      </div>
                    )}
                  </div>
                  {job.status === 'FAILED' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={retryingId !== null}
                      aria-label={zh ? '重试' : 'Retry'}
                      onClick={() => void retry(job.id)}
                    >
                      {retryingId === job.id ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="size-4" />
                      )}
                      {zh ? '重试' : 'Retry'}
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
