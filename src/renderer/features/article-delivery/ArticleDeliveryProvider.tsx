import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ArticleDeliveryJob, ArticleDeliveryProgress } from '@/shared/contracts/article-delivery';
import { useI18n } from '@/renderer/i18n/useI18n';
import { articleDeliveryActive, articleDeliveryErrorMessage } from '@/renderer/features/article-delivery/presentation';

export interface ArticleDeliveryEntry {
  job: ArticleDeliveryJob;
  progress?: ArticleDeliveryProgress;
}

interface DeliveryContextValue {
  entries: ArticleDeliveryEntry[];
  retryingId: string | null;
  retry(jobId: string): Promise<void>;
}

const DeliveryContext = createContext<DeliveryContextValue | null>(null);

function targetKey(job: ArticleDeliveryJob) {
  return JSON.stringify([job.spaceId, job.articleId, job.extensionId, job.channelId]);
}

function entryPriority({ job }: ArticleDeliveryEntry) {
  return articleDeliveryActive(job) ? 0 : job.status === 'FAILED' ? 1 : 2;
}

function mergeEntries(current: ArticleDeliveryEntry[], incoming: ArticleDeliveryEntry[]) {
  const byId = new Map(current.map((entry) => [entry.job.id, entry]));
  for (const entry of incoming) {
    const existing = byId.get(entry.job.id);
    if (existing && existing.job.updatedAt > entry.job.updatedAt) continue;
    byId.set(entry.job.id, {
      ...entry,
      progress: entry.job.status === 'RUNNING' ? (entry.progress ?? existing?.progress) : undefined,
    });
  }
  const sorted = [...byId.values()].sort(
    (left, right) => right.job.createdAt.localeCompare(left.job.createdAt) || right.job.id.localeCompare(left.job.id),
  );
  const targets = new Set<string>();
  return sorted
    .filter(({ job }) => {
      const key = targetKey(job);
      const latest = !targets.has(key);
      targets.add(key);
      return articleDeliveryActive(job) || latest;
    })
    .sort((left, right) => entryPriority(left) - entryPriority(right))
    .slice(0, 50);
}

export function ArticleDeliveryProvider({
  children,
  spaceId,
  notify,
}: {
  children: ReactNode;
  spaceId: string | null;
  notify(message: string): void;
}) {
  const { locale } = useI18n();
  const [entries, setEntries] = useState<ArticleDeliveryEntry[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const retryLock = useRef(false);
  const notification = useRef({ notify, locale });
  useEffect(() => {
    notification.current = { notify, locale };
  }, [notify, locale]);

  useEffect(() => {
    if (!spaceId) return;
    let disposed = false;
    const notified = new Set<string>();
    const unsubscribe = window.desktopApi.onArticleDeliveryJobChanged((entry) => {
      if (entry.job.spaceId !== spaceId) return;
      setEntries((current) => mergeEntries(current, [entry]));
      const { job } = entry;
      const notificationKey = `${job.id}:${job.status}`;
      if (job.status === 'RUNNING' || notified.has(notificationKey)) return;
      notified.add(notificationKey);
      const { notify: show, locale: language } = notification.current;
      const zh = language === 'zh';
      show(
        job.status === 'QUEUED'
          ? `${zh ? '已加入后台投递队列' : 'Queued for background delivery'} · ${job.targetSlug}`
          : job.status === 'FAILED'
            ? `${zh ? '投递失败' : 'Delivery failed'} · ${job.targetSlug}：${articleDeliveryErrorMessage(job, zh)}`
            : `${zh ? '已发布' : 'Published'} · ${job.targetSlug}`,
      );
    });
    void window.desktopApi
      .articleDeliveryJobsList({ spaceId, limit: 50 })
      .then((jobs) => {
        if (!disposed)
          setEntries((current) =>
            mergeEntries(
              jobs.map((job) => ({ job })),
              current,
            ),
          );
      })
      .catch((reason) => {
        if (!disposed) notification.current.notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [spaceId]);

  const retry = useCallback(async (jobId: string) => {
    if (retryLock.current) return;
    retryLock.current = true;
    setRetryingId(jobId);
    try {
      const job = await window.desktopApi.articleDeliveryJobRetry({ jobId });
      setEntries((current) => mergeEntries(current, [{ job }]));
    } catch (reason) {
      notification.current.notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      retryLock.current = false;
      setRetryingId(null);
    }
  }, []);

  const value = useMemo(() => ({ entries, retry, retryingId }), [entries, retry, retryingId]);
  return <DeliveryContext.Provider value={value}>{children}</DeliveryContext.Provider>;
}

export function useArticleDeliveries() {
  const context = useContext(DeliveryContext);
  if (!context) throw new Error('Article delivery workflow is unavailable');
  return context;
}
