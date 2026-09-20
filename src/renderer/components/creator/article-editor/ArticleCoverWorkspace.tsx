import { createContext, useContext, type ReactNode } from 'react';
import type { AssetDto } from '@/shared/contracts';
import type { ArticleCoverRatio } from '@/shared/article-covers';

interface ArticleCoverWorkspace {
  projectAssets: readonly AssetDto[];
  generating: boolean;
  canGenerate: boolean;
  onGenerate(ratio: ArticleCoverRatio): Promise<void>;
}

const Context = createContext<ArticleCoverWorkspace>({
  projectAssets: [],
  generating: false,
  canGenerate: false,
  onGenerate: async () => undefined,
});

export function ArticleCoverWorkspaceProvider({ children, ...value }: ArticleCoverWorkspace & { children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useArticleCoverWorkspace = () => useContext(Context);
