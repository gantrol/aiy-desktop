import type {
  ArticleDto,
  CreationFormDto,
  CreationFormEntityRef,
  CreationItemDto,
  DerivedVisualDto,
  InspirationStashDto,
  Locale,
  PromptSeriesDto,
  SocialPostDto,
  VideoDocumentSummaryDto,
} from '@/shared/contracts';
import { creationSessionCoverFirstAssets } from '@/renderer/components/creator/creationCoverFirstAssets';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';

export type InspirationCreationFormDto = Extract<CreationFormDto, { role: 'INSPIRATION' }>;
export type ImageCreationFormDto = Extract<CreationFormDto, { role: 'IMAGE_CREATION' }>;
export type SocialPostCreationFormDto = Extract<CreationFormDto, { role: 'SOCIAL_POST' }>;
export type ArticleCreationFormDto = Extract<CreationFormDto, { role: 'ARTICLE' }>;
export type VideoDocumentCreationFormDto = Extract<CreationFormDto, { role: 'VIDEO_DOCUMENT' }>;
export type SocialPostCoverCreationFormDto = Extract<CreationFormDto, { role: 'SOCIAL_POST_COVER' }>;
export type ArticleHeaderCreationFormDto = Extract<CreationFormDto, { role: 'ARTICLE_HEADER' }>;
export type ArticleInlineCreationFormDto = Extract<CreationFormDto, { role: 'ARTICLE_INLINE' }>;

type PromptSeriesEntityRef = Extract<CreationFormEntityRef, { kind: 'PROMPT_SERIES' }>;
type InspirationStashEntityRef = Extract<CreationFormEntityRef, { kind: 'INSPIRATION_STASH' }>;
type SocialPostEntityRef = Extract<CreationFormEntityRef, { kind: 'SOCIAL_POST' }>;
type ArticleEntityRef = Extract<CreationFormEntityRef, { kind: 'ARTICLE' }>;
type VideoDocumentEntityRef = Extract<CreationFormEntityRef, { kind: 'VIDEO_DOCUMENT' }>;
type DerivedVisualEntityRef = Extract<CreationFormEntityRef, { kind: 'DERIVED_VISUAL' }>;

export type CreationFormEntity =
  PromptSeriesDto | InspirationStashDto | SocialPostDto | ArticleDto | VideoDocumentSummaryDto | DerivedVisualDto;

export interface CreationFormEntityIndex {
  promptSeriesById: ReadonlyMap<string, PromptSeriesDto>;
  inspirationStashById: ReadonlyMap<string, InspirationStashDto>;
  socialPostById: ReadonlyMap<string, SocialPostDto>;
  articleById: ReadonlyMap<string, ArticleDto>;
  videoDocumentById: ReadonlyMap<string, VideoDocumentSummaryDto>;
  derivedVisualById: ReadonlyMap<string, DerivedVisualDto>;
  sessionBySeriesId: ReadonlyMap<string, CreationSessionProjection>;
}

export interface CreationFormEntitySource {
  series: readonly PromptSeriesDto[];
  sessions: readonly CreationSessionProjection[];
  inspirationStashes: readonly InspirationStashDto[];
  socialPosts: readonly SocialPostDto[];
  articles: readonly ArticleDto[];
  videoDocuments: readonly VideoDocumentSummaryDto[];
  derivedVisuals: readonly DerivedVisualDto[];
}

function indexById<T extends { id: string }>(items: readonly T[]) {
  return new Map(items.map((item) => [item.id, item] as const));
}

export function creationFormEntityRefKey(ref: CreationFormEntityRef) {
  return `${ref.kind}:${ref.id}`;
}

export function buildCreationFormEntityIndex({
  series,
  sessions,
  inspirationStashes,
  socialPosts,
  articles,
  videoDocuments,
  derivedVisuals,
}: CreationFormEntitySource): CreationFormEntityIndex {
  const sessionBySeriesId = new Map<string, CreationSessionProjection>();
  for (const session of sessions) {
    for (const member of session.memberSeries) sessionBySeriesId.set(member.id, session);
  }
  return {
    promptSeriesById: indexById(series),
    inspirationStashById: indexById(inspirationStashes),
    socialPostById: indexById(socialPosts),
    articleById: indexById(articles),
    videoDocumentById: indexById(videoDocuments),
    derivedVisualById: indexById(derivedVisuals),
    sessionBySeriesId,
  };
}

export function resolveCreationFormEntity(
  ref: PromptSeriesEntityRef,
  index: CreationFormEntityIndex,
): PromptSeriesDto | null;
export function resolveCreationFormEntity(
  ref: InspirationStashEntityRef,
  index: CreationFormEntityIndex,
): InspirationStashDto | null;
export function resolveCreationFormEntity(
  ref: SocialPostEntityRef,
  index: CreationFormEntityIndex,
): SocialPostDto | null;
export function resolveCreationFormEntity(ref: ArticleEntityRef, index: CreationFormEntityIndex): ArticleDto | null;
export function resolveCreationFormEntity(
  ref: VideoDocumentEntityRef,
  index: CreationFormEntityIndex,
): VideoDocumentSummaryDto | null;
export function resolveCreationFormEntity(
  ref: DerivedVisualEntityRef,
  index: CreationFormEntityIndex,
): DerivedVisualDto | null;
export function resolveCreationFormEntity(
  ref: CreationFormEntityRef,
  index: CreationFormEntityIndex,
): CreationFormEntity | null;
export function resolveCreationFormEntity(
  ref: CreationFormEntityRef,
  index: CreationFormEntityIndex,
): CreationFormEntity | null {
  switch (ref.kind) {
    case 'PROMPT_SERIES':
      return index.promptSeriesById.get(ref.id) ?? null;
    case 'INSPIRATION_STASH':
      return index.inspirationStashById.get(ref.id) ?? null;
    case 'SOCIAL_POST':
      return index.socialPostById.get(ref.id) ?? null;
    case 'ARTICLE':
      return index.articleById.get(ref.id) ?? null;
    case 'VIDEO_DOCUMENT':
      return index.videoDocumentById.get(ref.id) ?? null;
    case 'DERIVED_VISUAL':
      return index.derivedVisualById.get(ref.id) ?? null;
  }
}

interface CreationFormProjectionBase<TForm extends CreationFormDto, TEntity extends CreationFormEntity> {
  key: string;
  role: TForm['role'];
  form: TForm;
  entityRef: TForm['entity'];
  entity: TEntity | null;
}

export type InspirationCreationFormProjection = CreationFormProjectionBase<
  InspirationCreationFormDto,
  InspirationStashDto
>;

export type ImageCreationFormProjection = CreationFormProjectionBase<ImageCreationFormDto, PromptSeriesDto> & {
  session: CreationSessionProjection | null;
};

export type SocialPostCreationFormProjection = CreationFormProjectionBase<SocialPostCreationFormDto, SocialPostDto>;
export type ArticleCreationFormProjection = CreationFormProjectionBase<ArticleCreationFormDto, ArticleDto>;
export type VideoDocumentCreationFormProjection = CreationFormProjectionBase<
  VideoDocumentCreationFormDto,
  VideoDocumentSummaryDto
>;

interface DerivedVisualCreationFormProjectionBase<
  TForm extends SocialPostCoverCreationFormDto | ArticleHeaderCreationFormDto | ArticleInlineCreationFormDto,
> extends CreationFormProjectionBase<TForm, DerivedVisualDto> {
  series: PromptSeriesDto | null;
  session: CreationSessionProjection | null;
}

export type SocialPostCoverCreationFormProjection =
  DerivedVisualCreationFormProjectionBase<SocialPostCoverCreationFormDto>;
export type ArticleHeaderCreationFormProjection = DerivedVisualCreationFormProjectionBase<ArticleHeaderCreationFormDto>;
export type ArticleInlineCreationFormProjection = DerivedVisualCreationFormProjectionBase<ArticleInlineCreationFormDto>;

export type CreationFormProjection =
  | InspirationCreationFormProjection
  | ImageCreationFormProjection
  | SocialPostCreationFormProjection
  | ArticleCreationFormProjection
  | VideoDocumentCreationFormProjection
  | SocialPostCoverCreationFormProjection
  | ArticleHeaderCreationFormProjection
  | ArticleInlineCreationFormProjection;

function derivedVisualSeries(visual: DerivedVisualDto | null, index: CreationFormEntityIndex) {
  return visual?.promptSeriesId ? (index.promptSeriesById.get(visual.promptSeriesId) ?? null) : null;
}

export function projectCreationForm(form: CreationFormDto, index: CreationFormEntityIndex): CreationFormProjection {
  switch (form.role) {
    case 'INSPIRATION':
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity: resolveCreationFormEntity(form.entity, index),
      };
    case 'IMAGE_CREATION': {
      const entity = resolveCreationFormEntity(form.entity, index);
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity,
        session: index.sessionBySeriesId.get(form.entity.id) ?? null,
      };
    }
    case 'SOCIAL_POST':
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity: resolveCreationFormEntity(form.entity, index),
      };
    case 'ARTICLE':
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity: resolveCreationFormEntity(form.entity, index),
      };
    case 'VIDEO_DOCUMENT':
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity: resolveCreationFormEntity(form.entity, index),
      };
    case 'SOCIAL_POST_COVER': {
      const entity = resolveCreationFormEntity(form.entity, index);
      const series = derivedVisualSeries(entity, index);
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity,
        series,
        session: series ? (index.sessionBySeriesId.get(series.id) ?? null) : null,
      };
    }
    case 'ARTICLE_HEADER': {
      const entity = resolveCreationFormEntity(form.entity, index);
      const series = derivedVisualSeries(entity, index);
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity,
        series,
        session: series ? (index.sessionBySeriesId.get(series.id) ?? null) : null,
      };
    }
    case 'ARTICLE_INLINE': {
      const entity = resolveCreationFormEntity(form.entity, index);
      const series = derivedVisualSeries(entity, index);
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity,
        series,
        session: series ? (index.sessionBySeriesId.get(series.id) ?? null) : null,
      };
    }
  }
}

export function compareCreationForms(
  left: Pick<CreationFormDto, 'sortOrder' | 'createdAt' | 'id'>,
  right: Pick<CreationFormDto, 'sortOrder' | 'createdAt' | 'id'>,
) {
  return (
    left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );
}

export function compareCreationFormProjections(left: CreationFormProjection, right: CreationFormProjection) {
  return compareCreationForms(left.form, right.form);
}

function latestActivity(values: readonly (string | null | undefined)[]) {
  let latest = '';
  for (const value of values) {
    if (value && value.localeCompare(latest) > 0) latest = value;
  }
  return latest;
}

export function creationSessionActivity(session: CreationSessionProjection) {
  return latestActivity(
    session.memberSeries.flatMap((series) => [
      ...series.versions.flatMap((version) => [
        version.createdAt,
        ...version.runs.map((run) => run.finishedAt ?? run.createdAt),
      ]),
      ...(series.importedOutputs ?? []).map((output) => output.createdAt),
      ...(series.transformedOutputs ?? []).map((output) => output.createdAt),
    ]),
  );
}

export function creationSessionTitle(session: CreationSessionProjection, locale: Locale) {
  if (!session.syntheticExperimentRoot) return session.primarySeries.title;
  return locale === 'zh' ? '方向实验' : 'Direction experiment';
}

function roleFallbackTitle(role: CreationFormDto['role'], locale: Locale) {
  if (locale === 'zh') {
    switch (role) {
      case 'INSPIRATION':
        return '灵感暂存';
      case 'IMAGE_CREATION':
        return '未命名创作';
      case 'SOCIAL_POST':
        return '未命名贴图';
      case 'ARTICLE':
        return '未命名文章';
      case 'VIDEO_DOCUMENT':
        return '未命名视频文档';
      case 'SOCIAL_POST_COVER':
        return '贴图封面';
      case 'ARTICLE_HEADER':
        return '文章题图';
      case 'ARTICLE_INLINE':
        return '文章配图';
    }
  }
  switch (role) {
    case 'INSPIRATION':
      return 'Inspiration';
    case 'IMAGE_CREATION':
      return 'Untitled creation';
    case 'SOCIAL_POST':
      return 'Untitled post';
    case 'ARTICLE':
      return 'Untitled article';
    case 'VIDEO_DOCUMENT':
      return 'Untitled video document';
    case 'SOCIAL_POST_COVER':
      return 'Social post cover';
    case 'ARTICLE_HEADER':
      return 'Article header';
    case 'ARTICLE_INLINE':
      return 'Article image';
  }
}

export function creationFormTitle(projection: CreationFormProjection, locale: Locale) {
  switch (projection.role) {
    case 'INSPIRATION':
      return projection.entity?.title || roleFallbackTitle(projection.role, locale);
    case 'IMAGE_CREATION':
      return projection.session
        ? creationSessionTitle(projection.session, locale)
        : projection.entity?.title || roleFallbackTitle(projection.role, locale);
    case 'SOCIAL_POST':
      return projection.entity?.content.title || roleFallbackTitle(projection.role, locale);
    case 'ARTICLE':
      return projection.entity?.content.title || roleFallbackTitle(projection.role, locale);
    case 'VIDEO_DOCUMENT':
      return projection.entity?.title || roleFallbackTitle(projection.role, locale);
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE':
      return projection.series?.title || roleFallbackTitle(projection.role, locale);
  }
}

function coverFirstAssetIds(assetIds: readonly string[], coverAssetId: string | null) {
  const ordered = coverAssetId ? [coverAssetId, ...assetIds.filter((assetId) => assetId !== coverAssetId)] : assetIds;
  return [...new Set(ordered)];
}

export function creationFormPreviewAssetIds(projection: CreationFormProjection): string[] {
  switch (projection.role) {
    case 'INSPIRATION':
      return projection.entity?.content.referenceAssets.map((asset) => asset.id) ?? [];
    case 'IMAGE_CREATION':
      if (projection.session) return creationSessionCoverFirstAssets(projection.session).map(({ asset }) => asset.id);
      return (
        projection.entity?.covers?.map((asset) => asset.id) ??
        (projection.entity?.cover ? [projection.entity.cover.id] : [])
      );
    case 'SOCIAL_POST':
      return projection.entity
        ? coverFirstAssetIds(
            projection.entity.content.mediaAssets.map((asset) => asset.id),
            projection.entity.content.coverAssetId,
          )
        : [];
    case 'ARTICLE':
      return projection.entity
        ? coverFirstAssetIds(
            projection.entity.content.mediaAssets.map((asset) => asset.id),
            projection.entity.content.coverAssetId,
          )
        : [];
    case 'VIDEO_DOCUMENT':
      return projection.entity?.thumbnail ? [projection.entity.thumbnail.assetId] : [];
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE':
      return projection.entity?.selectedImageAssetId ? [projection.entity.selectedImageAssetId] : [];
  }
}

export function creationFormActivityAt(projection: CreationFormProjection) {
  switch (projection.role) {
    case 'IMAGE_CREATION':
      return latestActivity([
        projection.form.updatedAt,
        projection.session ? creationSessionActivity(projection.session) : null,
      ]);
    case 'INSPIRATION':
    case 'SOCIAL_POST':
    case 'ARTICLE':
    case 'VIDEO_DOCUMENT':
      return latestActivity([projection.form.updatedAt, projection.entity?.updatedAt]);
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE':
      return latestActivity([
        projection.form.updatedAt,
        projection.entity?.updatedAt,
        projection.session ? creationSessionActivity(projection.session) : null,
      ]);
  }
}

export interface CreationItemProjection {
  /** Exact stable aggregate ID; never a primary-form or entity-derived key. */
  key: string;
  item: CreationItemDto;
  primaryForm: CreationFormProjection | null;
  /** Form opened by the aggregate row; it is not itself the aggregate row. */
  defaultForm: CreationFormProjection | null;
  orderedForms: CreationFormProjection[];
  title: string;
  activityAt: string;
  previewAssetIds: string[];
}

export function projectCreationItem(
  item: CreationItemDto,
  index: CreationFormEntityIndex,
  locale: Locale,
): CreationItemProjection {
  const sortedForms = item.forms.map((form) => projectCreationForm(form, index)).sort(compareCreationFormProjections);
  const primaryForm = item.primaryFormId
    ? (sortedForms.find((projection) => projection.form.id === item.primaryFormId) ?? null)
    : null;
  const defaultForm = primaryForm ?? sortedForms[0] ?? null;
  const remainingForms = defaultForm
    ? sortedForms.filter((projection) => projection.form.id !== defaultForm.form.id)
    : sortedForms;
  const orderedForms = defaultForm ? [defaultForm, ...remainingForms] : remainingForms;
  const activityAt = latestActivity([item.updatedAt, ...orderedForms.map(creationFormActivityAt)]);
  return {
    key: item.id,
    item,
    primaryForm,
    defaultForm,
    orderedForms,
    title: defaultForm ? creationFormTitle(defaultForm, locale) : roleFallbackTitle('IMAGE_CREATION', locale),
    activityAt,
    previewAssetIds: defaultForm ? creationFormPreviewAssetIds(defaultForm) : [],
  };
}

export interface BuildCreationLibraryProjectionInput extends CreationFormEntitySource {
  creationItems: readonly CreationItemDto[];
  locale: Locale;
}

export interface CreationLibraryProjection {
  items: CreationItemProjection[];
  itemById: ReadonlyMap<string, CreationItemProjection>;
  formById: ReadonlyMap<string, CreationFormProjection>;
  formByEntityRef: ReadonlyMap<string, CreationFormProjection>;
  itemByEntityRef: ReadonlyMap<string, CreationItemProjection>;
  entities: CreationFormEntityIndex;
}

function canonicalSessionItem(items: readonly CreationItemProjection[]) {
  return [...items].sort((left, right) => {
    const leftOwnsPrimary =
      left.defaultForm?.role === 'IMAGE_CREATION' &&
      left.defaultForm.session?.primarySeries.id === left.defaultForm.entityRef.id;
    const rightOwnsPrimary =
      right.defaultForm?.role === 'IMAGE_CREATION' &&
      right.defaultForm.session?.primarySeries.id === right.defaultForm.entityRef.id;
    return Number(rightOwnsPrimary) - Number(leftOwnsPrimary) || left.key.localeCompare(right.key);
  })[0];
}

export function buildCreationLibraryProjection({
  creationItems,
  locale,
  ...entitySource
}: BuildCreationLibraryProjectionInput): CreationLibraryProjection {
  const entities = buildCreationFormEntityIndex(entitySource);
  const projectedItems = creationItems.map((item) => projectCreationItem(item, entities, locale));
  const sessionItems = new Map<string, CreationItemProjection[]>();
  for (const item of projectedItems) {
    const session = item.defaultForm?.role === 'IMAGE_CREATION' ? item.defaultForm.session : null;
    if (!session) continue;
    const values = sessionItems.get(session.id);
    if (values) values.push(item);
    else sessionItems.set(session.id, [item]);
  }
  const canonicalItemBySessionId = new Map(
    [...sessionItems].flatMap(([sessionId, candidates]) => {
      const canonical = canonicalSessionItem(candidates);
      return canonical ? [[sessionId, canonical] as const] : [];
    }),
  );
  // Direction and historical experiment series may still have compatibility
  // CreationItems. A creation session is one sidebar aggregate, so render only
  // its canonical item while retaining entity aliases for exact resume.
  const items = projectedItems.filter((item) => {
    const session = item.defaultForm?.role === 'IMAGE_CREATION' ? item.defaultForm.session : null;
    return !session || canonicalItemBySessionId.get(session.id)?.key === item.key;
  });
  const itemById = new Map(projectedItems.map((item) => [item.key, item] as const));
  const formById = new Map<string, CreationFormProjection>();
  const formByEntityRef = new Map<string, CreationFormProjection>();
  const itemByEntityRef = new Map<string, CreationItemProjection>();
  for (const item of projectedItems) {
    for (const form of item.orderedForms) {
      formById.set(form.form.id, form);
      formByEntityRef.set(creationFormEntityRefKey(form.entityRef), form);
      itemByEntityRef.set(creationFormEntityRefKey(form.entityRef), item);
    }
  }
  for (const item of canonicalItemBySessionId.values()) {
    const form = item.defaultForm;
    if (form?.role !== 'IMAGE_CREATION' || !form.session) continue;
    for (const member of form.session.memberSeries) {
      const key = creationFormEntityRefKey({ kind: 'PROMPT_SERIES', id: member.id });
      formByEntityRef.set(key, form);
      itemByEntityRef.set(key, item);
    }
  }
  return { items, itemById, formById, formByEntityRef, itemByEntityRef, entities };
}
