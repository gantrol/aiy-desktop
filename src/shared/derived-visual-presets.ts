import type { DerivedVisualRole } from '@/shared/contracts/derived-visual';

export const derivedVisualCanvasPresetKeys: Record<DerivedVisualRole, readonly string[]> = {
  ARTICLE_HEADER: [
    'xiaohongshu_portrait_3_4',
    'square_1_1',
    'landscape_4_3',
    'video_landscape_16_9',
    'wechat_article_cover_2_35_1',
  ],
  ARTICLE_INLINE: ['landscape_4_3', 'square_1_1', 'xiaohongshu_portrait_3_4', 'video_landscape_16_9'],
  SOCIAL_POST_COVER: ['xiaohongshu_portrait_3_4', 'social_portrait_4_5', 'square_1_1'],
};
