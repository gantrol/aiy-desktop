import { useEffect, useState } from 'react';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalWorkspaceItem } from '@/shared/contracts/petal-workspace';
import { petalErrorCode } from '@/shared/petal-errors';

export function usePetalWorkspace(snapshot: DesktopPetalSnapshot, onError: (error: unknown) => void, retry: number) {
  const [items, setItems] = useState<PetalWorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const libraryId = snapshot.libraryId;
  useEffect(() => {
    let live = true;
    let pending = false;
    let fetching = false;
    const refresh = async () => {
      pending = true;
      if (fetching || snapshot.suspended) return;
      fetching = true;
      try {
        while (live && pending) {
          pending = false;
          const result = await window.desktopPetals.workspace();
          if (!live || result.libraryId !== libraryId) continue;
          setItems(result.items);
          setLoading(false);
        }
      } catch (error) {
        if (live && !['saving', 'libraryUnavailable'].includes(petalErrorCode(error) ?? '')) {
          onError(error);
          setLoading(false);
        }
      } finally {
        fetching = false;
      }
    };
    const unsubscribe = window.desktopPetals.onChanged(() => {
      void refresh();
    });
    void refresh();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [libraryId, snapshot.suspended, onError, retry]);
  return { items, loading };
}
