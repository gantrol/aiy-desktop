import { z } from 'zod';

export const ARTICLE_COVER_RATIOS = ['1:1', '3:4', '4:3', '16:9', '2.35:1'] as const;
export type ArticleCoverRatio = (typeof ARTICLE_COVER_RATIOS)[number];

export const ARTICLE_COVER_PRESET_KEYS: Record<ArticleCoverRatio, string> = {
  '1:1': 'square_1_1',
  '3:4': 'xiaohongshu_portrait_3_4',
  '4:3': 'landscape_4_3',
  '16:9': 'video_landscape_16_9',
  '2.35:1': 'wechat_article_cover_2_35_1',
};

export const articleCoverCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    zoom: z.number().min(1).max(4),
  })
  .strict();

export const articleCoverVariantSchema = z
  .object({
    ratio: z.enum(ARTICLE_COVER_RATIOS),
    assetId: z.string().min(1).max(200),
    sourceAssetId: z.string().min(1).max(200),
    crop: articleCoverCropSchema,
  })
  .strict();

export const articleCoverVariantsSchema = z
  .array(articleCoverVariantSchema)
  .max(ARTICLE_COVER_RATIOS.length)
  .refine((variants) => new Set(variants.map((variant) => variant.ratio)).size === variants.length);

export type ArticleCoverVariant = z.infer<typeof articleCoverVariantSchema>;
export type ArticleCoverCrop = z.infer<typeof articleCoverCropSchema>;

export function articleCoverAspectRatio(ratio: ArticleCoverRatio) {
  const [width, height] = ratio.split(':').map(Number);
  return width / height;
}

export function articleCoverCropRect(width: number, height: number, ratio: ArticleCoverRatio, crop: ArticleCoverCrop) {
  const aspect = articleCoverAspectRatio(ratio);
  const cropWidth = Math.min(width, height * aspect) / crop.zoom;
  const cropHeight = cropWidth / aspect;
  return { x: (width - cropWidth) * crop.x, y: (height - cropHeight) * crop.y, width: cropWidth, height: cropHeight };
}

export function articleCoverAssetIds(content: {
  coverAssetId: string | null;
  coverVariants?: readonly ArticleCoverVariant[];
}) {
  return [
    ...new Set([
      ...(content.coverAssetId ? [content.coverAssetId] : []),
      ...(content.coverVariants ?? []).flatMap((variant) => [variant.assetId, variant.sourceAssetId]),
    ]),
  ];
}
