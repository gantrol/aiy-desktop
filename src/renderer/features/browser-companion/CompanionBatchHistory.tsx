import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { VirtualList } from '@/renderer/components/ui/virtual-list';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { BrowserCompanionBatchResult, BrowserCompanionHistoryItem } from '@/shared/contracts';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';

export function CompanionBatchHistory({
  active,
  history = [],
  onRefresh = noop,
  onDeleted,
}: {
  active: boolean;
  history?: readonly BrowserCompanionHistoryItem[];
  onRefresh?(): void;
  onDeleted?(handoffIds: readonly string[]): void;
}) {
  const { messages, locale } = useI18n();
  const copy = messages.publishing;
  const companion = messages.browserCompanion;
  const [batches, setBatches] = useState<BrowserCompanionBatchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !open) return;
    let stopped = false;
    void window.desktopApi
      .browserCompanionBatchHistory({ includeHistory: false })
      .then((result) => {
        if (!stopped) {
          setBatches(result);
          setLoaded(true);
          setError(null);
        }
      })
      .catch(() => {
        if (!stopped) setError(copy.historyError);
      });
    return () => {
      stopped = true;
    };
  }, [active, open, revision, copy.historyError]);
  const currentBatches = useMemo(() => {
    const byId = new Map(history.map((item) => [item.handoffId, item]));
    const byTarget = new Map<string, BrowserCompanionHistoryItem | null>();
    for (const item of history) {
      if (!item.batchId) continue;
      const key = `${item.batchId}:${item.target}`;
      byTarget.set(key, byTarget.has(key) ? null : item);
    }
    return batches.map((batch) => ({
      ...batch,
      items: batch.items.map((item) => {
        const handoff = item.result
          ? byId.get(item.result.handoff.handoffId)
          : byTarget.get(`${batch.batchId}:${item.target}`);
        if (!handoff || handoff.batchId !== batch.batchId || handoff.target !== item.target) return item;
        return {
          ...item,
          result: { ...(item.result ?? { browserOpened: false, browserOpenError: null }), handoff },
          errorCode: handoff.state !== 'ready' ? null : item.result ? item.errorCode : ('OPEN_NOT_CONFIRMED' as const),
        };
      }),
    }));
  }, [history, batches]);

  async function reopen(handoffId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await window.desktopApi.browserCompanionReopen({
        handoffId,
      });
      setError(result.browserOpenError ? companion.openErrors[result.browserOpenError] : null);
      setRevision((current) => current + 1);
      onRefresh();
    } catch {
      setError(copy.unknown);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function deleteCandidate(batchId: string, target: BrowserCompanionBatchResult['items'][number]['target']) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await window.desktopApi.browserCompanionDelete({
        batchId,
        targets: [target],
      });
      setBatches((current) =>
        current.flatMap((batch) => {
          if (batch.batchId !== batchId) return [batch];
          const items = batch.items.filter((item) => item.target !== target);
          return items.length ? [{ ...batch, items }] : [];
        }),
      );
      setError(null);
      onDeleted?.(result.deletedHandoffIds);
      onRefresh();
      setRevision((current) => current + 1);
    } catch {
      setError(copy.deleteFailed);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function status(item: BrowserCompanionBatchResult['items'][number]) {
    const handoff = item.result?.handoff;
    if (handoff?.state === 'delivered') return copy.delivered;
    if (handoff?.state === 'claimed') return copy.claimed;
    if (item.errorCode === 'NOT_ATTEMPTED') return copy.notAttempted;
    if (item.errorCode === 'OPEN_NOT_CONFIRMED') return copy.openNotConfirmed;
    if (item.errorCode === 'HANDOFF_NOT_ALLOWED') return copy.denied;
    if (item.errorCode === 'STAGE_FAILED') return copy.restage;
    const parsed = browserCompanionStageErrorCodeSchema.safeParse(item.errorCode);
    if (parsed.success) return companion.stageErrors[parsed.data];
    return item.result?.browserOpenError ? companion.openErrors[item.result.browserOpenError] : copy.waiting;
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mb-5 border-b pb-4"
      data-publication-batch-history
    >
      <summary className="cursor-pointer text-sm font-medium">
        {copy.batchHistory}
        {loaded ? ` · ${batches.length}` : ''}
      </summary>
      {error && (
        <p role="status" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {active && open && (
        <div ref={viewportRef} className="mt-3 max-h-96 overflow-y-auto">
          <VirtualList
            items={currentBatches}
            itemKey={batchKey}
            viewportRef={viewportRef}
            estimatedHeight={160}
            renderItem={(batch) => (
              <section className="grid gap-2 border-t py-3">
                <p className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(batch.createdAt))}
                </p>
                {batch.items.map((item) => (
                  <div key={item.target} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">{companion.targets[item.target]}</span>
                    <span className="text-muted-foreground">{status(item)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void deleteCandidate(batch.batchId, item.target)}
                    >
                      {copy.deleteCandidate}
                    </Button>
                    {item.result?.handoff.state === 'ready' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void reopen(item.result!.handoff.handoffId)}
                      >
                        {copy.reopen}
                      </Button>
                    )}
                  </div>
                ))}
              </section>
            )}
          />
        </div>
      )}
    </details>
  );
}

function batchKey(batch: BrowserCompanionBatchResult) {
  return batch.batchId;
}

function noop() {}
