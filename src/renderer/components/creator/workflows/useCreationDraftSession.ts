import { contentImagesRecoverable } from '@/renderer/features/content-editor/contentImageRecovery';
import { ContentCheckpointTimer } from '@/renderer/features/content-editor/ContentCheckpointTimer';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CreationDraftDto } from '@/shared/contracts';
import type {
  CreationDraftPromptSnapshot,
  CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import {
  creationDraftSnapshotKey,
  savedCreationDraftSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import {
  CreationDraftSessionSupersededError,
  isCreationDraftSessionSupersededError,
} from '@/renderer/components/creator/workflows/creationDraftSessionErrors';
import {
  useCreationDraftSaveQueue,
  type CreationDraftQueueTail,
} from '@/renderer/components/creator/workflows/useCreationDraftSaveQueue';
import { useCreationDraftConflict } from '@/renderer/components/creator/workflows/useCreationDraftConflict';

export const CREATION_DRAFT_AUTOSAVE_IDLE_MS = 450;

interface CreationDraftSessionIdentity {
  sessionGeneration: number;
  autosaveEpoch: number;
  draftId: string | null;
}

interface CreationDraftSessionState extends CreationDraftSessionIdentity {
  savedDraft: CreationDraftDto | null;
}

interface UseCreationDraftSessionOptions {
  initialDraft: CreationDraftDto | null;
  whenInputSettled(): Promise<void>;
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

function sameIdentity(state: CreationDraftSessionState, identity: CreationDraftSessionIdentity) {
  return (
    state.sessionGeneration === identity.sessionGeneration &&
    state.autosaveEpoch === identity.autosaveEpoch &&
    // The first acknowledgement assigns an ID without replacing this input session.
    (state.draftId === identity.draftId || identity.draftId === null)
  );
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

function captureDraftSessionIdentity(state: CreationDraftSessionState): CreationDraftSessionIdentity {
  return {
    sessionGeneration: state.sessionGeneration,
    autosaveEpoch: state.autosaveEpoch,
    draftId: state.draftId,
  };
}

async function awaitDraftInput(whenInputSettled: () => Promise<void>, inputWaiters: Set<() => void>) {
  // A reset or departing session must cancel this wait even if the old editor
  // never emits compositionend. The caller keeps it in the same save lane.
  let cancel = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new CreationDraftSessionSupersededError());
    inputWaiters.add(cancel);
  });
  try {
    await Promise.race([whenInputSettled(), cancelled]);
  } finally {
    inputWaiters.delete(cancel);
  }
}

export function useCreationDraftSession({
  initialDraft,
  whenInputSettled,
  captureSnapshot,
}: UseCreationDraftSessionOptions) {
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const stateRef = useRef<CreationDraftSessionState>({
    sessionGeneration: 0,
    autosaveEpoch: 0,
    draftId: initialDraft?.id ?? null,
    savedDraft: initialDraft,
  });
  const { queueTailRef, pendingSaveRef, trackSave, awaitPendingSave } = useCreationDraftSaveQueue();
  const conflict = useCreationDraftConflict();
  const savedSnapshotKeyRef = useRef<string | null>(
    initialDraft ? creationDraftSnapshotKey(savedCreationDraftSnapshot(initialDraft)) : null,
  );
  const mountedRef = useRef(true);
  const lifecycleRevisionRef = useRef(0);
  const inputWaitersRef = useRef(new Set<() => void>());
  const whenInputSettledStable = useStableCallback(whenInputSettled);
  const captureSnapshotStable = useStableCallback(captureSnapshot);
  const cancelInputWaits = useStableCallback(() => {
    inputWaitersRef.current.forEach((cancel) => cancel());
    inputWaitersRef.current.clear();
  });

  useLayoutEffect(() => {
    const sessionState = stateRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancel UI work without severing the revision chain needed by the final save.
      lifecycleRevisionRef.current += 1;
      sessionState.autosaveEpoch += 1;
      cancelInputWaits();
    };
  }, [cancelInputWaits]);

  const captureIdentity = useStableCallback(() => captureDraftSessionIdentity(stateRef.current));

  const saveSnapshot = useStableCallback(
    (
      input: CreationDraftSaveSnapshot | (() => CreationDraftSaveSnapshot),
      requiredIdentity?: CreationDraftSessionIdentity,
      asCopy = false,
    ) => {
      const source = typeof input === 'function' ? input : structuredClone(input);
      const sessionGeneration = stateRef.current.sessionGeneration;
      const autosaveEpoch = stateRef.current.autosaveEpoch;
      const lifecycleRevision = lifecycleRevisionRef.current;
      const previous = queueTailRef.current;
      const assertCurrent = () => {
        const state = stateRef.current;
        if (
          !mountedRef.current ||
          lifecycleRevisionRef.current !== lifecycleRevision ||
          state.sessionGeneration !== sessionGeneration ||
          (typeof source === 'function' && state.autosaveEpoch !== autosaveEpoch) ||
          (requiredIdentity && !sameIdentity(state, requiredIdentity))
        ) {
          throw new CreationDraftSessionSupersededError();
        }
      };
      const promise = previous.promise.then(async (previousDraft) => {
        assertCurrent();
        if (typeof source === 'function') {
          await awaitDraftInput(whenInputSettledStable, inputWaitersRef.current);
          assertCurrent();
        }
        const snapshot = typeof source === 'function' ? structuredClone(source()) : source;
        const snapshotKey = creationDraftSnapshotKey(snapshot);
        if (snapshot.document && !(await contentImagesRecoverable(snapshot.document)))
          throw new Error('BLOCK_IMAGE_IMPORT_NOT_DURABLE');
        // Image staging can yield while navigation or adoption invalidates this save.
        assertCurrent();
        const stateBeforeSave = stateRef.current;
        const baseline = queuedSaveBaseline(stateBeforeSave, previous, previousDraft, sessionGeneration);
        const targetDraftId = asCopy ? null : (stateBeforeSave.draftId ?? baseline?.id ?? null);
        const savedDraft =
          baseline && targetDraftId === baseline.id && snapshotKey === savedSnapshotKeyRef.current
            ? baseline
            : await conflict.save(
                { ...snapshot, ...draftRevisionInput(targetDraftId, baseline) },
                () =>
                  mountedRef.current &&
                  lifecycleRevisionRef.current === lifecycleRevision &&
                  stateRef.current.sessionGeneration === sessionGeneration,
              );
        const stateAfterSave = stateRef.current;
        if (
          !mountedRef.current ||
          lifecycleRevisionRef.current !== lifecycleRevision ||
          stateAfterSave.sessionGeneration !== sessionGeneration ||
          (requiredIdentity && !sameIdentity(stateAfterSave, requiredIdentity))
        ) {
          throw new CreationDraftSessionSupersededError(savedDraft);
        }
        if (asCopy) {
          stateAfterSave.sessionGeneration += 1;
          stateAfterSave.autosaveEpoch += 1;
          cancelInputWaits();
          conflict.clear();
        }
        stateAfterSave.savedDraft = savedDraft;
        stateAfterSave.draftId = savedDraft.id;
        savedSnapshotKeyRef.current = snapshotKey;
        setDraftId(savedDraft.id);
        return savedDraft;
      });
      return trackSave(sessionGeneration, previous, promise);
    },
  );

  const saveDraftNow = useStableCallback(
    async (targetAlbumOverride?: string | null, capturedPrompt?: CreationDraftPromptSnapshot) =>
      await saveSnapshot(
        capturedPrompt
          ? captureSnapshotStable(targetAlbumOverride, capturedPrompt)
          : () => captureSnapshotStable(targetAlbumOverride),
      ),
  );

  const saveCapturedSnapshot = useStableCallback(
    async (snapshot: CreationDraftSaveSnapshot) => await saveSnapshot(snapshot),
  );

  const saveDraftCopy = useStableCallback(() => saveSnapshot(() => captureSnapshotStable(), captureIdentity(), true));

  const preserveCapturedSnapshot = useStableCallback((source: CreationDraftSaveSnapshot) => {
    const snapshot = structuredClone(source);
    const snapshotKey = creationDraftSnapshotKey(snapshot);
    const sessionGeneration = stateRef.current.sessionGeneration;
    const capturedDraftId = stateRef.current.draftId;
    const capturedSnapshotKey = savedSnapshotKeyRef.current;
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
      const savedDraft =
        baseline &&
        targetDraftId === baseline.id &&
        snapshotKey === (stillCurrent ? savedSnapshotKeyRef.current : capturedSnapshotKey)
          ? baseline
          : await conflict.save(
              { ...snapshot, ...draftRevisionInput(targetDraftId, baseline) },
              () => mountedRef.current && stateRef.current.sessionGeneration === sessionGeneration,
            );
      const current = stateRef.current;
      if (
        mountedRef.current &&
        current.sessionGeneration === sessionGeneration &&
        current.draftId === capturedDraftId
      ) {
        current.savedDraft = savedDraft;
        current.draftId = savedDraft.id;
        savedSnapshotKeyRef.current = snapshotKey;
        setDraftId(savedDraft.id);
      }
      return savedDraft;
    });
    return trackSave(sessionGeneration, previous, promise);
  });

  const saveIfCurrent = useStableCallback(async (identity: CreationDraftSessionIdentity) => {
    if (!sameIdentity(stateRef.current, identity)) return null;
    try {
      return await saveSnapshot(() => captureSnapshotStable(), identity);
    } catch (reason) {
      if (isCreationDraftSessionSupersededError(reason)) return null;
      throw reason;
    }
  });

  const replaceDraftSession = useStableCallback((draft: CreationDraftDto | null) => {
    const state = stateRef.current;
    state.sessionGeneration += 1;
    state.autosaveEpoch += 1;
    state.draftId = draft?.id ?? null;
    state.savedDraft = draft;
    savedSnapshotKeyRef.current = draft ? creationDraftSnapshotKey(savedCreationDraftSnapshot(draft)) : null;
    conflict.clear();
    cancelInputWaits();
    setDraftId(draft?.id ?? null);
  });

  const detachDraftIdentity = useStableCallback(() => {
    const state = stateRef.current;
    state.sessionGeneration += 1;
    state.autosaveEpoch += 1;
    state.draftId = null;
    state.savedDraft = null;
    savedSnapshotKeyRef.current = null;
    conflict.clear();
    cancelInputWaits();
    setDraftId(null);
  });

  const rememberSavedDraft = useStableCallback((draft: CreationDraftDto | null) => {
    const savedDraft = stateRef.current.savedDraft;
    if (draft && savedDraft?.id === draft.id && savedDraft.updatedAt > draft.updatedAt) return;
    stateRef.current.savedDraft = draft;
    savedSnapshotKeyRef.current = draft ? creationDraftSnapshotKey(savedCreationDraftSnapshot(draft)) : null;
    if (!draft || draft.updatedAt !== savedDraft?.updatedAt) conflict.clear();
  });

  const patchSavedDraftTitle = useStableCallback((title: string) => {
    const savedDraft = stateRef.current.savedDraft;
    if (savedDraft) {
      stateRef.current.savedDraft = { ...savedDraft, title };
      savedSnapshotKeyRef.current = null;
    }
  });

  const invalidateAutosaves = useStableCallback(() => {
    stateRef.current.autosaveEpoch += 1;
    cancelInputWaits();
  });

  const getDraftId = useStableCallback(() => stateRef.current.draftId);
  const getSavedDraft = useStableCallback(() => stateRef.current.savedDraft);
  const isCurrentInputSaved = useStableCallback(() => {
    if (pendingSaveRef.current || !savedSnapshotKeyRef.current) return false;
    try {
      return savedSnapshotKeyRef.current === creationDraftSnapshotKey(captureSnapshotStable());
    } catch {
      // A new composition is dirty until its final document can be captured.
      return false;
    }
  });

  return {
    awaitPendingSave,
    captureAutosaveIdentity: captureIdentity,
    conflictDraftId: conflict.draftId,
    detachDraftIdentity,
    draftId,
    getDraftId,
    getSavedDraft,
    invalidateAutosaves,
    isCurrentInputSaved,
    patchSavedDraftTitle,
    preserveCapturedSnapshot,
    rememberSavedDraft,
    replaceDraftSession,
    saveAutosaveIfCurrent: saveIfCurrent,
    saveCapturedSnapshot,
    saveDraftCopy,
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
