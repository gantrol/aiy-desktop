import type { ArticleDto, ArticleListItem } from '@/shared/contracts';

export function isArticleLoaded(article: ArticleListItem): article is ArticleDto {
  return !('detailsLoaded' in article && article.detailsLoaded === false);
}

export function hasArticleCreationInput(article: ArticleListItem): boolean {
  return 'hasCreationInput' in article ? article.hasCreationInput : Boolean(article.content.creationInput);
}

/** Legacy inspiration routes still identify articles; their navigation never needs the body. */
export function inspirationArticleIds(data: {
  articles?: readonly ArticleListItem[];
  inspirationStashes?: readonly { id: string }[];
}): string[] {
  return [
    ...new Set([
      ...(data.inspirationStashes ?? []).map((item) => item.id),
      ...(data.articles ?? []).filter(hasArticleCreationInput).map((item) => item.id),
    ]),
  ];
}
