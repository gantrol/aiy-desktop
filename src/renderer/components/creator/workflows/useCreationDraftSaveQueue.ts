import { useRef } from 'react';
import type { CreationDraftDto } from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { isCreationDraftSessionSupersededError } from '@/renderer/components/creator/workflows/creationDraftSessionErrors';

export interface CreationDraftQueueTail {
  sessionGeneration: number;
  promise: Promise<CreationDraftDto | null>;
}

/** Each editor owns its queue; failed requests retain the last confirmed revision. */
export function useCreationDraftSaveQueue() {
  const queueTailRef = useRef<CreationDraftQueueTail>({ sessionGeneration: 0, promise: Promise.resolve(null) });
  const pendingSaveRef = useRef<Promise<CreationDraftDto> | null>(null);
  const trackSave = useStableCallback(
    (sessionGeneration: number, previous: CreationDraftQueueTail, promise: Promise<CreationDraftDto>) => {
      queueTailRef.current = {
        sessionGeneration,
        promise: promise.catch((reason) => {
          if (isCreationDraftSessionSupersededError(reason) && reason.persistedDraft) return reason.persistedDraft;
          return previous.sessionGeneration === sessionGeneration ? previous.promise : null;
        }),
      };
      pendingSaveRef.current = promise;
      const clearPending = () => {
        if (pendingSaveRef.current === promise) pendingSaveRef.current = null;
      };
      void promise.then(clearPending, clearPending);
      return promise;
    },
  );
  const awaitPendingSave = useStableCallback(async () => {
    const pending = pendingSaveRef.current;
    return pending ? await pending : null;
  });
  return { queueTailRef, pendingSaveRef, trackSave, awaitPendingSave };
}
