import type { BootstrapDto, DerivedVisualDto, PromptSeriesDto } from '@/shared/contracts';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';

type DerivedVisualLocation = Extract<CreatorLocation, { surface: 'existing-creation' | 'creation-draft' }> & {
  derivedVisualId: string;
};
type DerivedVisualParentLocation = Extract<CreatorLocation, { surface: 'article' | 'social-post' }>;

export interface DerivedVisualWorkspaceViewState {
  outputSeriesId?: string;
  versionId?: string;
  assetId?: string | null;
  navigationMode?: NavigationMode;
}

export class DerivedVisualViewUnavailableError extends Error {
  override name = 'DerivedVisualViewUnavailableError';
}

export function isDerivedVisualLocation(location: CreatorLocation): location is DerivedVisualLocation {
  return (
    (location.surface === 'existing-creation' || location.surface === 'creation-draft') &&
    Boolean(location.derivedVisualId)
  );
}

export function derivedVisualForLocation(data: Pick<BootstrapDto, 'derivedVisuals'>, location: CreatorLocation) {
  if (!isDerivedVisualLocation(location)) return null;
  return (
    data.derivedVisuals?.find(
      (visual) =>
        visual.id === location.derivedVisualId &&
        (location.surface === 'existing-creation'
          ? visual.promptSeriesId === location.seriesId
          : visual.creationDraftId === location.draftId),
    ) ?? null
  );
}

export function derivedVisualParentLocation(visual: DerivedVisualDto | null): DerivedVisualParentLocation | null {
  if (visual?.articleId) return { surface: 'article', articleId: visual.articleId };
  if (visual?.socialPostId) return { surface: 'social-post', postId: visual.socialPostId };
  return null;
}

export function derivedVisualWorkspaceVersion(series: PromptSeriesDto, requestedVersionId?: string) {
  if (requestedVersionId) return series.versions.find((version) => version.id === requestedVersionId);
  return series.versions.find((version) => version.id === series.currentVersionId) ?? series.versions[0];
}

export const derivedVisualCanvasPresetKeys: Record<DerivedVisualDto['role'], readonly string[]> = {
  ARTICLE_HEADER: ['wechat_article_cover_2_35_1'],
  ARTICLE_INLINE: ['landscape_4_3', 'square_1_1', 'xiaohongshu_portrait_3_4', 'video_landscape_16_9'],
  SOCIAL_POST_COVER: ['xiaohongshu_portrait_3_4'],
};

export function derivedVisualWorkspaceAvailable(visual: DerivedVisualDto, seriesIds: ReadonlySet<string>) {
  return visual.promptSeriesId ? seriesIds.has(visual.promptSeriesId) : Boolean(visual.creationDraftId);
}
