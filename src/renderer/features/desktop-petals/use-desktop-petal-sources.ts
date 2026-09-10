import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { BootstrapDto } from '@/shared/contracts';
import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
import { pinLocation } from '@/renderer/features/desktop-petals/pin-navigation';

export function useDesktopPetalSources(
  spaceId: string | null,
  setData: Dispatch<SetStateAction<BootstrapDto | null>>,
  openTab: (location: AppLocation) => unknown,
) {
  useEffect(
    () =>
      window.desktopPetals.onNavigate((event) => {
        if (event.libraryId !== spaceId) return;
        openTab(
          event.kind === 'CODEX'
            ? { ...initialAppLocation, view: 'codexImages' }
            : event.kind === 'CODEX_SETTINGS'
              ? {
                  ...initialAppLocation,
                  view: 'packs',
                  extensions: { tab: 'plugins', pluginId: event.id, packId: null },
                }
              : event.kind === 'SOURCE' && event.id
                ? {
                    ...initialAppLocation,
                    view: 'creator',
                    creator: { surface: 'inspiration-stash', stashId: event.id },
                  }
                : event.kind === 'MATERIAL'
                  ? {
                      ...initialAppLocation,
                      view: 'gallery',
                      gallery: {
                        collection: { kind: 'all' },
                        requestedMaterialId: event.id,
                        selectedMaterialKey: null,
                      },
                    }
                  : {
                      ...initialAppLocation,
                      view: 'gallery',
                      gallery: {
                        collection: event.id ? { kind: 'album', albumId: event.id } : { kind: 'all' },
                        selectedMaterialKey: null,
                        requestedMaterialId: null,
                      },
                    },
        );
      }),
    [spaceId, openTab],
  );
  useEffect(
    () =>
      window.desktopPetals.onOpenPin?.((event) => {
        if (event.libraryId !== spaceId) return;
        const location = pinLocation(event.source);
        if (location) openTab(location);
      }),
    [spaceId, openTab],
  );
  useEffect(
    () =>
      window.desktopPetals.onSourceChanged((event) => {
        if (event.libraryId !== spaceId) return;
        setData((current) => {
          if (current?.spaceId !== event.libraryId) return current;
          const stashes = current.inspirationStashes ?? [];
          const items = current.creationItems ?? [];
          return {
            ...current,
            inspirationStashes: stashes.some((stash) => stash.id === event.stash.id)
              ? stashes.map((stash) => (stash.id === event.stash.id ? event.stash : stash))
              : [...stashes, event.stash],
            creationItems: event.item
              ? items.some((item) => item.id === event.item!.id)
                ? items.map((item) => (item.id === event.item!.id ? event.item! : item))
                : [...items, event.item]
              : items,
          };
        });
        if (event.open)
          openTab({
            ...initialAppLocation,
            view: 'creator',
            creator: { surface: 'inspiration-stash', stashId: event.stash.id },
          });
      }),
    [spaceId, setData, openTab],
  );
}
