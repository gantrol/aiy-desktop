import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';

function createDraftChanges(spaceId: string | null) {
  let revision = 0;
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<() => void>();
  return {
    spaceId,
    getSnapshot: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (spaceId && !unsubscribe) {
        unsubscribe = window.desktopApi.onCreationDraftsChanged((event) => {
          if (event.spaceId !== spaceId) return;
          revision += 1;
          listeners.forEach((notify) => notify());
        });
      }
      // Keep the revision current while Activity suspends every sidebar subscriber.
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
      revision += 1;
    },
  };
}

const DraftChangesContext = createContext<ReturnType<typeof createDraftChanges> | null>(null);

export function CreationDraftChangesProvider({ spaceId, children }: { spaceId: string | null; children: ReactNode }) {
  const changes = useMemo(() => createDraftChanges(spaceId), [spaceId]);
  useEffect(() => () => changes.dispose(), [changes]);
  return <DraftChangesContext value={changes}>{children}</DraftChangesContext>;
}

export function useCreationDraftChanges(spaceId: string) {
  const shared = useContext(DraftChangesContext);
  const changes = useMemo(
    () => (shared?.spaceId === spaceId ? shared : createDraftChanges(spaceId)),
    [shared, spaceId],
  );
  useEffect(() => {
    if (changes !== shared) return () => changes.dispose();
  }, [changes, shared]);
  return useSyncExternalStore(changes.subscribe, changes.getSnapshot, changes.getSnapshot);
}
