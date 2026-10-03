import { useRef, useState } from 'react';
import type { CreationDraftSaveInput } from '@/shared/contracts';
import { CREATION_DRAFT_CONFLICT, isCreationDraftConflict } from '@/shared/creation-draft-errors';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export function useCreationDraftConflict() {
  const [draftId, setDraftId] = useState<string | null>(null);
  const conflictRef = useRef<string | null>(null);
  const clear = useStableCallback(() => {
    conflictRef.current = null;
    setDraftId(null);
  });
  const save = useStableCallback(async (input: CreationDraftSaveInput, isCurrent: () => boolean) => {
    // Once a version conflict is known, typing must not repeatedly submit that old baseline.
    if (input.id && conflictRef.current === input.id) throw new Error(CREATION_DRAFT_CONFLICT);
    try {
      return await window.desktopApi.creationDraftSave(input);
    } catch (reason) {
      if (input.id && isCreationDraftConflict(reason) && isCurrent()) {
        conflictRef.current = input.id;
        setDraftId(input.id);
      }
      throw reason;
    }
  });
  return { draftId, clear, save };
}
