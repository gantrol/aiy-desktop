import { useEffect, useRef, useState } from 'react';
import type {
  BrowserCompanionBatchItemResult,
  BrowserCompanionStageInput,
  BrowserCompanionTarget,
  BrowserCompanionWatermarkSelection,
} from '@/shared/contracts';

export interface PublicationCandidate {
  sourceKey?: string;
  target: BrowserCompanionTarget;
  prepared: Omit<BrowserCompanionStageInput, 'target' | 'watermark'> | null;
  error: string | null;
  receipt?: BrowserCompanionBatchItemResult;
}

export function usePublicationBatch({
  prepare,
  sourceKey,
  watermark,
  title,
}: {
  prepare(
    targets: readonly BrowserCompanionTarget[],
    mode: 'article' | 'images',
  ): Promise<PublicationCandidate[] | null>;
  sourceKey: string;
  watermark: BrowserCompanionWatermarkSelection;
  title: string;
}) {
  const [rows, setRows] = useState<PublicationCandidate[]>([]);
  const [snapshotKey, setSnapshotKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fault, setFault] = useState<'save' | 'unknown' | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const busyRef = useRef(false);
  const uncertainRef = useRef(false);
  const preparedWatermark = useRef<BrowserCompanionWatermarkSelection | null>(null);
  const epoch = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const stale = snapshotKey !== null && sourceKey !== snapshotKey && !submitted;
  const pending = rows.some((row) => row.receipt?.result && row.receipt.result.handoff.state !== 'delivered');

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let reading = false;
    const timer = setInterval(() => {
      if (reading || busyRef.current) return;
      reading = true;
      const version = epoch.current;
      void window.desktopApi
        .browserCompanionHistory()
        .then((history) => {
          if (stopped || busyRef.current || version !== epoch.current) return;
          setHistoryFailed(false);
          setRows((current) =>
            current.map((row) => {
              const result = row.receipt?.result;
              const handoff = result && history.find((item) => item.handoffId === result.handoff.handoffId);
              return handoff
                ? {
                    ...row,
                    receipt: {
                      ...row.receipt!,
                      errorCode: handoff.state === 'ready' ? row.receipt!.errorCode : null,
                      result: { ...result!, handoff },
                    },
                  }
                : row;
            }),
          );
        })
        .catch(() => {
          if (!stopped) setHistoryFailed(true);
        })
        .finally(() => {
          reading = false;
        });
    }, 2_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending]);

  function reset() {
    if (busyRef.current || submitted) return;
    epoch.current++;
    setRows([]);
    setSnapshotKey(null);
    setFault(null);
  }

  async function preview(targets: readonly BrowserCompanionTarget[], mode: 'article' | 'images') {
    if (busyRef.current || submitted || !targets.length) return;
    busyRef.current = true;
    setBusy(true);
    setFault(null);
    setRows([]);
    setSnapshotKey(null);
    const version = ++epoch.current;
    const key = sourceKey;
    const watermarkSnapshot = structuredClone(watermark);
    try {
      const candidates = await prepare(targets, mode);
      if (!alive.current || version !== epoch.current) return;
      setRows(candidates ? structuredClone(candidates) : []);
      preparedWatermark.current = candidates ? watermarkSnapshot : null;
      setSnapshotKey(candidates ? (candidates[0]?.sourceKey ?? key) : null);
      if (!candidates) setFault('save');
    } catch {
      if (alive.current && version === epoch.current) setFault('save');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function input(row: PublicationCandidate): BrowserCompanionStageInput {
    return structuredClone({ ...row.prepared!, target: row.target, watermark: preparedWatermark.current ?? watermark });
  }

  async function open() {
    if (busyRef.current || submitted || stale) return;
    const ready = rows.filter((row) => row.prepared && !row.error);
    if (!ready.length) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitted(true);
    const version = ++epoch.current;
    try {
      const batch = await window.desktopApi.browserCompanionStageBatch({
        items: ready.map(input),
        ...(title.trim() ? { title: title.trim().slice(0, 80) } : {}),
      });
      if (!alive.current || version !== epoch.current) return;
      setRows((current) =>
        current.map((row) => ({ ...row, receipt: batch.items.find((item) => item.target === row.target) })),
      );
    } catch {
      // A lost IPC reply is not evidence that no editor opened. Do not offer a blind retry.
      uncertainRef.current = true;
      if (alive.current) setFault('unknown');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function retry(row: PublicationCandidate) {
    if (busyRef.current || uncertainRef.current || fault === 'unknown' || !row.prepared || !row.receipt) return;
    const current = rows.find((item) => item.target === row.target);
    if (!current || current.receipt !== row.receipt) return;
    const old = row.receipt.result;
    if (old && old.handoff.state !== 'ready') return;
    busyRef.current = true;
    setBusy(true);
    setFault(null);
    const version = ++epoch.current;
    try {
      const receipt = old
        ? {
            ...row.receipt,
            result: await window.desktopApi.browserCompanionReopen({ handoffId: old.handoff.handoffId }),
            errorCode: null,
          }
        : (await window.desktopApi.browserCompanionStageBatch({ items: [input(row)] })).items[0]!;
      if (!alive.current || version !== epoch.current) return;
      setRows((current) => current.map((item) => (item.target === row.target ? { ...item, receipt } : item)));
    } catch {
      uncertainRef.current = true;
      if (alive.current) setFault('unknown');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return { rows, busy, submitted, stale, fault, historyFailed, reset, preview, open, retry };
}
