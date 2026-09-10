import { contentImagesRecoverable } from '@/renderer/features/content-editor/contentImageRecovery';
import { ContentCheckpointTimer } from '@/renderer/features/content-editor/ContentCheckpointTimer';
import { useEffect, useRef, useState } from 'react';
import type { CreationDraftDto } from '@/shared/contracts';
import type {
  CreationDraftPromptSnapshot,
  CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export const CREATION_DRAFT_AUTOSAVE_IDLE_MS = 450;

interface CreationDraftSessionIdentity {
  sessionGeneration: number;
  autosaveEpoch: number;
  draftId: string | null;
}

interface CreationDraftSessionState extends CreationDraftSessionIdentity {
  savedDraft: CreationDraftDto | null;
}

interface CreationDraftQueueTail {
  sessionGeneration: number;
  promise: Promise<CreationDraftDto | null>;
}

interface UseCreationDraftSessionOptions {
  initialDraft: CreationDraftDto | null;
  captureSnapshot(
    targetAlbumOverride?: string | null,
    capturedPrompt?: CreationDraftPromptSnapshot,
  ): CreationDraftSaveSnapshot;
}

interface UseCreationDraftAutosaveOptions {
  autosaveKey: string;
  draftId: string | null;
  enabled: boolean;
  hasContent: boolean;
  captureIdentity(): CreationDraftSessionIdentity;
  saveIfCurrent(identity: CreationDraftSessionIdentity): Promise<CreationDraftDto | null>;
  onError(reason: unknown): void;
}

class CreationDraftSessionSupersededError extends Error {
  constructor(readonly persistedDraft: CreationDraftDto | null = null) {
    super('Creation draft session was superseded');
    this.name = 'CreationDraftSessionSupersededError';
  }
}

function sameIdentity(state: CreationDraftSessionState, identity: CreationDraftSessionIdentity) {
  return (
    state.sessionGeneration === identity.sessionGeneration &&
    state.autosaveEpoch === identity.autosaveEpoch &&
    state.draftId === identity.draftId
  );
}

function isSupersededError(reason: unknown): reason is CreationDraftSessionSupersededError {
  return reason instanceof CreationDraftSessionSupersededError;
}

function queuedSaveBaseline(
  state: CreationDraftSessionState,
  previous: CreationDraftQueueTail,
  previousDraft: CreationDraftDto | null,
  sessionGeneration: number,
) {
  const queuedDraft =
    previous.sessionGeneration === sessionGeneration &&
    previousDraft &&
    (!state.draftId || previousDraft.id === state.draftId)
      ? previousDraft
      : null;
  const rememberedDraft = state.draftId && state.savedDraft?.id === state.draftId ? state.savedDraft : null;
  // Proposal adoption persists outside this queue and then remembers its revision.
  // A completed queue entry must not replace that newer local baseline.
  if (queuedDraft && rememberedDraft && rememberedDraft.updatedAt > queuedDraft.updatedAt) return rememberedDraft;
  return queuedDraft ?? rememberedDraft;
}

function draftRevisionInput(draftId: string | null, baseline: CreationDraftDto | null) {
  return {
    id: draftId,
    expectedUpdatedAt: draftId ? (baseline?.updatedAt ?? null) : null,
  };
}

export function useCreationDraftSession({ initialDraft, captureSnapshot }: UseCreationDraftSessionOptions) {
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const stateRef = useRef<CreationDraftSessionState>({
    sessionGeneration: 0,
    autosaveEpoch: 0,
    draftId: initialDraft?.id ?? null,
    savedDraft: initialDraft,
  });
  const queueTailRef = useRef<CreationDraftQueueTail>({ sessionGeneration: 0, promise: Promise.resolve(null) });
  const pendingSaveRef = useRef<Promise<CreationDraftDto> | null>(null);
  const mountedRef = useRef(true);
  const lifecycleRevisionRef = useRef(0);
  const captureSnapshotStable = useStableCallback(captureSnapshot);

  useEffect(() => {
    const sessionState = stateRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancel UI work without severing the revision chain needed by the final save.
      lifecycleRevisionRef.current += 1;
      sessionState.autosaveEpoch += 1;
    };
  }, []);

  const captureIdentity = useStableCallback((): CreationDraftSessionIdentity => {
    const state = stateRef.current;
    return {
      sessionGeneration: state.sessionGeneration,
      autosaveEpoch: state.autosaveEpoch,
      draftId: state.draftId,
    };
  });

  const trackSave = useStableCallback(
    (sessionGeneration: number, previous: CreationDraftQueueTail, promise: Promise<CreationDraftDto>) => {
      queueTailRef.current = {
        sessionGeneration,
        // A cancelled or failed entry must not erase an earlier successful write.
        promise: promise.catch((reason) => {
          if (isSupersededError(reason) && reason.persistedDraft) return reason.persistedDraft;
          return previous.sessionGeneration === sessionGeneration ? previous.promise : null;
        }),
      };
      pendingSaveRef.current = promise;
      void promise.then(
        () => {
          if (pendingSaveRef.current === promise) pendingSaveRef.current = null;
        },
        () => {
          if (pendingSaveRef.current === promise) pendingSaveRef.current = null;
        },
      );
      return promise;
    },
  );

  const saveSnapshot = useStableCallback(
    (snapshot: CreationDraftSaveSnapshot, requiredIdentity?: CreationDraftSessionIdentity) => {
      const sessionGeneration = stateRef.current.sessionGeneration;
      const lifecycleRevision = lifecycleRevisionRef.current;
      const previous = queueTailRef.current;
      const promise = previous.promise.then(async (previousDraft) => {
        const stateBeforeSave = stateRef.current;
        if (
          !mountedRef.current ||
          lifecycleRevisionRef.current !== lifecycleRevision ||
          stateBeforeSave.sessionGeneration !== sessionGeneration ||
          (requiredIdentity && !sameIdentity(stateBeforeSave, requiredIdentity))
        ) {
          throw new CreationDraftSessionSupersededError();
        }
        if (snapshot.document && !(await contentImagesRecoverable(snapshot.document)))
          throw new Error('BLOCK_IMAGE_IMPORT_NOT_DURABLE');
        // Image staging can yield while navigation or adoption invalidates this save.
        if (
          !mountedRef.current ||
          lifecycleRevisionRef.current !== lifecycleRevision ||
          stateBeforeSave.sessionGeneration !== sessionGeneration ||
          (requiredIdentity && !sameIdentity(stateBeforeSave, requiredIdentity))
        ) {
          throw new CreationDraftSessionSupersededError();
        }
        const baseline = queuedSaveBaseline(stateBeforeSave, previous, previousDraft, sessionGeneration);
        const targetDraftId = stateBeforeSave.draftId ?? baseline?.id ?? null;
        const savedDraft = await window.desktopApi.creationDraftSave({
          ...snapshot,
          ...draftRevisionInput(targetDraftId, baseline),
        });
        const stateAfterSave = stateRef.current;
        if (
          !mountedRef.current ||
          lifecycleRevisionRef.current !== lifecycleRevision ||
          stateAfterSave.sessionGeneration !== sessionGeneration ||
          (requiredIdentity && !sameIdentity(stateAfterSave, requiredIdentity))
        ) {
          throw new CreationDraftSessionSupersededError(savedDraft);
        }
        stateAfterSave.savedDraft = savedDraft;
        stateAfterSave.draftId = savedDraft.id;
        setDraftId(savedDraft.id);
        return savedDraft;
      });
      return trackSave(sessionGeneration, previous, promise);
    },
  );

  const saveDraftNow = useStableCallback(
    async (targetAlbumOverride?: string | null, capturedPrompt?: CreationDraftPromptSnapshot) =>
      await saveSnapshot(captureSnapshotStable(targetAlbumOverride, capturedPrompt)),
  );

  const saveCapturedSnapshot = useStableCallback(
    async (snapshot: CreationDraftSaveSnapshot) => await saveSnapshot(snapshot),
  );

  const preserveCapturedSnapshot = useStableCallback((snapshot: CreationDraftSaveSnapshot) => {
    const sessionGeneration = stateRef.current.sessionGeneration;
    const capturedDraftId = stateRef.current.draftId;
    const capturedDraft =
      capturedDraftId && stateRef.current.savedDraft?.id === capturedDraftId ? stateRef.current.savedDraft : null;
    const previous = queueTailRef.current;
    const promise = previous.promise.then(async (previousDraft) => {
      if (snapshot.document && !(await contentImagesRecoverable(snapshot.document)))
        throw new Error('BLOCK_IMAGE_IMPORT_NOT_DURABLE');
      const stateBeforeSave = stateRef.current;
      const stillCurrent =
        stateBeforeSave.sessionGeneration === sessionGeneration && stateBeforeSave.draftId === capturedDraftId;
      const baseline = queuedSaveBaseline(
        {
          sessionGeneration,
          autosaveEpoch: stateRef.current.autosaveEpoch,
          draftId: capturedDraftId,
          savedDraft: stillCurrent ? stateBeforeSave.savedDraft : capturedDraft,
        },
        previous,
        previousDraft,
        sessionGeneration,
      );
      const targetDraftId = capturedDraftId ?? baseline?.id ?? null;
      const savedDraft = await window.desktopApi.creationDraftSave({
        ...snapshot,
        ...draftRevisionInput(targetDraftId, baseline),
      });
      const current = stateRef.current;
      if (
        mountedRef.current &&
        current.sessionGeneration === sessionGeneration &&
        current.draftId === capturedDraftId
      ) {
        current.savedDraft = savedDraft;
        current.draftId = savedDraft.id;
        setDraftId(savedDraft.id);
      }
      return savedDraft;
    });
    return trackSave(sessionGeneration, previous, promise);
  });

  const saveIfCurrent = useStableCallback(async (identity: CreationDraftSessionIdentity) => {
    if (!sameIdentity(stateRef.current, identity)) return null;
    try {
      return await saveSnapshot(captureSnapshotStable(), identity);
    } catch (reason) {
      if (isSupersededError(reason)) return null;
      throw reason;
    }
  });

  const replaceDraftSession = useStableCallback((draft: CreationDraftDto | null) => {
    const state = stateRef.current;
    state.sessionGeneration += 1;
    state.autosaveEpoch += 1;
    state.draftId = draft?.id ?? null;
    state.savedDraft = draft;
    setDraftId(draft?.id ?? null);
  });

  const detachDraftIdentity = useStableCallback(() => {
    const state = stateRef.current;
    state.sessionGeneration += 1;
    state.autosaveEpoch += 1;
    state.draftId = null;
    setDraftId(null);
  });

  const rememberSavedDraft = useStableCallback((draft: CreationDraftDto | null) => {
    const savedDraft = stateRef.current.savedDraft;
    if (draft && savedDraft?.id === draft.id && savedDraft.updatedAt > draft.updatedAt) return;
    stateRef.current.savedDraft = draft;
  });

  const patchSavedDraftTitle = useStableCallback((title: string) => {
    const savedDraft = stateRef.current.savedDraft;
    if (savedDraft) stateRef.current.savedDraft = { ...savedDraft, title };
  });

  const invalidateAutosaves = useStableCallback(() => {
    stateRef.current.autosaveEpoch += 1;
  });

  const awaitPendingSave = useStableCallback(async () => {
    const pending = pendingSaveRef.current;
    return pending ? await pending : null;
  });

  const getDraftId = useStableCallback(() => stateRef.current.draftId);
  const getSavedDraft = useStableCallback(() => stateRef.current.savedDraft);

  return {
    awaitPendingSave,
    captureAutosaveIdentity: captureIdentity,
    detachDraftIdentity,
    draftId,
    getDraftId,
    getSavedDraft,
    invalidateAutosaves,
    patchSavedDraftTitle,
    preserveCapturedSnapshot,
    rememberSavedDraft,
    replaceDraftSession,
    saveAutosaveIfCurrent: saveIfCurrent,
    saveCapturedSnapshot,
    saveDraftNow,
  };
}

export function useCreationDraftAutosave({
  autosaveKey,
  draftId,
  enabled,
  hasContent,
  captureIdentity,
  saveIfCurrent,
  onError,
}: UseCreationDraftAutosaveOptions) {
  const onErrorStable = useStableCallback(onError);
  const observedKeyRef = useRef(autosaveKey);
  const [checkpointTimer] = useState(() => new ContentCheckpointTimer());
  useEffect(() => () => checkpointTimer.cancel(), [checkpointTimer]);

  useEffect(() => {
    const changed = observedKeyRef.current !== autosaveKey;
    observedKeyRef.current = autosaveKey;
    if (!enabled || (!hasContent && !draftId)) {
      checkpointTimer.cancel();
      return;
    }
    if (!changed) return undefined;
    const identity = captureIdentity();
    checkpointTimer.schedule(() => {
      void saveIfCurrent(identity).catch(onErrorStable);
    }, CREATION_DRAFT_AUTOSAVE_IDLE_MS);
  }, [autosaveKey, captureIdentity, checkpointTimer, draftId, enabled, hasContent, onErrorStable, saveIfCurrent]);
}
