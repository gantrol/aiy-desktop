import type { BootstrapDto, CreationFormDto, CreationItemDto, DerivedVisualDto, Locale } from '@/shared/contracts';
import type { ContentLifecycleActionRequest } from '@/renderer/components/albums/useContentLifecycleActions';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import type { CreationRelationItem } from '@/renderer/components/creator/CreationRelationsSheet';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';

export function creatorMaterialLifecycleTarget(item: MaterialLibraryItem) {
  if (item.kind === 'TEXT') return { entityType: 'MATERIAL' as const, entityId: item.text.id };
  return item.image.materialId
    ? { entityType: 'MATERIAL' as const, entityId: item.image.materialId }
    : { entityType: 'IMAGE_ASSET' as const, entityId: item.image.asset.id };
}

export function selectedCreationItemId(
  items: readonly CreationItemDto[],
  selection: {
    seriesId: string | null;
    imageBreakdownId: string | null;
    evaluationSuiteId: string | null;
    inspirationStashId: string | null;
    socialPostId: string | null;
    articleId: string | null;
    videoDocumentId: string | null;
  },
) {
  return items.find((item) =>
    item.forms.some(
      (form) =>
        (form.entity.kind === 'PROMPT_SERIES' && form.entity.id === selection.seriesId) ||
        (form.entity.kind === 'IMAGE_BREAKDOWN' && form.entity.id === selection.imageBreakdownId) ||
        (form.entity.kind === 'EVALUATION_SUITE' && form.entity.id === selection.evaluationSuiteId) ||
        (form.entity.kind === 'INSPIRATION_STASH' && form.entity.id === selection.inspirationStashId) ||
        (form.entity.kind === 'SOCIAL_POST' && form.entity.id === selection.socialPostId) ||
        (form.entity.kind === 'ARTICLE' && form.entity.id === selection.articleId) ||
        (form.entity.kind === 'VIDEO_DOCUMENT' && form.entity.id === selection.videoDocumentId),
    ),
  )?.id;
}

export function selectedContentLifecycleTarget(
  target: ContentLifecycleActionRequest['target'],
  selectedByType: Partial<Record<ContentLifecycleActionRequest['target']['entityType'], string | null | undefined>>,
) {
  return selectedByType[target.entityType] === target.entityId;
}

export function commitGeneratedImageLocation(
  keepEditorOpen: boolean,
  seriesId: string,
  versionId: string,
  commit: (location: CreatorLocation, mode: NavigationMode) => void,
) {
  if (!keepEditorOpen) commit({ surface: 'existing-creation', seriesId, assetId: null, versionId }, 'replace');
}

export function derivedVisualRoleTitle(role: DerivedVisualDto['role'], locale: Locale) {
  if (locale === 'zh') {
    if (role === 'SOCIAL_POST_COVER') return '封面设计';
    if (role === 'ARTICLE_HEADER') return '题图设计';
    return '配图设计';
  }
  if (role === 'SOCIAL_POST_COVER') return 'Cover design';
  if (role === 'ARTICLE_HEADER') return 'Hero design';
  return 'Illustration design';
}

export function defaultStandaloneCreationSeriesId(data: BootstrapDto, sessions: readonly CreationSessionProjection[]) {
  const derivedSeriesIds = new Set(
    (data.derivedVisuals ?? []).flatMap((visual) => (visual.promptSeriesId ? [visual.promptSeriesId] : [])),
  );
  return (
    sessions.find((session) => session.memberSeries.every((series) => !derivedSeriesIds.has(series.id)))?.primarySeries
      .id ?? null
  );
}

export function defaultStandaloneCreationDraft(data: BootstrapDto) {
  const draft = data.creationDraft;
  if (!draft) return null;
  return (data.derivedVisuals ?? []).some((visual) => visual.creationDraftId === draft.id) ? null : draft;
}

export function derivedVisualSchemes(activeVisual: DerivedVisualDto | null, data: BootstrapDto) {
  if (!activeVisual || activeVisual.role === 'ARTICLE_INLINE') return activeVisual ? [activeVisual] : [];
  const context = creationFormByEntity(data.creationItems, 'DERIVED_VISUAL', activeVisual.id);
  if (!context) return [activeVisual];
  const visualById = new Map((data.derivedVisuals ?? []).map((visual) => [visual.id, visual] as const));
  const schemes = context.item.forms
    .filter(
      (form) =>
        form.role === activeVisual.role &&
        form.sourceFormId === context.form.sourceFormId &&
        form.entity.kind === 'DERIVED_VISUAL',
    )
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .flatMap((form) => visualById.get(form.entity.id) ?? []);
  return schemes.some((visual) => visual.id === activeVisual.id) ? schemes : [...schemes, activeVisual];
}

export function creationRelationsForForm(
  data: BootstrapDto,
  sourceForm: CreationFormDto | null,
  locale: Locale,
): CreationRelationItem[] {
  if (!sourceForm) return [];
  const item = data.creationItems.find((candidate) => candidate.id === sourceForm.creationItemId);
  if (!item) return [];
  const children = item.forms.filter((form) => form.sourceFormId === sourceForm.id);
  const source = sourceForm.sourceFormId
    ? (item.forms.find((form) => form.id === sourceForm.sourceFormId) ?? null)
    : null;
  const related = [
    ...(source ? [{ form: source, direction: 'SOURCE' as const }] : []),
    ...children.map((form) => ({ form, direction: 'DERIVED' as const })),
  ];
  return related.flatMap(({ form, direction }, index) => {
    if (form.role === 'ARTICLE' && form.entity.kind === 'ARTICLE') {
      const article = (data.articles ?? []).find((candidate) => candidate.id === form.entity.id);
      return article
        ? [
            {
              formId: form.id,
              role: form.role,
              direction,
              title: article.content.title || (locale === 'zh' ? '未命名文章' : 'Untitled article'),
              imageAssetIds: article.content.mediaBindings.map((binding) => binding.assetId),
            },
          ]
        : [];
    }
    if (form.role === 'SOCIAL_POST' && form.entity.kind === 'SOCIAL_POST') {
      const post = (data.socialPosts ?? []).find((candidate) => candidate.id === form.entity.id);
      return post
        ? [
            {
              formId: form.id,
              role: form.role,
              direction,
              title: post.content.title || (locale === 'zh' ? '未命名贴图' : 'Untitled post'),
              imageAssetIds: post.content.mediaAssetIds,
            },
          ]
        : [];
    }
    if (form.entity.kind !== 'DERIVED_VISUAL') return [];
    const visual = (data.derivedVisuals ?? []).find((candidate) => candidate.id === form.entity.id);
    if (!visual) return [];
    const seriesTitle = visual.promptSeriesId
      ? data.series.find((candidate) => candidate.id === visual.promptSeriesId)?.title
      : null;
    const ordinal = related
      .slice(0, index + 1)
      .filter((candidate) => candidate.form.role === form.role && candidate.direction === direction).length;
    const label =
      form.role === 'SOCIAL_POST_COVER'
        ? locale === 'zh'
          ? '封面'
          : 'Cover'
        : form.role === 'ARTICLE_HEADER'
          ? locale === 'zh'
            ? '题图'
            : 'Hero image'
          : locale === 'zh'
            ? '配图'
            : 'Illustration';
    return [
      {
        formId: form.id,
        role: form.role,
        direction,
        title: seriesTitle || `${label} ${ordinal}`,
        imageAssetIds: visual.selectedImageAssetId ? [visual.selectedImageAssetId] : [],
      },
    ];
  });
}

export function imageSeriesIdForCreationItem(item: CreationItemDto | null) {
  const imageForm = item?.forms.find((form) => form.role === 'IMAGE_CREATION');
  return imageForm?.entity.kind === 'PROMPT_SERIES' ? imageForm.entity.id : null;
}

export function defaultDerivedDraftParentLocation(data: BootstrapDto): CreatorLocation | null {
  const draftId = data.creationDraft?.id;
  const visual = draftId
    ? (data.derivedVisuals ?? []).find((candidate) => candidate.creationDraftId === draftId)
    : null;
  if (visual?.articleId && (data.articles ?? []).some((article) => article.id === visual.articleId)) {
    return { surface: 'article', articleId: visual.articleId };
  }
  if (visual?.socialPostId && (data.socialPosts ?? []).some((post) => post.id === visual.socialPostId)) {
    return { surface: 'social-post', postId: visual.socialPostId };
  }
  return null;
}
