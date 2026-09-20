import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { BrowserCompanionBatchResult } from '@/shared/contracts';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';

export function CompanionBatchHistory({
  active,
  refreshKey,
  onDeleted,
}: {
  active: boolean;
  refreshKey: unknown;
  onDeleted?(handoffIds: readonly string[]): void;
}) {
  const { messages, locale } = useI18n();
  const copy = messages.publishing;
  const companion = messages.browserCompanion;
  const [batches, setBatches] = useState<BrowserCompanionBatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    void window.desktopApi
      .browserCompanionBatchHistory()
      .then((result) => {
        if (!stopped) {
          setBatches(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!stopped) setError(copy.historyError);
      });
    return () => {
      stopped = true;
    };
  }, [active, refreshKey, revision, copy.historyError]);

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

  if (!batches.length && !error) return null;
  return (
    <details className="mb-5 border-b pb-4" data-publication-batch-history>
      <summary className="cursor-pointer text-sm font-medium">
        {copy.batchHistory} · {batches.length}
      </summary>
      {error && (
        <p role="status" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 grid max-h-96 gap-4 overflow-y-auto">
        {batches.map((batch) => (
          <section key={batch.batchId} className="grid gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
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
        ))}
      </div>
    </details>
  );
}
