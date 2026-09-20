import type {
  ArticleDto,
  AssetDto,
  CreationFormDto,
  CreationFormEntityRef,
  CreationItemDto,
  DerivedVisualDto,
  EvaluationSuiteDto,
  ImageBreakdownDto,
  InspirationStashDto,
  Locale,
  PromptSeriesDto,
  SocialPostDto,
  VideoDocumentSummaryDto,
} from '@/shared/contracts';
import type { GifDocumentSummary } from '@/shared/contracts/gif-making';
import type { MessageCatalog } from '@/renderer/i18n/types';
export type CreationFormLabels = Pick<MessageCatalog['creator']['album'], 'formKinds' | 'directionExperiment'>;
import { creationSessionCoverFirstAssets } from '@/renderer/components/creator/creationCoverFirstAssets';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';

export type InspirationCreationFormDto = Extract<CreationFormDto, { role: 'INSPIRATION' }>;
export type ImageBreakdownCreationFormDto = Extract<CreationFormDto, { role: 'IMAGE_BREAKDOWN' }>;
export type EvaluationSuiteCreationFormDto = Extract<CreationFormDto, { role: 'EVALUATION_SUITE' }>;
export type ImageCreationFormDto = Extract<CreationFormDto, { role: 'IMAGE_CREATION' }>;
export type SocialPostCreationFormDto = Extract<CreationFormDto, { role: 'SOCIAL_POST' }>;
export type ArticleCreationFormDto = Extract<CreationFormDto, { role: 'ARTICLE' }>;
export type VideoDocumentCreationFormDto = Extract<CreationFormDto, { role: 'VIDEO_DOCUMENT' }>;
export type SocialPostCoverCreationFormDto = Extract<CreationFormDto, { role: 'SOCIAL_POST_COVER' }>;
export type ArticleHeaderCreationFormDto = Extract<CreationFormDto, { role: 'ARTICLE_HEADER' }>;
export type ArticleInlineCreationFormDto = Extract<CreationFormDto, { role: 'ARTICLE_INLINE' }>;

type PromptSeriesEntityRef = Extract<CreationFormEntityRef, { kind: 'PROMPT_SERIES' }>;
type ImageBreakdownEntityRef = Extract<CreationFormEntityRef, { kind: 'IMAGE_BREAKDOWN' }>;
type EvaluationSuiteEntityRef = Extract<CreationFormEntityRef, { kind: 'EVALUATION_SUITE' }>;
type InspirationStashEntityRef = Extract<CreationFormEntityRef, { kind: 'INSPIRATION_STASH' }>;
type SocialPostEntityRef = Extract<CreationFormEntityRef, { kind: 'SOCIAL_POST' }>;
type ArticleEntityRef = Extract<CreationFormEntityRef, { kind: 'ARTICLE' }>;
type VideoDocumentEntityRef = Extract<CreationFormEntityRef, { kind: 'VIDEO_DOCUMENT' }>;
type DerivedVisualEntityRef = Extract<CreationFormEntityRef, { kind: 'DERIVED_VISUAL' }>;

export type CreationFormEntity =
  | GifDocumentSummary
  | PromptSeriesDto
  | ImageBreakdownDto
  | EvaluationSuiteDto
  | InspirationStashDto
  | SocialPostDto
  | ArticleDto
  | VideoDocumentSummaryDto
  | DerivedVisualDto;

export interface CreationFormEntityIndex {
  animationById: ReadonlyMap<string, GifDocumentSummary>;
  promptSeriesById: ReadonlyMap<string, PromptSeriesDto>;
  imageBreakdownById: ReadonlyMap<string, ImageBreakdownDto>;
  evaluationSuiteById: ReadonlyMap<string, EvaluationSuiteDto>;
  inspirationStashById: ReadonlyMap<string, InspirationStashDto>;
  socialPostById: ReadonlyMap<string, SocialPostDto>;
  articleById: ReadonlyMap<string, ArticleDto>;
  videoDocumentById: ReadonlyMap<string, VideoDocumentSummaryDto>;
  derivedVisualById: ReadonlyMap<string, DerivedVisualDto>;
  sessionBySeriesId: ReadonlyMap<string, CreationSessionProjection>;
}

export interface CreationFormEntitySource {
  animations?: readonly GifDocumentSummary[];
  series: readonly PromptSeriesDto[];
  imageBreakdowns: readonly ImageBreakdownDto[];
  evaluationSuites: readonly EvaluationSuiteDto[];
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
  animations = [],
  series,
  imageBreakdowns,
  evaluationSuites,
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
    animationById: indexById(animations),
    promptSeriesById: indexById(series),
    imageBreakdownById: indexById(imageBreakdowns),
    evaluationSuiteById: indexById(evaluationSuites),
    inspirationStashById: indexById(inspirationStashes),
    socialPostById: indexById(socialPosts),
    articleById: indexById(articles),
    videoDocumentById: indexById(videoDocuments),
    derivedVisualById: indexById(derivedVisuals),
    sessionBySeriesId,
  };
}

export function resolveCreationFormEntity(
  ref: Extract<CreationFormEntityRef, { kind: 'GIF_DOCUMENT' }>,
  index: CreationFormEntityIndex,
): GifDocumentSummary | null;
export function resolveCreationFormEntity(
  ref: PromptSeriesEntityRef,
  index: CreationFormEntityIndex,
): PromptSeriesDto | null;
export function resolveCreationFormEntity(
  ref: ImageBreakdownEntityRef,
  index: CreationFormEntityIndex,
): ImageBreakdownDto | null;
export function resolveCreationFormEntity(
  ref: EvaluationSuiteEntityRef,
  index: CreationFormEntityIndex,
): EvaluationSuiteDto | null;
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
    case 'GIF_DOCUMENT':
      return index.animationById.get(ref.id) ?? null;
    case 'PROMPT_SERIES':
      return index.promptSeriesById.get(ref.id) ?? null;
    case 'IMAGE_BREAKDOWN':
      return index.imageBreakdownById.get(ref.id) ?? null;
    case 'EVALUATION_SUITE':
      return index.evaluationSuiteById.get(ref.id) ?? null;
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

export type ImageBreakdownCreationFormProjection = CreationFormProjectionBase<
  ImageBreakdownCreationFormDto,
  ImageBreakdownDto
>;

export type EvaluationSuiteCreationFormProjection = CreationFormProjectionBase<
  EvaluationSuiteCreationFormDto,
  EvaluationSuiteDto
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
  | CreationFormProjectionBase<Extract<CreationFormDto, { role: 'ANIMATION' }>, GifDocumentSummary>
  | InspirationCreationFormProjection
  | ImageBreakdownCreationFormProjection
  | EvaluationSuiteCreationFormProjection
  | ImageCreationFormProjection
  | SocialPostCreationFormProjection
  | ArticleCreationFormProjection
  | VideoDocumentCreationFormProjection
  | SocialPostCoverCreationFormProjection
  | ArticleHeaderCreationFormProjection
  | ArticleInlineCreationFormProjection;

export function creationFormKindLabel(form: CreationFormProjection, labels: CreationFormLabels) {
  const kind = form.role === 'ARTICLE' && form.entity?.content.editorMode === 'OUTLINE' ? 'OUTLINE' : form.role;
  return labels.formKinds[kind];
}

function derivedVisualSeries(visual: DerivedVisualDto | null, index: CreationFormEntityIndex) {
  return visual?.promptSeriesId ? (index.promptSeriesById.get(visual.promptSeriesId) ?? null) : null;
}

export function projectCreationForm(form: CreationFormDto, index: CreationFormEntityIndex): CreationFormProjection {
  switch (form.role) {
    case 'ANIMATION':
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity: resolveCreationFormEntity(form.entity, index),
      };
    case 'INSPIRATION':
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity: resolveCreationFormEntity(form.entity, index),
      };
    case 'IMAGE_BREAKDOWN':
      return {
        key: form.id,
        role: form.role,
        form,
        entityRef: form.entity,
        entity: resolveCreationFormEntity(form.entity, index),
      };
    case 'EVALUATION_SUITE':
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

export function creationSessionTitle(session: CreationSessionProjection, labels: CreationFormLabels) {
  return session.syntheticExperimentRoot ? labels.directionExperiment : session.primarySeries.title;
}

function roleFallbackTitle(role: CreationFormDto['role'], labels: CreationFormLabels) {
  return labels.formKinds[role];
}

export function creationFormTitle(projection: CreationFormProjection, labels: CreationFormLabels) {
  switch (projection.role) {
    case 'ANIMATION':
    case 'INSPIRATION':
    case 'IMAGE_BREAKDOWN':
    case 'VIDEO_DOCUMENT':
      return projection.entity?.title || roleFallbackTitle(projection.role, labels);
    case 'EVALUATION_SUITE':
      return projection.entity?.content.title || roleFallbackTitle(projection.role, labels);
    case 'IMAGE_CREATION':
      return projection.session
        ? creationSessionTitle(projection.session, labels)
        : projection.entity?.title || roleFallbackTitle(projection.role, labels);
    case 'SOCIAL_POST':
      return projection.entity?.content.title || roleFallbackTitle(projection.role, labels);
    case 'ARTICLE':
      return projection.entity?.content.title || creationFormKindLabel(projection, labels);
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE':
      return projection.series?.title || roleFallbackTitle(projection.role, labels);
  }
}

export type CreationPreviewAsset = Pick<AssetDto, 'id'> & { width: number | null; height: number | null };

function coverFirstAssets(assets: readonly CreationPreviewAsset[], coverAssetId: string | null) {
  const ordered = coverAssetId
    ? [assets.find((asset) => asset.id === coverAssetId) ?? { id: coverAssetId, width: null, height: null }, ...assets]
    : assets;
  const seen = new Set<string>();
  return ordered.filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

/** Carries the existing preview dimensions without reading originals or fetching details. */
export function creationFormPreviewAssets(projection: CreationFormProjection): CreationPreviewAsset[] {
  switch (projection.role) {
    case 'ANIMATION':
      return projection.entity?.preview ? [projection.entity.preview] : [];
    case 'INSPIRATION':
      return projection.entity?.content.referenceAssets ?? [];
    case 'IMAGE_BREAKDOWN':
      return projection.entity ? [projection.entity.sourceAsset] : [];
    case 'EVALUATION_SUITE':
      return [];
    case 'IMAGE_CREATION':
      if (projection.session) return creationSessionCoverFirstAssets(projection.session).map(({ asset }) => asset);
      return projection.entity?.covers ?? (projection.entity?.cover ? [projection.entity.cover] : []);
    case 'SOCIAL_POST':
    case 'ARTICLE':
      return projection.entity
        ? coverFirstAssets(projection.entity.content.mediaAssets, projection.entity.content.coverAssetId)
        : [];
    case 'VIDEO_DOCUMENT': {
      const thumbnail = projection.entity?.thumbnail;
      return thumbnail ? [{ id: thumbnail.assetId, width: thumbnail.width, height: thumbnail.height }] : [];
    }
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE': {
      const assets = projection.session
        ? creationSessionCoverFirstAssets(projection.session).map(({ asset }) => asset)
        : [];
      return coverFirstAssets(assets, projection.entity?.selectedImageAssetId ?? null);
    }
  }
}

export function creationFormPreviewAssetIds(projection: CreationFormProjection): string[] {
  return creationFormPreviewAssets(projection).map((asset) => asset.id);
}

export function creationFormActivityAt(projection: CreationFormProjection) {
  switch (projection.role) {
    case 'IMAGE_CREATION':
      return latestActivity([
        projection.form.updatedAt,
        projection.session ? creationSessionActivity(projection.session) : null,
      ]);
    case 'ANIMATION':
    case 'INSPIRATION':
    case 'IMAGE_BREAKDOWN':
    case 'EVALUATION_SUITE':
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
  labels: CreationFormLabels,
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
    title: defaultForm ? creationFormTitle(defaultForm, labels) : roleFallbackTitle('IMAGE_CREATION', labels),
    activityAt,
    previewAssetIds: defaultForm ? creationFormPreviewAssetIds(defaultForm) : [],
  };
}

export interface BuildCreationLibraryProjectionInput extends CreationFormEntitySource {
  labels: CreationFormLabels;
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
  labels,
  ...entitySource
}: BuildCreationLibraryProjectionInput): CreationLibraryProjection {
  const entities = buildCreationFormEntityIndex(entitySource);
  const projectedItems = creationItems.map((item) => projectCreationItem(item, entities, labels));
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
