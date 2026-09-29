import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ArticleDto, SocialPostDto, BootstrapDto, ImportedCreationOutputDto } from '@/shared/contracts';
import { mergeImportedOutput } from '@/renderer/features/intake/applyIntakeResult';
import type { CreationAuthorChangeHandler } from '@/renderer/features/me/SpaceProfileProvider';

type DataSetter = Dispatch<SetStateAction<BootstrapDto | null>>;
type RevisionSetter = Dispatch<SetStateAction<number>>;

function mergeArticle(current: BootstrapDto | null, article: ArticleDto): BootstrapDto | null {
  if (!current) return current;
  const articles = current.articles ?? [];
  const index = articles.findIndex((candidate) => candidate.id === article.id);
  if (index < 0) return { ...current, articles: [...articles, article] };
  if (articles[index] === article || articles[index]!.revisionNo > article.revisionNo) return current;
  const nextArticles = [...articles];
  nextArticles[index] = article;
  return { ...current, articles: nextArticles };
}

export function useAppDataUpdates(setData: DataSetter, setDataRevision: RevisionSetter) {
  const updateCreationAuthor = useCallback<CreationAuthorChangeHandler>(
    (spaceId, change) =>
      setData((current) => {
        if (!current || current.spaceId !== spaceId) return current;
        const update = (
          authors: import('@/shared/contracts/authorship').AuthorSummary[],
          target: { kind: string; id: string },
        ) => {
          if ('target' in change)
            return target.kind === change.target.kind && target.id === change.target.id ? change.authors : authors;
          return authors.some((author) => author.id === change.id)
            ? authors.map((author) => (author.id === change.id ? { ...author, name: change.name } : author))
            : authors;
        };
        const creationItems = current.creationItems.map((item) => {
          const forms = item.forms.map((form) => {
            const authors = update(form.authors, form.entity);
            return authors === form.authors ? form : { ...form, authors };
          });
          return forms.every((form, index) => form === item.forms[index]) ? item : { ...item, forms };
        });
        const articles = current.articles?.map((article) => {
          const authors = update(article.authors, { kind: 'ARTICLE', id: article.id });
          return authors === article.authors ? article : { ...article, authors };
        });
        return { ...current, creationItems, articles };
      }),
    [setData],
  );
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
  const updateSocialPost = useCallback(
    (post: SocialPostDto) =>
      setData((current) => {
        if (!current) return current;
        const posts = current.socialPosts ?? [];
        const previous = posts.find((item) => item.id === post.id);
        if (previous && previous.revisionNo > post.revisionNo) return current;
        return {
          ...current,
          socialPosts: previous ? posts.map((item) => (item.id === post.id ? post : item)) : [...posts, post],
        };
      }),
    [setData],
  );
  return { updateArticle, updateSocialPost, updateImportedOutput, updateCreationAuthor };
}
