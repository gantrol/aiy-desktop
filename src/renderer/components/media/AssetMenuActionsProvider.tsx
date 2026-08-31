import { createContext, useContext, useEffect, type ReactElement } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { finishNativeMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import { AssetFileCapabilityLayer } from '@/renderer/components/media/AssetFileCapabilityLayer';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface AssetMenuActions {
  albums: readonly AlbumDto[];
  notify(message: string): void;
  useInCreation(assetId: string): Promise<void>;
  createImageBreakdown(assetId: string, sourceFormId: string | null): Promise<void>;
  createDocumentFromVideo(materialId: string, albumId: string | null): Promise<void>;
  refreshLibrary(): Promise<void>;
}

const AssetMenuActionsContext = createContext<AssetMenuActions | null>(null);
const AssetBreakdownSourceFormContext = createContext<string | null>(null);

export function AssetBreakdownSourceFormProvider({
  sourceFormId,
  children,
}: {
  sourceFormId: string | null;
  children: ReactElement;
}) {
  return (
    <AssetBreakdownSourceFormContext.Provider value={sourceFormId}>{children}</AssetBreakdownSourceFormContext.Provider>
  );
}

export function AssetMenuActionsProvider({ value, children }: { value: AssetMenuActions; children: ReactElement }) {
  const failedLabel = useI18n().messages.assetFile.failed;
  useEffect(() => {
    return window.desktopApi.onAssetFilesDragFinished((result) => {
      finishNativeMaterialsDrag(result.requestId);
      if (result.status === 'FAILED') value.notify(`${failedLabel}: ${result.message}`);
    });
  }, [failedLabel, value]);
  return (
    <AssetMenuActionsContext.Provider value={value}>
      <AssetFileCapabilityLayer notify={value.notify}>{children}</AssetFileCapabilityLayer>
    </AssetMenuActionsContext.Provider>
  );
}

export function useAssetMenuActions() {
  return useContext(AssetMenuActionsContext);
}

export function useAssetBreakdownSourceFormId() {
  return useContext(AssetBreakdownSourceFormContext);
}
