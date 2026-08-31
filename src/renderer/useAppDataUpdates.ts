import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ArticleDto, BootstrapDto, ImportedCreationOutputDto } from '@/shared/contracts';
import { mergeImportedOutput } from '@/renderer/features/intake/applyIntakeResult';

type DataSetter = Dispatch<SetStateAction<BootstrapDto | null>>;
type RevisionSetter = Dispatch<SetStateAction<number>>;

function mergeArticle(current: BootstrapDto | null, article: ArticleDto): BootstrapDto | null {
  if (!current) return current;
  const articles = current.articles ?? [];
  const index = articles.findIndex((candidate) => candidate.id === article.id);
  if (index < 0) return { ...current, articles: [...articles, article] };
  if (articles[index] === article) return current;
  const nextArticles = [...articles];
  nextArticles[index] = article;
  return { ...current, articles: nextArticles };
}

export function useAppDataUpdates(setData: DataSetter, setDataRevision: RevisionSetter) {
  const updateImportedOutput = useCallback(
    (output: ImportedCreationOutputDto) => {
      setData((current) => mergeImportedOutput(current, output));
      setDataRevision((current) => current + 1);
    },
    [setData, setDataRevision],
  );
  const updateArticle = useCallback(
    (article: ArticleDto) => setData((current) => mergeArticle(current, article)),
    [setData],
  );
  return { updateArticle, updateImportedOutput };
}
