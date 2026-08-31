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
  const captureSnapshotStable = useStableCallback(captureSnapshot);

  useEffect(() => {
    const sessionState = stateRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionState.sessionGeneration += 1;
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

  const saveSnapshot = useStableCallback(
    (snapshot: CreationDraftSaveSnapshot, requiredIdentity?: CreationDraftSessionIdentity) => {
      const sessionGeneration = stateRef.current.sessionGeneration;
      const previous = queueTailRef.current;
      const promise = previous.promise
        .catch((reason) => (isSupersededError(reason) ? reason.persistedDraft : null))
        .then(async (previousDraft) => {
          const stateBeforeSave = stateRef.current;
          if (
            !mountedRef.current ||
            stateBeforeSave.sessionGeneration !== sessionGeneration ||
            (requiredIdentity && !sameIdentity(stateBeforeSave, requiredIdentity))
          ) {
            throw new CreationDraftSessionSupersededError();
          }
          const savedDraft = await window.desktopApi.creationDraftSave({
            ...snapshot,
            id:
              stateBeforeSave.draftId ??
              (previous.sessionGeneration === sessionGeneration ? (previousDraft?.id ?? null) : null),
          });
          const stateAfterSave = stateRef.current;
          if (
            !mountedRef.current ||
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
      queueTailRef.current = { sessionGeneration, promise };
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
    const previous = queueTailRef.current;
    const promise = previous.promise
      .catch((reason) => (isSupersededError(reason) ? reason.persistedDraft : null))
      .then((previousDraft) =>
        window.desktopApi.creationDraftSave({
          ...snapshot,
          id:
            capturedDraftId ?? (previous.sessionGeneration === sessionGeneration ? (previousDraft?.id ?? null) : null),
        }),
      );
    queueTailRef.current = { sessionGeneration, promise };
    return promise;
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

  useEffect(() => {
    if (!enabled || (!hasContent && !draftId)) return undefined;
    const identity = captureIdentity();
    const timer = window.setTimeout(() => {
      void saveIfCurrent(identity).catch(onErrorStable);
    }, CREATION_DRAFT_AUTOSAVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveKey, captureIdentity, draftId, enabled, hasContent, onErrorStable, saveIfCurrent]);
}
