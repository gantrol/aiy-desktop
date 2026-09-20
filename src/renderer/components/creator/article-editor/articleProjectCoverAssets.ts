import type { ArticleDto, AssetDto, BootstrapDto } from '@/shared/contracts';
import { creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { allAssets } from '@/renderer/components/creator/utils';

/** Reuse the current workspace projection; opening covers does not scan the library. */
export function articleProjectCoverAssets(data: BootstrapDto, article: ArticleDto): AssetDto[] {
  const source = creationItemByFormEntity(data.creationItems, 'ARTICLE', article.id);
  const items = data.creationItems.filter(
    (item) => item.id === source?.id || Boolean(article.albumId && item.albumId === article.albumId),
  );
  const forms = items.flatMap((item) => item.forms);
  const seriesIds = new Set(forms.flatMap((form) => (form.entity.kind === 'PROMPT_SERIES' ? [form.entity.id] : [])));
  const visualIds = new Set(forms.flatMap((form) => (form.entity.kind === 'DERIVED_VISUAL' ? [form.entity.id] : [])));
  for (const visual of data.derivedVisuals ?? []) {
    if (visual.promptSeriesId && (visualIds.has(visual.id) || visual.articleId === article.id))
      seriesIds.add(visual.promptSeriesId);
  }
  const articleIds = new Set(forms.flatMap((form) => (form.entity.kind === 'ARTICLE' ? [form.entity.id] : [])));
  const postIds = new Set(forms.flatMap((form) => (form.entity.kind === 'SOCIAL_POST' ? [form.entity.id] : [])));
  const assets: AssetDto[] = data.series
    .filter((series) => seriesIds.has(series.id))
    .flatMap((series) => [...allAssets(series), ...series.versions.flatMap((version) => version.referenceAssets)]);
  for (const item of data.articles ?? []) {
    if (!articleIds.has(item.id) || item.id === article.id) continue;
    assets.push(...item.content.mediaAssets);
  }
  for (const post of data.socialPosts ?? []) if (postIds.has(post.id)) assets.push(...post.content.mediaAssets);
  return [
    ...new Map(
      assets.filter((asset) => asset.mimeType.startsWith('image/')).map((asset) => [asset.id, asset]),
    ).values(),
  ];
}
