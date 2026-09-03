import type { DerivedVisualDto } from '@/shared/contracts';

export const derivedVisualCanvasPresetKeys: Record<DerivedVisualDto['role'], readonly string[]> = {
  ARTICLE_HEADER: ['wechat_article_cover_2_35_1'],
  ARTICLE_INLINE: ['landscape_4_3', 'square_1_1', 'xiaohongshu_portrait_3_4', 'video_landscape_16_9'],
  SOCIAL_POST_COVER: ['xiaohongshu_portrait_3_4'],
};

export function derivedVisualWorkspaceAvailable(
  visual: DerivedVisualDto,
  seriesIds: ReadonlySet<string>,
  creationDraftId: string | null,
) {
  return visual.promptSeriesId ? seriesIds.has(visual.promptSeriesId) : creationDraftId === visual.creationDraftId;
}
