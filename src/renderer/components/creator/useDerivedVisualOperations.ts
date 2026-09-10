import { useEffect, useRef, useState } from 'react';
import type { DerivedVisualAdoptInput } from '@/shared/contracts';
import type {
  DerivedVisualOperationDetails,
  DerivedVisualOperationDto,
  DerivedVisualOperationRequest,
} from '@/shared/contracts/derived-visual-operations';
import { derivedVisualOperationRequestSchema } from '@/shared/contracts/derived-visual-operations';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';

export type DerivedVisualOperationRunner = (
  request: DerivedVisualOperationRequest,
) => Promise<DerivedVisualOperationDto | null>;
interface Options {
  spaceId: string;
  visualId: string;
  targetRevisionId: string | null;
  run: DerivedVisualOperationRunner;
  refresh(): Promise<void>;
}

function sameRequest(left: DerivedVisualOperationRequest, right: DerivedVisualOperationRequest) {
  return (
    JSON.stringify(derivedVisualOperationRequestSchema.parse(left)) ===
    JSON.stringify(derivedVisualOperationRequestSchema.parse(right))
  );
}

export function useDerivedVisualOperations({ spaceId, visualId, targetRevisionId, run, refresh }: Options) {
  const copy = useI18n().messages.creator.derivedVisual.adoption;
  const [operations, setOperations] = useState<DerivedVisualOperationDto[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<DerivedVisualOperationRequest | null>(null);
  const [details, setDetails] = useState<DerivedVisualOperationDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const execute = useStableCallback(run);
  const refreshTarget = useStableCallback(refresh);
  const refreshKnownResult = useStableCallback((operation: DerivedVisualOperationDto) => {
    if (operation.status === 'SUCCEEDED')
      void refreshTarget().catch(() => {
        if (mounted.current) setError(copy.refreshFailed);
      });
  });
  const update = useStableCallback((operation: DerivedVisualOperationDto) =>
    setOperations((current) =>
      [...new Map([...current, operation].map((item) => [item.request.requestId, item])).values()].sort(
        (a, b) => b.sequence - a.sequence,
      ),
    ),
  );
  const load = useStableCallback(async (beforeSequence: number | null = null) => {
    const generation = ++listGeneration.current;
    setLoading(true);
    try {
      const page = await window.desktopApi.derivedVisualOperationsList({
        spaceId,
        id: visualId,
        beforeSequence,
        limit: 20,
      });
      if (!mounted.current || listGeneration.current !== generation) return;
      setOperations((current) =>
        beforeSequence === null
          ? page.operations
          : [...new Map([...current, ...page.operations].map((item) => [item.request.requestId, item])).values()].sort(
              (a, b) => b.sequence - a.sequence,
            ),
      );
      setNext(page.nextBeforeSequence);
      setError(null);
    } catch {
      if (mounted.current && listGeneration.current === generation) setError(copy.loadFailed);
    } finally {
      if (mounted.current && listGeneration.current === generation) setLoading(false);
    }
  });
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      listGeneration.current += 1;
      detailGeneration.current += 1;
    };
  }, [load]);

  const inspect = useStableCallback(async (requestId: string) => {
    const generation = ++detailGeneration.current;
    setDetailLoading(true);
    setDetails(null);
    try {
      const result = await window.desktopApi.derivedVisualOperationGet({ spaceId, id: visualId, requestId });
      if (!mounted.current || detailGeneration.current !== generation) return;
      if (!result) {
        setError(copy.receiptMissing);
        return;
      }
      update(result.operation);
      setDetails(result);
    } catch {
      if (mounted.current && detailGeneration.current === generation) setError(copy.compareFailed);
    } finally {
      if (mounted.current && detailGeneration.current === generation) setDetailLoading(false);
    }
  });
  const check = useStableCallback(async (request: DerivedVisualOperationRequest) => {
    try {
      const result = await window.desktopApi.derivedVisualOperationGet({
        spaceId,
        id: visualId,
        requestId: request.requestId,
      });
      if (!mounted.current) return;
      if (result) {
        if (!sameRequest(result.operation.request, request)) throw new Error('DERIVED_VISUAL_UNMATCHED_RECEIPT');
        update(result.operation);
        refreshKnownResult(result.operation);
        setUnknown(null);
        setError(null);
        if (result.operation.status === 'CONFLICT') setDetails(result);
      }
    } catch {
      if (mounted.current) setError(copy.unknown);
    }
  });
  const runRequest = useStableCallback(async (request: DerivedVisualOperationRequest) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await execute(request);
      if (!mounted.current) return;
      if (result && !sameRequest(result.request, request)) throw new Error('DERIVED_VISUAL_UNMATCHED_RECEIPT');
      setUnknown(null);
      if (result) {
        update(result);
        if (result.status === 'CONFLICT') await inspect(result.request.requestId);
        else setDetails(null);
      }
    } catch {
      if (!mounted.current) return;
      setUnknown(request);
      setError(copy.unknown);
      // Query the committed result before offering any retry; this does not repeat the mutation.
      await check(request);
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        void load();
      }
    }
  });
  const cancel = useStableCallback(async (request: DerivedVisualOperationRequest) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await window.desktopApi.derivedVisualOperationCancel({
        ...request,
      });
      if (!mounted.current) return;
      update(result);
      refreshKnownResult(result);
      setUnknown(null);
      setError(null);
      void load();
    } catch {
      if (mounted.current) setError(copy.cancelFailed);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  });
  const blocked = busy || loading || Boolean(unknown || error) || operations.some((item) => item.status === 'PENDING');
  return {
    operations,
    loading,
    busy,
    error,
    unknown,
    details,
    detailLoading,
    blocked,
    reload: () => load(),
    loadMore: next ? () => load(next) : null,
    inspect,
    check,
    cancel,
    retry: runRequest,
    closeDetails() {
      detailGeneration.current += 1;
      setDetails(null);
      setDetailLoading(false);
    },
    adopt(
      imageAssetId: string,
      intent: DerivedVisualAdoptInput['intent'],
      options?: Pick<DerivedVisualAdoptInput, 'relocateAfterText' | 'imageAlt'> & { expectedRevisionId?: string },
    ) {
      if (blocked || !targetRevisionId) return;
      void runRequest({
        kind: 'ADOPT',
        id: visualId,
        spaceId,
        requestId: crypto.randomUUID(),
        imageAssetId,
        intent,
        expectedRevisionId: targetRevisionId,
        ...options,
      });
    },
    adoptReviewed(operation: DerivedVisualOperationDto) {
      if (
        blocked ||
        operation.status !== 'CONFLICT' ||
        operation.conflictReason === 'VISUAL_CHANGED' ||
        operation.request.kind !== 'ADOPT' ||
        !operation.observedRevisionId
      )
        return;
      void runRequest({
        ...operation.request,
        requestId: crypto.randomUUID(),
        expectedRevisionId: operation.observedRevisionId,
      });
    },
    undo(operation: DerivedVisualOperationDto) {
      if (
        blocked ||
        operation.status !== 'SUCCEEDED' ||
        operation.request.kind !== 'ADOPT' ||
        !operation.resultRevisionId ||
        operation.undoneByRequestId
      )
        return;
      void runRequest({
        kind: 'UNDO',
        id: visualId,
        spaceId,
        requestId: crypto.randomUUID(),
        adoptionRequestId: operation.request.requestId,
        expectedRevisionId: operation.resultRevisionId,
      });
    },
  };
}
