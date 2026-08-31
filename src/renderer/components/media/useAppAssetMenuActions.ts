import { useCallback, useMemo } from 'react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';
import type { AssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import type { AlbumDto, Locale } from '@/shared/contracts';

interface Options {
  albums: readonly AlbumDto[];
  breakdownAlbumId: string | null;
  locale: Locale;
  notify(message: string): void;
  useInCreation(assetId: string): Promise<void>;
  createDocumentFromVideo(materialId: string, albumId: string | null): Promise<void>;
  refreshLibrary(): Promise<void>;
  navigate(update: (current: AppLocation) => AppLocation): void;
}

export function useAppAssetMenuActions(options: Options): AssetMenuActions {
  const { albums, breakdownAlbumId, locale, notify, useInCreation, createDocumentFromVideo, refreshLibrary, navigate } =
    options;
  const createImageBreakdown = useCallback(
    async (assetId: string, sourceFormId: string | null) => {
      const result = await window.desktopApi.imageBreakdownCreate({
        sourceAssetId: assetId,
        albumId: breakdownAlbumId,
        sourceFormId,
        locale,
      });
      await refreshLibrary();
      navigate((current) => ({
        ...current,
        view: 'creator',
        creator: { surface: 'image-breakdown', breakdownId: result.breakdown.id },
        materialsReturnContext: null,
      }));
    },
    [breakdownAlbumId, locale, navigate, refreshLibrary],
  );

  return useMemo(
    () => ({
      albums,
      notify,
      useInCreation,
      createImageBreakdown,
      createDocumentFromVideo,
      refreshLibrary,
    }),
    [albums, createDocumentFromVideo, createImageBreakdown, notify, refreshLibrary, useInCreation],
  );
}
