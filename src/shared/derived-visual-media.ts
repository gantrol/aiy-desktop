import type { ArticleDto, ArticleMediaBindingInput, DerivedVisualDto, SocialPostDto } from '@/shared/contracts';
import { articleIllustrationInsertionOffset, articleMarkdownImageOccurrences } from '@/shared/article-wechat-renderer';

export type ArticleVisualPositionState =
  | { status: 'PLACED'; binding: ArticleMediaBindingInput }
  | { status: 'UNPLACED' | 'MISSING' | 'AMBIGUOUS'; binding: null };

export function derivedVisualImageExtension(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'jpg';
}

export function isDerivedVisualMediaPath(path: string, visualId: string) {
  return path.startsWith(`assets/visual-${visualId}.`) || path.startsWith(`assets/visual-${visualId}-`);
}

export function isArticleVisualPositionPath(path: string, positionId: string) {
  return path.startsWith(`assets/position-${positionId}-`) || isDerivedVisualMediaPath(path, positionId);
}

export function articleVisualPositionState(visual: DerivedVisualDto, article: ArticleDto): ArticleVisualPositionState {
  const positionId = visual.positionId;
  if (visual.role !== 'ARTICLE_INLINE' || !positionId || visual.articleId !== article.id)
    return { status: 'MISSING', binding: null };
  const occurrences = articleMarkdownImageOccurrences(article.content.markdown).filter((path) =>
    isArticleVisualPositionPath(path, positionId),
  );
  if (occurrences.length > 1) return { status: 'AMBIGUOUS', binding: null };
  if (occurrences.length === 1) {
    const binding = article.content.mediaBindings.find((item) => item.path === occurrences[0]);
    return binding ? { status: 'PLACED', binding } : { status: 'MISSING', binding: null };
  }
  if (
    !visual.positionWasUsed &&
    articleIllustrationInsertionOffset(article.content.markdown, visual.anchor?.selectedText ?? '') !== null
  )
    return { status: 'UNPLACED', binding: null };
  return { status: 'MISSING', binding: null };
}

export function derivedVisualAppliedAssetId(
  visual: DerivedVisualDto | null,
  article: ArticleDto | undefined,
  post: SocialPostDto | undefined,
): string | null {
  if (!visual) return null;
  if (visual.role === 'SOCIAL_POST_COVER') {
    return post?.id === visual.socialPostId ? post.content.coverAssetId : null;
  }
  if (!article || article.id !== visual.articleId) return null;
  if (visual.role === 'ARTICLE_HEADER') return article.content.coverAssetId;
  return articleVisualPositionState(visual, article).binding?.assetId ?? null;
}
