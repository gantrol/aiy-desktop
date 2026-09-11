import { useI18n } from '@/renderer/i18n/useI18n';
import { useEffect, useRef, useState } from 'react';
import type {
  CreationItemDto,
  InspirationStashContentInput,
  InspirationStashDto,
  InspirationStashSaveInput,
  Locale,
} from '@/shared/contracts';
import { creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export interface InspirationSaveIdentityInput {
  content: InspirationStashContentInput;
  creationDraftId: string | null;
  currentSeriesId: string | null;
  restartNewCreation: boolean;
  selectedStashId: string | null;
  targetAlbumId: string | null;
}

type SaveInspirationInput = InspirationSaveIdentityInput;

interface Options {
  captureSaveIdentity(): string;
  creationItems: readonly CreationItemDto[];
  locale: Locale;
  notify(message: string): void;
  onOpenStash(stash: InspirationStashDto): void;
  refresh(): Promise<void>;
  restartNewCreation(albumId: string | null): Promise<boolean>;
}

function contentSnapshot(content: InspirationStashContentInput): InspirationStashContentInput {
  return {
    ...content,
    promptNodes: content.promptNodes.map((node) => ({ ...node })),
    referenceAssetIds: [...content.referenceAssetIds],
    termIds: [...content.termIds],
    wordPaletteReferences: content.wordPaletteReferences.map((reference) => ({
      ...reference,
      parameterValues: { ...reference.parameterValues },
    })),
  };
}

export function inspirationSaveIdentity(input: InspirationSaveIdentityInput) {
  return JSON.stringify({
    ...input,
    content: contentSnapshot(input.content),
  });
}

export function useCreatorInspirationWorkflow(options: Options) {
  const copy = useI18n().messages.desktopPetals.document;
  const [busy, setBusy] = useState(false);
  const [savedContentKey, setSavedContentKey] = useState<string | null>(null);
  const busyRef = useRef(false);
  const savedHashRef = useRef<string | null>(null);
  const savedRevisionRef = useRef<string | undefined>(undefined);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const captureSaveIdentity = useStableCallback(options.captureSaveIdentity);
  const notify = useStableCallback(options.notify);
  const onOpenStash = useStableCallback(options.onOpenStash);
  const refresh = useStableCallback(options.refresh);
  const restartNewCreation = useStableCallback(options.restartNewCreation);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const clearSavedContent = useStableCallback(() => {
    generationRef.current += 1;
    savedHashRef.current = null;
    savedRevisionRef.current = undefined;
    setSavedContentKey(null);
  });

  const rememberSavedContent = useStableCallback(
    (content: InspirationStashContentInput, hash?: string, revisionId?: string) => {
      savedHashRef.current = hash ?? null;
      savedRevisionRef.current = revisionId;
      generationRef.current += 1;
      setSavedContentKey(JSON.stringify(contentSnapshot(content)));
    },
  );

  const saveInspiration = useStableCallback(async (input: SaveInspirationInput) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const operationGeneration = ++generationRef.current;
    const content = contentSnapshot(input.content);
    const saveIdentity = inspirationSaveIdentity(input);
    const currentItem = input.currentSeriesId
      ? creationItemByFormEntity(options.creationItems, 'PROMPT_SERIES', input.currentSeriesId)
      : null;
    try {
      if (input.selectedStashId && !savedHashRef.current) throw new Error(copy.reopenDraft);
      if (input.currentSeriesId && !currentItem) throw new Error(copy.itemUnavailable);
      const saveInput: InspirationStashSaveInput = input.selectedStashId
        ? {
            mode: 'UPDATE',
            id: input.selectedStashId,
            expectedContentHash: savedHashRef.current!,
            expectedRevisionId: savedRevisionRef.current,
            content,
            consumeCreationDraftId: input.restartNewCreation ? input.creationDraftId : null,
          }
        : currentItem
          ? { mode: 'ADD_FORM', creationItemId: currentItem.id, content, consumeCreationDraftId: null }
          : {
              mode: 'CREATE_STANDALONE',
              albumId: input.targetAlbumId,
              content,
              consumeCreationDraftId: input.restartNewCreation ? input.creationDraftId : null,
            };
      const stash = await window.desktopApi.inspirationStashSave(saveInput);
      if (generationRef.current === operationGeneration) {
        savedHashRef.current = stash.contentHash;
        savedRevisionRef.current = stash.revisionId;
      }
      const operationIsCurrent = () =>
        mountedRef.current && generationRef.current === operationGeneration && captureSaveIdentity() === saveIdentity;
      if (input.restartNewCreation && operationIsCurrent()) {
        const started = await restartNewCreation(input.targetAlbumId);
        await refresh();
        if (started) {
          if (mountedRef.current) notify(copy.draftSaved);
          return;
        }
      } else {
        await refresh();
      }
      if (!operationIsCurrent()) return;
      setSavedContentKey(JSON.stringify(content));
      onOpenStash(stash);
      notify(copy.draftSaved);
    } catch (reason) {
      if (mountedRef.current) notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  });

  return {
    busy,
    clearSavedContent,
    rememberSavedContent,
    saveInspiration,
    savedContentKey,
  };
}
