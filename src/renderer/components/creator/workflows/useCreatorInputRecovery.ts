import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type {
  CreatorInputRecoveryScope,
  CreatorInputRecoverySnapshot,
} from '@/shared/contracts/creator-input-recovery';
import { CreatorInputRecoverySession } from '@/renderer/components/creator/workflows/CreatorInputRecoverySession';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  scope: CreatorInputRecoveryScope | null;
  capture(): CreatorInputRecoverySnapshot;
  snapshot: CreatorInputRecoverySnapshot;
  restore(snapshot: CreatorInputRecoverySnapshot): void;
}
const empty = { status: 'saved' as const, remote: null, changed: false };
const subscribeEmpty = () => () => {};
const getEmpty = () => empty;

export function useCreatorInputRecovery(options: Options) {
  const key = options.scope ? JSON.stringify(options.scope) : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const renderRevision = useRef(0);
  renderRevision.current += 1;
  const restoredAtRevision = useRef<number | null>(null);
  const restore = useStableCallback(options.restore);
  const capture = useStableCallback(options.capture);
  const initial = useRef(options);
  initial.current = options;
  const retainedSession = useRef<{ key: string; session: CreatorInputRecoverySession } | null>(null);
  const session = useMemo(() => {
    const { scope, snapshot } = initial.current;
    if (!key || !scope) return null;
    // Hiding the workspace releases its subscription, not its original version baseline.
    // Otherwise the restored working copy would become the base when the same workspace becomes active again.
    if (retainedSession.current?.key === key) return retainedSession.current.session;
    return CreatorInputRecoverySession.acquire(scope, snapshot, window.desktopApi);
  }, [key]);
  const state = useSyncExternalStore(session?.subscribe ?? subscribeEmpty, session?.getSnapshot ?? getEmpty);
  const snapshotKey = JSON.stringify(options.snapshot);
  useEffect(() => {
    if (!session || !key) return;
    let cancelled = false;
    let started = false;
    // Child editors apply hydrated documents in commit microtasks. Capture only after those have run.
    queueMicrotask(() => {
      if (cancelled || keyRef.current !== key) return;
      started = true;
      retainedSession.current = { key, session };
      void session.start(
        (recovered) => {
          if (keyRef.current === key) {
            restoredAtRevision.current = renderRevision.current;
            restore(recovered);
          }
        },
        () =>
          keyRef.current === key && restoredAtRevision.current !== renderRevision.current
            ? capture()
            : session.getCurrentInput(),
      );
    });
    return () => {
      cancelled = true;
      if (started) session.release();
    };
  }, [session, key, restore, capture]);
  const observedSession = useRef(session);
  const firstObservation = useRef(true);
  useEffect(() => {
    if (firstObservation.current || observedSession.current !== session) {
      // A retained session may restore inputs in its start effect; do not observe the previous render.
      firstObservation.current = false;
      observedSession.current = session;
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && keyRef.current === key) session?.captureCurrent();
    });
    return () => {
      cancelled = true;
    };
  }, [session, snapshotKey, key]);
  const flush = useStableCallback(async () => {
    if (!session) return true;
    return session.flushForAction();
  });
  return {
    state,
    flush,
    retry: () => session?.retry(),
    keepCurrent: () => session?.keepCurrent(),
    useSaved: () => session?.useSaved(),
  };
}
