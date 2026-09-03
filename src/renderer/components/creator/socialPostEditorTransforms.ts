import type { SocialPostContentInput, SocialPostDto } from '@/shared/contracts';

export function editableContent(post: SocialPostDto): SocialPostContentInput {
  const { mediaAssets: _mediaAssets, ...content } = post.content;
  return {
    ...content,
    mediaAssetIds: [...content.mediaAssetIds],
  };
}

export function move<T>(items: readonly T[], index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function moveTo<T>(items: readonly T[], sourceIndex: number, targetIndex: number) {
  if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) return [...items];
  const next = [...items];
  const [item] = next.splice(sourceIndex, 1);
  if (item === undefined) return [...items];
  next.splice(targetIndex, 0, item);
  return next;
}
