import { createContext, useContext, type ReactNode } from 'react';
import type { AlbumDto } from '@/shared/contracts';

export interface AssetMenuActions {
  albums: readonly AlbumDto[];
  useInCreation(assetId: string): Promise<void>;
  createDocumentFromVideo(materialId: string, albumId: string | null): Promise<void>;
  refreshLibrary(): Promise<void>;
}

const AssetMenuActionsContext = createContext<AssetMenuActions | null>(null);

export function AssetMenuActionsProvider({ value, children }: { value: AssetMenuActions; children: ReactNode }) {
  return <AssetMenuActionsContext.Provider value={value}>{children}</AssetMenuActionsContext.Provider>;
}

export function useAssetMenuActions() {
  return useContext(AssetMenuActionsContext);
}
