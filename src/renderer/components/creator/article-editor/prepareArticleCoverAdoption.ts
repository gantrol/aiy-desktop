import type { AssetDto, DerivedVisualDto } from '@/shared/contracts';
import { articleCoverAspectRatio } from '@/shared/article-covers';

/** A provider's canvas request is not proof that its returned pixels match the cover slot. */
export async function prepareArticleCoverAdoption(visual: DerivedVisualDto, asset: AssetDto): Promise<string> {
  if (!visual.coverRatio || !visual.promptSeriesId) return asset.id;
  const aspect = articleCoverAspectRatio(visual.coverRatio);
  if (Math.abs(asset.width - asset.height * aspect) <= 1) return asset.id;
  const [ratioWidth, ratioHeight] =
    visual.coverRatio === '2.35:1' ? [47, 20] : visual.coverRatio.split(':').map(Number);
  const result = await window.desktopApi.imageCrop({
    seriesId: visual.promptSeriesId,
    sourceAssetId: asset.id,
    ratioWidth,
    ratioHeight,
  });
  if (
    result.sourceAssetId !== asset.id ||
    result.seriesId !== visual.promptSeriesId ||
    Math.abs(result.asset.width - result.asset.height * aspect) > 1
  )
    throw new Error('ARTICLE_COVER_CROP_MISMATCH');
  return result.asset.id;
}
