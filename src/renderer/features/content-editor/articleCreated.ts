import type { ArticleDto, BootstrapDto, CreationItemDto } from '@/shared/contracts';

export const ARTICLE_CREATED_EVENT = 'aiy:article-created';
export interface ArticleCreated {
  spaceId: string;
  article: ArticleDto;
  creationItem: CreationItemDto;
}

export function announceArticleCreated(result: ArticleCreated) {
  window.dispatchEvent(new CustomEvent(ARTICLE_CREATED_EVENT, { detail: result }));
}

/** Registration is independent of navigation and must survive a newer article projection. */
export function mergeCreatedArticle(data: BootstrapDto | null, result: ArticleCreated): BootstrapDto | null {
  if (!data || data.spaceId !== result.spaceId) return data;
  const { article, creationItem } = result;
  const previousArticle = data.articles?.find((item) => item.id === article.id);
  const previousItem = data.creationItems.find((item) => item.id === creationItem.id);
  return {
    ...data,
    articles:
      previousArticle && previousArticle.revisionNo > article.revisionNo
        ? data.articles
        : [...(data.articles ?? []).filter((item) => item.id !== article.id), article],
    creationItems:
      previousItem && previousItem.updatedAt >= creationItem.updatedAt
        ? data.creationItems
        : [...data.creationItems.filter((item) => item.id !== creationItem.id), creationItem],
  };
}
