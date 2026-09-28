import { createContext, useContext, type ReactNode } from 'react';
import type { AssetDto } from '@/shared/contracts';
import type { ArticleCoverRatio } from '@/shared/article-covers';
import type {
  ArticleCoverGeneration,
  ArticleCoverGenerations,
} from '@/renderer/components/creator/article-editor/articleCoverGeneration';

interface ArticleCoverWorkspace {
  projectAssets: readonly AssetDto[];
  openingRatio: ArticleCoverRatio | 'shared' | null;
  generations: ArticleCoverGenerations;
  canGenerate: boolean;
  onGenerate(ratio: ArticleCoverRatio): Promise<void>;
  onOpenGeneration(generation: ArticleCoverGeneration): void;
}

const Context = createContext<ArticleCoverWorkspace>({
  projectAssets: [],
  openingRatio: null,
  generations: {},
  canGenerate: false,
  onGenerate: async () => undefined,
  onOpenGeneration: () => undefined,
});

export function ArticleCoverWorkspaceProvider({ children, ...value }: ArticleCoverWorkspace & { children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useArticleCoverWorkspace = () => useContext(Context);
