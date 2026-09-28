import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ArticleDeliveryJob, ArticleDeliveryProgress } from '@/shared/contracts/article-delivery';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useBackgroundIssues } from '@/renderer/features/background-issues/BackgroundIssueProvider';
import {
  articleDeliveryActive,
  articleDeliveryErrorMessage,
  articleDeliveryRequestErrorMessage,
  articleDeliveryStatusLabel,
} from '@/renderer/features/article-delivery/presentation';

export interface ArticleDeliveryEntry {
  job: ArticleDeliveryJob;
  progress?: ArticleDeliveryProgress;
}

interface DeliveryContextValue {
  entries: ArticleDeliveryEntry[];
  retryingId: string | null;
  retry(jobId: string): Promise<void>;
  dismiss(jobId: string): Promise<void>;
}

const DeliveryContext = createContext<DeliveryContextValue | null>(null);

function statusOrder(job: ArticleDeliveryJob) {
  return job.status === 'QUEUED' ? 0 : job.status === 'RUNNING' ? 1 : 2;
}

function entryPriority({ job }: ArticleDeliveryEntry) {
  return articleDeliveryActive(job) ? 0 : job.status === 'FAILED' ? 1 : 2;
}

function mergeEntry(existing: ArticleDeliveryEntry | undefined, entry: ArticleDeliveryEntry): ArticleDeliveryEntry {
  if (existing && existing.job.updatedAt > entry.job.updatedAt) return existing;
  if (existing && statusOrder(existing.job) > statusOrder(entry.job)) return existing;
  return {
    ...entry,
    progress: entry.job.status === 'RUNNING' ? (entry.progress ?? existing?.progress) : undefined,
  };
}

function mergeEntries(current: ArticleDeliveryEntry[], incoming: ArticleDeliveryEntry[]) {
  const byId = new Map(current.map((entry) => [entry.job.id, entry]));
  for (const entry of incoming) {
    byId.set(entry.job.id, mergeEntry(byId.get(entry.job.id), entry));
  }
  const sorted = [...byId.values()].sort(
    (left, right) => right.job.createdAt.localeCompare(left.job.createdAt) || right.job.id.localeCompare(left.job.id),
  );
  const retried = new Set(sorted.flatMap(({ job }) => (job.retryOfJobId ? [job.retryOfJobId] : [])));
  return sorted
    .filter(({ job }) => articleDeliveryActive(job) || !retried.has(job.id))
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
  const copy = useI18n().messages.articleDelivery;
  const { acknowledge, isAcknowledged } = useBackgroundIssues();
  const [entries, setEntries] = useState<ArticleDeliveryEntry[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const retryLock = useRef(false);
  const active = useRef(false);
  const listRequest = useRef(0);
  const listPending = useRef(false);
  const changedDuringList = useRef(new Map<string, ArticleDeliveryEntry>());
  const notification = useRef({ notify, copy, isAcknowledged });
  useEffect(() => {
    notification.current = { notify, copy, isAcknowledged };
  }, [notify, copy, isAcknowledged]);

  const invalidateList = useCallback(() => {
    active.current = false;
    listRequest.current++;
    listPending.current = false;
    changedDuringList.current.clear();
  }, []);

  const receive = useCallback((entry: ArticleDeliveryEntry) => {
    if (!active.current) return;
    if (listPending.current) {
      const previous = changedDuringList.current.get(entry.job.id);
      changedDuringList.current.set(entry.job.id, mergeEntry(previous, entry));
    }
    setEntries((current) => mergeEntries(current, [entry]));
  }, []);

  const refreshEntries = useCallback(async () => {
    if (!spaceId || !active.current) return;
    const request = ++listRequest.current;
    listPending.current = true;
    changedDuringList.current = new Map();
    try {
      const jobs = await window.desktopApi.articleDeliveryJobsList({ spaceId, limit: 50 });
      if (!active.current || request !== listRequest.current) return;
      // Replace the snapshot, preserving only events received while this request was in flight.
      setEntries(
        mergeEntries(
          jobs.map((job) => ({ job })),
          [...changedDuringList.current.values()],
        ),
      );
    } finally {
      if (request === listRequest.current) {
        listPending.current = false;
        changedDuringList.current.clear();
      }
    }
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId) return;
    active.current = true;
    let disposed = false;
    const notified = new Set<string>();
    const unsubscribe = window.desktopApi.onArticleDeliveryJobChanged((entry) => {
      if (entry.job.spaceId !== spaceId) return;
      receive(entry);
      const { job } = entry;
      const notificationKey = `${job.id}:${job.status}`;
      if (job.status === 'RUNNING' || notified.has(notificationKey)) return;
      notified.add(notificationKey);
      const { notify: show, copy: labels, isAcknowledged } = notification.current;
      if (job.status === 'FAILED' && isAcknowledged(job.backgroundIssue)) return;
      show(
        job.status === 'QUEUED'
          ? `${labels.queuedNotice} · ${job.targetSlug}`
          : job.status === 'FAILED'
            ? `${labels.status.failed} · ${job.targetSlug} · ${articleDeliveryErrorMessage(job, labels)}`
            : `${articleDeliveryStatusLabel(job, labels)} · ${job.targetSlug}`,
      );
    });
    void refreshEntries().catch((reason) => {
      if (!disposed) {
        const { notify: show, copy: labels } = notification.current;
        show(articleDeliveryRequestErrorMessage(reason, labels, labels.historyFailed));
      }
    });
    return () => {
      disposed = true;
      invalidateList();
      unsubscribe();
    };
  }, [invalidateList, receive, refreshEntries, spaceId]);

  const retry = useCallback(
    async (jobId: string) => {
      if (retryLock.current) return;
      retryLock.current = true;
      setRetryingId(jobId);
      try {
        const job = await window.desktopApi.articleDeliveryJobRetry({ jobId });
        receive({ job });
      } catch (reason) {
        const { notify: show, copy: labels } = notification.current;
        show(articleDeliveryRequestErrorMessage(reason, labels));
      } finally {
        retryLock.current = false;
        setRetryingId(null);
      }
    },
    [receive],
  );

  const dismiss = useCallback(
    async (jobId: string) => {
      const job = entries.find((entry) => entry.job.id === jobId)?.job;
      if (job?.status !== 'FAILED') return;
      await acknowledge(job.backgroundIssue, refreshEntries);
    },
    [acknowledge, entries, refreshEntries],
  );

  const visibleEntries = useMemo(
    () => entries.filter(({ job }) => job.status !== 'FAILED' || !isAcknowledged(job.backgroundIssue)),
    [isAcknowledged, entries],
  );

  const value = useMemo(
    () => ({ entries: visibleEntries, retry, retryingId, dismiss }),
    [visibleEntries, retry, retryingId, dismiss],
  );
  return <DeliveryContext.Provider value={value}>{children}</DeliveryContext.Provider>;
}

export function useArticleDeliveries() {
  const context = useContext(DeliveryContext);
  if (!context) throw new Error('Article delivery workflow is unavailable');
  return context;
}
