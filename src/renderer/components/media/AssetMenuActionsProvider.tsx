import { createContext, useContext, type ReactElement } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { AssetFileCapabilityLayer } from '@/renderer/components/media/AssetFileCapabilityLayer';

export interface AssetMenuActions {
  albums: readonly AlbumDto[];
  notify(message: string): void;
  useInCreation(assetId: string): Promise<void>;
  createDocumentFromVideo(materialId: string, albumId: string | null): Promise<void>;
  refreshLibrary(): Promise<void>;
}

const AssetMenuActionsContext = createContext<AssetMenuActions | null>(null);

export function AssetMenuActionsProvider({ value, children }: { value: AssetMenuActions; children: ReactElement }) {
  return (
    <AssetMenuActionsContext.Provider value={value}>
      <AssetFileCapabilityLayer notify={value.notify}>{children}</AssetFileCapabilityLayer>
    </AssetMenuActionsContext.Provider>
  );
}

export function useAssetMenuActions() {
  return useContext(AssetMenuActionsContext);
}
