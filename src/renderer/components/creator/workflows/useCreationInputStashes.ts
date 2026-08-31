import { useEffect, useRef, useState } from 'react';
import type { CreationInputSnapshotDto, CreationInputStashDto, CreatorAgentScope, Locale } from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface UseCreationInputStashesOptions {
  locale: Locale;
  notify(message: string): void;
  ensureScope(): Promise<CreatorAgentScope>;
  isScopeCurrent(scope: CreatorAgentScope): boolean;
  captureSnapshot(): CreationInputSnapshotDto;
  applyStash(stash: CreationInputStashDto): void;
}

export function useCreationInputStashes({
  locale,
  notify,
  ensureScope,
  isScopeCurrent,
  captureSnapshot,
  applyStash,
}: UseCreationInputStashesOptions) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stashes, setStashes] = useState<CreationInputStashDto[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const ensureScopeStable = useStableCallback(ensureScope);
  const isScopeCurrentStable = useStableCallback(isScopeCurrent);
  const captureSnapshotStable = useStableCallback(captureSnapshot);
  const applyStashStable = useStableCallback(applyStash);
  const notifyStable = useStableCallback(notify);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      busyRef.current = false;
      operationGenerationRef.current += 1;
    };
  }, []);

  const beginOperation = useStableCallback(() => {
    if (busyRef.current) return null;
    busyRef.current = true;
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    setBusy(true);
    return generation;
  });

  const operationIsCurrent = useStableCallback((generation: number) => {
    return mountedRef.current && operationGenerationRef.current === generation;
  });

  const finishOperation = useStableCallback((generation: number) => {
    if (!operationIsCurrent(generation)) return;
    busyRef.current = false;
    setBusy(false);
  });

  const openDialog = useStableCallback(async () => {
    const generation = beginOperation();
    if (generation === null) return;
    try {
      const scope = await ensureScopeStable();
      if (!operationIsCurrent(generation) || !isScopeCurrentStable(scope)) return;
      const loadedStashes = await window.desktopApi.creationInputStashesList(scope);
      if (!operationIsCurrent(generation) || !isScopeCurrentStable(scope)) return;
      setStashes(loadedStashes);
      setDialogOpen(true);
    } catch (reason) {
      if (operationIsCurrent(generation)) {
        notifyStable(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      finishOperation(generation);
    }
  });

  const createStash = useStableCallback(async () => {
    const generation = beginOperation();
    if (generation === null) return;
    try {
      const { referenceAssets: _referenceAssets, ...snapshot } = captureSnapshotStable();
      const scope = await ensureScopeStable();
      if (!operationIsCurrent(generation) || !isScopeCurrentStable(scope)) return;
      const stash = await window.desktopApi.creationInputStashCreate({ scope, snapshot });
      if (!operationIsCurrent(generation) || !isScopeCurrentStable(scope)) return;
      setStashes((current) => [stash, ...current.filter((item) => item.id !== stash.id)]);
      notifyStable(
        locale === 'zh'
          ? `已暂存输入 S${String(stash.revisionNo).padStart(2, '0')}`
          : `Input stashed as S${String(stash.revisionNo).padStart(2, '0')}`,
      );
    } catch (reason) {
      if (operationIsCurrent(generation)) {
        notifyStable(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      finishOperation(generation);
    }
  });

  const restoreStash = useStableCallback((stash: CreationInputStashDto) => {
    if (!isScopeCurrentStable(stash.scope)) return;
    applyStashStable(stash);
    setDialogOpen(false);
    notifyStable(
      locale === 'zh'
        ? `已恢复暂存 S${String(stash.revisionNo).padStart(2, '0')}`
        : `Restored S${String(stash.revisionNo).padStart(2, '0')}`,
    );
  });

  const changeDialogOpen = useStableCallback((open: boolean) => {
    setDialogOpen(open);
  });

  const reset = useStableCallback(() => {
    operationGenerationRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setDialogOpen(false);
    setStashes([]);
  });

  return {
    busy,
    changeDialogOpen,
    createStash,
    dialogOpen,
    openDialog,
    reset,
    restoreStash,
    stashes,
  };
}
