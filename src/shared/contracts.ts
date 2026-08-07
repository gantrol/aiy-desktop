import type { ResolvedPromptComposition } from '@/shared/prompt-composition';
import type { ExtensionHostEngineKey } from '@/shared/product';
import type {
  LocalSpaceCoverUpdateResult,
  LocalSpaceDescriptorDto,
  LocalSpaceRegistryDto,
  LocalSpaceSwitchResult,
  LocalSpaceTransitionEvent,
} from '@/shared/contracts/local-space';
import type {
  PackCatalogItemDto,
  PackImportLocalResult,
  PackInstallExactInput,
  PackInstallationDto,
  PackReleaseDto,
} from '@/shared/contracts/packs';
import type {
  CreatorImageChooseInput,
  CreatorImageImportInput,
  CreatorImageImportItemInput,
  CreatorImageImportSource,
  CreatorImageStagePreviewRow,
  CreatorStagedImageImportInput,
} from '@/shared/contracts/creator-import';
import type {
  ImportedImageAiGeneratedStatus,
  ImportedImageGenerationTextType,
  ImportedImageMetadataInput,
  ImportedImageRelationshipInput,
} from '@/shared/contracts/import-metadata';

export type {
  LocalSpaceCoverUpdateResult,
  LocalSpaceDescriptorDto,
  LocalSpaceRegistryDto,
  LocalSpaceSwitchResult,
  LocalSpaceTransitionEvent,
  LocalSpaceTransitionStage,
} from '@/shared/contracts/local-space';
export type {
  PackCatalogItemDto,
  PackDependencyDto,
  PackDto,
  PackInstallExactInput,
  PackInstallationDto,
  PackImportLocalResult,
  PackInstallationStateDto,
  PackKindDto,
  PackReleaseDto,
  PackReleaseItemDto,
  PackReleaseSummaryDto,
} from '@/shared/contracts/packs';
export type {
  CreatorImageChooseInput,
  CreatorImageImportContext,
  CreatorImageImportInput,
  CreatorImageImportItemInput,
  CreatorImageImportSource,
  CreatorImageStagePreviewRow,
  CreatorImageStageState,
  CreatorStagedImageImportInput,
} from '@/shared/contracts/creator-import';
export type {
  ImportedImageAiGeneratedStatus,
  ImportedImageGenerationTextType,
  ImportedImageMetadataInput,
  ImportedImageRelationshipInput,
} from '@/shared/contracts/import-metadata';

export type Locale = 'zh' | 'en';
/** BCP 47 language tag used by dictionary content. Unlike the UI locale, this is open-ended. */
export type ContentLocale = string;
export const DEFAULT_TERM_CONTEXT_KEY = 'general.default';
export type EditorialState = 'DRAFT' | 'APPROVED' | 'ARCHIVED';
export type GenerationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
export type GenerationQuality = 'low' | 'medium' | 'high';
/** Operational phases shown only when the application has a real state to report. */
export type GenerationTaskPhase =
  | 'QUEUED'
  | 'PREPARING'
  | 'SUBMITTING'
  | 'UPLOADING'
  | 'WAITING_PROVIDER'
  | 'GENERATING'
  | 'DOWNLOADING'
  | 'FINALIZING'
  | 'SAVING'
  | 'RECOVERING'
  | 'CANCELLING';
export type GenerationRunPhase = GenerationTaskPhase | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
export type AnnotationStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type AnnotationType = 'RECTANGLE' | 'BRUSH';
export type AnnotationBrushStrokeMode = 'ADD' | 'ERASE';

export interface AnnotationBrushPoint {
  x: number;
  y: number;
}

export interface AnnotationBrushStroke {
  mode: AnnotationBrushStrokeMode;
  /** Radius normalized against the image's shorter edge. */
  radius: number;
  points: AnnotationBrushPoint[];
}

export interface AnnotationBrushGeometry {
  version: 1;
  strokes: AnnotationBrushStroke[];
}
export type TermMediaRole = 'COVER' | 'RELATED';
export interface CodexHealth {
  state: 'checking' | 'ready' | 'unavailable';
  version: string;
  authenticated: boolean;
  message: string;
}

export type ExtensionContributionPoint =
  'themes' | 'fields' | 'filters' | 'commands' | 'workflows' | 'tools' | 'searchProviders' | 'modelProviders';

export type ExtensionKind = 'CAPABILITY' | 'LANGUAGE';
export type ExtensionSource = 'BUILT_IN' | 'LOCAL' | 'MARKETPLACE';
export type ExtensionConnectionState =
  'READY' | 'CONNECTING' | 'NEEDS_CONFIGURATION' | 'UNAVAILABLE' | 'DISABLED' | 'PERMISSION_REQUIRED';

export interface ExtensionImageApiEndpointPresetDto {
  id: string;
  /** Complete provider request URL. Templates may reference declared setting fields. */
  endpointTemplate: string;
  modelId: string;
}

export interface ExtensionImageApiSettingFieldDto {
  key: string;
  required: boolean;
  endpointPresetIds: string[];
}

/** Declarative configuration contribution rendered by the host. */
export interface ExtensionImageApiConfigurationDto {
  kind: 'IMAGE_API';
  defaultEndpointPresetId: string;
  endpointPresets: ExtensionImageApiEndpointPresetDto[];
  settingFields: ExtensionImageApiSettingFieldDto[];
  customEndpointAllowed: boolean;
  customModelIdAllowed: boolean;
  /** Presets for which the host can perform a non-generation capability check. */
  connectionCheckPresetIds: string[];
}

export interface ExtensionConfigurationFieldLocalizationDto {
  label: string;
  placeholder: string;
}

export interface ExtensionConfigurationLocalizationDto {
  title: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  endpointLabel: string;
  endpointOptions: Record<string, string>;
  customEndpointLabel: string;
  customEndpointPlaceholder: string;
  modelIdLabel: string;
  modelIdPlaceholder: string;
  fields: Record<string, ExtensionConfigurationFieldLocalizationDto>;
}

export interface ExtensionLocalizationDto {
  displayName: string;
  description: string;
  configuration?: ExtensionConfigurationLocalizationDto;
}

export interface ExtensionI18nDto {
  defaultLocale: Locale;
  locales: Partial<Record<Locale, ExtensionLocalizationDto>>;
}

export interface ExtensionLanguageDto {
  locale: Locale;
  /** BCP 47 language tag applied to the document while this plugin is active. */
  htmlLanguage: string;
  /** Data-only message catalog, relative to the extension directory. */
  catalog?: 'messages.json';
}

export interface ExtensionHostRuntimeDto {
  kind: 'HOST';
  id: string;
}

export interface ExtensionManifestDto {
  manifestVersion: 1;
  kind: ExtensionKind;
  id: string;
  version: string;
  displayName: string;
  description: string;
  engines: Record<ExtensionHostEngineKey, string>;
  contributes: Partial<Record<ExtensionContributionPoint, string[]>>;
  permissions: string[];
  optionalPermissions: string[];
  /** Plugin-owned strings. The host owns only common chrome and status copy. */
  i18n?: ExtensionI18nDto;
  /** Present only for language plugins. The executable catalog remains plugin-owned. */
  language?: ExtensionLanguageDto;
  /** Binds a packaged capability to a runtime explicitly implemented and authorized by the host. */
  runtime?: ExtensionHostRuntimeDto;
  configuration?: ExtensionImageApiConfigurationDto;
}

export interface ExtensionPermissionDto {
  key: string;
  required: boolean;
  granted: boolean;
}

export interface ExtensionDto {
  manifest: ExtensionManifestDto;
  source: ExtensionSource;
  enabled: boolean;
  compatible: boolean;
  effective: boolean;
  connectionState: ExtensionConnectionState;
  connectionMessage: string;
  permissions: ExtensionPermissionDto[];
  installedAt: string;
  updatedAt: string;
}

export interface ExtensionLanguagePackDto {
  extensionId: string;
  locale: Locale;
  htmlLanguage: string;
  messages: Record<string, unknown>;
}

export interface ExtensionSetEnabledInput {
  extensionId: string;
  enabled: boolean;
}

export interface ExtensionSetPermissionInput {
  extensionId: string;
  permission: string;
  granted: boolean;
}

export interface ExtensionInstallLocalResult {
  extensionId: string | null;
  extensions: ExtensionDto[];
}

export interface CodexGeneratedImageDto {
  id: string;
  sha256: string;
  threadId: string;
  threadName: string;
  /** False when Codex no longer exposes a resolvable title for the source task. */
  threadTitleAvailable: boolean;
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  createdAt: string;
  modifiedAt: string;
  mediaUrl: string;
  importable: boolean;
  /** True when the exact SHA-256 already exists in the active local space. */
  imported: boolean;
  importedSeriesId: string | null;
  importedAssetId: string | null;
}

export type CodexImageDiscoveryFilter = 'NOT_IN_LIBRARY' | 'IN_LIBRARY' | 'ALL';

export interface CodexImageDiscoverySnapshotDto {
  available: boolean;
  rootPath: string;
  scannedAt: string;
  filter: CodexImageDiscoveryFilter;
  includeUntitled: boolean;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Source files visible under the current untitled-task setting, before hash deduplication. */
  fileCount: number;
  duplicateCount: number;
  /** Unique SHA-256 values visible under the current untitled-task setting. */
  totalCount: number;
  /** Unique SHA-256 values matching the requested filter. */
  filteredCount: number;
  /** Unique SHA-256 values already present in the active local space. */
  inLibraryCount: number;
  unimportedCount: number;
  /** Source tasks whose titles can no longer be resolved. These are hidden by default. */
  untitledThreadCount: number;
  images: CodexGeneratedImageDto[];
}

export interface CodexImageDiscoveryListInput {
  filter: CodexImageDiscoveryFilter;
  includeUntitled?: boolean;
  page: number;
  pageSize: number;
  refresh?: boolean;
}

export interface CodexGeneratedImageImportInput {
  discoveryIds: string[];
}

export interface CodexGeneratedImageImportResult {
  threadId: string;
  threadName: string;
  seriesId: string;
  versionId: string;
  assetIds: string[];
  importedCount: number;
  duplicateCount: number;
}

export type OpenAiImageApiConnectionStatus = 'NOT_CONFIGURED' | 'UNVERIFIED' | 'READY' | 'ERROR';
export type OpenAiImageModeration = 'auto' | 'low';

export interface OpenAiImageApiConnectionDto {
  configured: boolean;
  status: OpenAiImageApiConnectionStatus;
  message: string;
  apiKeyHint: string | null;
  organizationId: string;
  projectId: string;
  moderation: OpenAiImageModeration;
  updatedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface OpenAiImageApiSaveInput {
  /** Blank preserves the currently stored key. A new connection requires a key. */
  apiKey: string;
  organizationId: string;
  projectId: string;
  moderation: OpenAiImageModeration;
}

export type DeepSeekApiConnectionStatus = OpenAiImageApiConnectionStatus;

export interface DeepSeekApiConnectionDto {
  configured: boolean;
  status: DeepSeekApiConnectionStatus;
  message: string;
  apiKeyHint: string | null;
  modelId: string;
  updatedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface DeepSeekApiSaveInput {
  /** Blank preserves the currently stored key. A new connection requires a key. */
  apiKey: string;
}

export type AssistantOperation = 'directions' | 'optimize' | 'title';
export type AssistantWebSearchMode = 'DISABLED' | 'REQUIRED';
export type AssistantModelKind = 'TEXT' | 'AGENT';
export type AssistantModelState = 'READY' | 'UNAVAILABLE';
export type AssistantModelSelectionMode = 'FIXED' | 'CATALOG';
export type AssistantReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface AssistantModelOptionDto {
  key: string;
  name: string;
  isDefault: boolean;
  defaultReasoningEffort: AssistantReasoningEffort | null;
  supportedReasoningEfforts: AssistantReasoningEffort[];
}

export interface AssistantModelRouteDto {
  key: string;
  providerKey: string;
  modelKey: string;
  extensionId: string;
  name: string;
  kind: AssistantModelKind;
  supportedOperations: AssistantOperation[];
  modelSelectionMode: AssistantModelSelectionMode;
  reasoningEffort: AssistantReasoningEffort | null;
  modelOptions: AssistantModelOptionDto[];
  state: AssistantModelState;
  availabilityReason: string | null;
}

export interface AssistantRoutingSelection {
  routeKey: string;
  modelKey: string | null;
  reasoningEffort: AssistantReasoningEffort | null;
}

export interface AssistantRoutingSelections {
  directions: AssistantRoutingSelection;
  optimize: AssistantRoutingSelection;
  title: AssistantRoutingSelection;
}

export interface AssistantRoutingDto {
  selections: AssistantRoutingSelections;
  models: AssistantModelRouteDto[];
  updatedAt: string | null;
}

export interface AssistantRoutingSaveInput {
  selections: AssistantRoutingSelections;
}

export interface CodexTextModelDto {
  key: string;
  name: string;
  isDefault: boolean;
  defaultReasoningEffort: AssistantReasoningEffort | null;
  supportedReasoningEfforts: AssistantReasoningEffort[];
}

export type ExternalImageApiConnectionStatus = OpenAiImageApiConnectionStatus;

export interface ExternalImageApiConnectionDto {
  extensionId: string;
  configured: boolean;
  status: ExternalImageApiConnectionStatus;
  message: string;
  apiKeyHint: string | null;
  settings: Record<string, string>;
  updatedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface ExternalImageApiSaveInput {
  extensionId: string;
  /** Blank preserves the currently stored key. A new connection requires a key. */
  apiKey: string;
  settings: Record<string, string>;
}

export type ImageGenerationRouteState = 'READY' | 'UNAVAILABLE';
export type ImageGenerationRouteReleaseStage = 'STABLE' | 'PREVIEW' | 'INTERNAL';
export type ImageGenerationRouteQualityMode = 'SELECTABLE' | 'PROVIDER_MANAGED';
export type ImageGenerationRouteCapability =
  'GENERATE' | 'REFERENCE_IMAGE' | 'MULTI_REFERENCE' | 'IMAGE_EDIT' | 'MASK_EDIT' | 'TRANSPARENT_BACKGROUND';

export interface ImageGenerationRouteDto {
  key: string;
  name: string;
  provider: string;
  providerKey: string;
  modelId: string;
  state: ImageGenerationRouteState;
  availabilityReason: string | null;
  releaseStage: ImageGenerationRouteReleaseStage;
  internal: boolean;
  maxReferenceImages: number | null;
  capabilities: ImageGenerationRouteCapability[];
  qualityMode: ImageGenerationRouteQualityMode;
  supportedQualities: GenerationQuality[];
}

/** @deprecated Use ImageGenerationRouteDto. This descriptor is an executable route, not a provenance model. */
export type GenerationModelDto = ImageGenerationRouteDto;
/** @deprecated Use ImageGenerationRouteState. */
export type GenerationModelState = ImageGenerationRouteState;
/** @deprecated Use ImageGenerationRouteReleaseStage. */
export type GenerationModelReleaseStage = ImageGenerationRouteReleaseStage;
/** @deprecated Use ImageGenerationRouteQualityMode. */
export type GenerationModelQualityMode = ImageGenerationRouteQualityMode;
/** @deprecated Use ImageGenerationRouteCapability. */
export type GenerationModelCapability = ImageGenerationRouteCapability;

export interface FacetValueDto {
  id: string;
  stableKey: string;
  name: string;
  count: number;
}

export type FacetSystemRole = 'PRIMARY_CLASSIFICATION' | 'SECONDARY_CLASSIFICATION';

export interface FacetDefinitionDto {
  id: string;
  stableKey: string;
  systemRole: FacetSystemRole | null;
  name: string;
  values: FacetValueDto[];
}

export interface TermMetrics {
  citationCount: number;
  distinctPromptSeries: number;
  positiveEvidence: number;
  negativeEvidence: number;
  pendingIssues: number;
  lastValidatedAt: string | null;
}

export interface TermModelExpressionDto {
  id: string;
  contextKey: string;
  modelKey: string;
  locale: ContentLocale;
  positive: string;
  negative: string;
}

export interface TermLocalizationDto {
  locale: ContentLocale;
  title: string;
  definition: string;
  aliases: string[];
}

export interface LocalizedTitleDto {
  locale: ContentLocale;
  title: string;
}

export interface LocalizedNameDto {
  locale: ContentLocale;
  name: string;
}

export interface TermCategoryDto {
  id: string;
  stableKey: string;
  name: string;
  primaryValueId: string;
  primaryName: string;
  secondaryValueId: string | null;
  secondaryName: string | null;
  parentId?: string | null;
  path?: string;
  state?: DictionaryClassificationState;
  selectable?: boolean;
}

export type DictionaryClassificationState = 'ACTIVE' | 'DISABLED';
export type DictionaryClassificationSource = 'CONTENT_PACK' | 'LOCAL';

export interface DictionaryClassificationLocalizationDto {
  locale: ContentLocale;
  name: string;
}

export interface DictionaryClassificationSourceSnapshotDto {
  parentId: string | null;
  name: string;
  nameLocale: ContentLocale;
  localizations: DictionaryClassificationLocalizationDto[];
  sortOrder: number;
  state: DictionaryClassificationState;
  primaryFacetValueId: string;
  secondaryFacetValueId: string | null;
}

export interface DictionaryClassificationNodeDto {
  id: string;
  stableKey: string;
  parentId: string | null;
  name: string;
  nameLocale: ContentLocale;
  localizations: DictionaryClassificationLocalizationDto[];
  path: string;
  depth: number;
  sortOrder: number;
  state: DictionaryClassificationState;
  sourceType: DictionaryClassificationSource;
  modifiedLocally: boolean;
  sourceSnapshot: DictionaryClassificationSourceSnapshotDto | null;
  directTermCount: number;
  subtreeTermCount: number;
  childCount: number;
}

export interface DictionaryClassificationTreeDto {
  nodes: DictionaryClassificationNodeDto[];
  rootCount: number;
  categoryCount: number;
  termCount: number;
}

export interface DictionaryClassificationCreateInput {
  parentId: string | null;
  name: string;
  nameLocale: ContentLocale;
  localizations: DictionaryClassificationLocalizationDto[];
  locale: Locale;
}

export interface DictionaryClassificationUpdateInput {
  id: string;
  name: string;
  nameLocale: ContentLocale;
  localizations: DictionaryClassificationLocalizationDto[];
  locale: Locale;
}

export interface DictionaryClassificationRestoreSourceInput {
  id: string;
  locale: Locale;
}

export interface DictionaryClassificationMoveInput {
  id: string;
  parentId: string | null;
  locale: Locale;
}

export interface DictionaryClassificationMovePreviewDto {
  classificationId: string;
  classificationName: string;
  currentPath: string;
  targetParentId: string | null;
  targetPath: string;
  childClassificationCount: number;
  termCount: number;
}

export interface DictionaryClassificationReorderInput {
  parentId: string | null;
  orderedIds: string[];
  locale: Locale;
}

export interface DictionaryClassificationSetStateInput {
  id: string;
  state: DictionaryClassificationState;
  includeDescendants?: boolean;
  locale: Locale;
}

export interface DictionaryClassificationMergeInput {
  sourceId: string;
  targetId: string;
  conflictResolutions?: DictionaryClassificationMergeConflictResolutionDto[];
  locale: Locale;
}

export type DictionaryClassificationMergeConflictAction = 'KEEP_BOTH' | 'RENAME' | 'MERGE';

export interface DictionaryClassificationMergeConflictResolutionDto {
  sourceChildId: string;
  targetChildId: string;
  action: DictionaryClassificationMergeConflictAction;
  renamedName?: string;
}

export interface DictionaryClassificationMergeConflictDto {
  sourceChildId: string;
  sourceName: string;
  targetChildId: string;
  targetName: string;
}

export interface DictionaryClassificationMergePreviewDto {
  sourceId: string;
  sourcePath: string;
  targetId: string;
  targetPath: string;
  directTermCount: number;
  childClassificationCount: number;
  conflicts: DictionaryClassificationMergeConflictDto[];
}

export interface DictionaryClassificationTermDto {
  id: string;
  title: string;
  editorialState: EditorialState;
  classificationIds: string[];
  classificationPaths: string[];
}

export interface DictionaryClassificationTermsInput {
  classificationId: string;
  includeDescendants: boolean;
  locale: Locale;
  query: string;
  limit: number;
}

export interface DictionaryClassificationTermsDto {
  items: DictionaryClassificationTermDto[];
  total: number;
}

export interface TermListItem {
  id: string;
  /** Stable source identity. It is system-managed and is never an editor field. */
  stableKey: string;
  title: string;
  titleLocale: ContentLocale;
  definition: string;
  aliases: string[];
  localizations: TermLocalizationDto[];
  editorialState: EditorialState;
  revisionNo: number;
  termRevisionId: string;
  modelExpressions: TermModelExpressionDto[];
  classificationIds: string[];
  classifications: TermCategoryDto[];
  primaryDirectoryClassificationId: string | null;
  hasDraft: boolean;
  mediaPreview: TermMediaPreviewDto;
  metrics: TermMetrics;
}

export interface TermEditorDto extends TermListItem {
  expressions: Array<Omit<TermModelExpressionDto, 'id'>>;
  media: TermMediaItemDto[];
  draftUpdatedAt: string | null;
}

export interface TermDraftInput {
  termId: string;
  title: string;
  titleLocale: ContentLocale;
  definition: string;
  aliases: string[];
  localizations: TermLocalizationDto[];
  classificationIds: string[];
  primaryDirectoryClassificationId: string | null;
  expressions: Array<Omit<TermModelExpressionDto, 'id'>>;
}

export interface DictionarySaveDraftInput {
  draft: TermDraftInput;
  locale: Locale;
}

export interface NewTermInput {
  title: string;
  titleLocale: ContentLocale;
  uiLocale: Locale;
  classificationId?: string | null;
}

export interface AssetDto {
  id: string;
  kind: 'GENERATED' | 'REFERENCE';
  originType?: string;
  width: number;
  height: number;
  mimeType: string;
  byteSize?: number;
  mediaUrl: string;
  createdAt: string;
}

export interface AssetFileAvailabilityDto {
  available: boolean;
}

export interface AssetFileSaveResult {
  status: 'saved' | 'cancelled';
}

export type AssetFileRevealContext =
  | { kind: 'ALL_MATERIALS' }
  | { kind: 'DICTIONARY' }
  | { kind: 'ALBUM'; albumId: string }
  | { kind: 'CREATION'; seriesId: string }
  | { kind: 'TERM'; termId: string };

export type AssetFileRevealTargetContext = Extract<AssetFileRevealContext, { kind: 'ALL_MATERIALS' | 'DICTIONARY' }>;

export interface AssetFileRevealTargetDto {
  context: Extract<AssetFileRevealContext, { kind: 'ALBUM' | 'TERM' }>;
  label: string;
  relativeDirectory: string;
}

export interface ImageRatingDto {
  id: string;
  imageAssetId: string;
  dimension: ImageRatingDimension;
  score: number;
  updatedAt: string;
}

export type ImageRatingDimension = 'AESTHETIC' | 'REALISM';

export type GallerySourceFilter = 'ALL' | 'LIBRARY' | 'FAVORITE' | 'CREATION' | 'DICTIONARY' | 'MATERIAL' | 'IMPORT';
export type GalleryItemSource = 'FAVORITE' | 'CREATION' | 'DICTIONARY' | 'BOTH' | 'MATERIAL';
export type CreationMaterialRole = 'INPUT' | 'SOURCE' | 'OUTPUT';
export type CreationRelationFilter = 'ALL' | 'INPUT' | 'OUTPUT';

export interface GalleryDictionaryFilter {
  facetValueIds?: string[];
  missingFacetSystemRoles?: FacetSystemRole[];
  termId?: string;
  packReleaseIds?: string[];
  includeLocalTerms?: boolean;
}

export interface GalleryListInput {
  locale: Locale;
  source: GallerySourceFilter;
  /** Orthogonal to source so scoped collections can expose their own favorites. */
  favoriteOnly?: boolean;
  /** Narrows DICTIONARY to one classification path or term. */
  dictionary?: GalleryDictionaryFilter;
  query?: string;
  assetKinds?: AssetDto['kind'][];
  albumId?: string;
  /** Narrows a virtual creation node to its current inputs/sources or outputs. */
  creationRelation?: CreationRelationFilter;
  unratedDimensions: ImageRatingDimension[];
  cursor: string | null;
  limit: number;
}

export interface GalleryItemDto {
  id: string;
  materialId: string | null;
  source: GalleryItemSource;
  createdAt: string;
  asset: AssetDto;
  creation: {
    runId: string | null;
    importedOutputId: string | null;
    seriesId: string;
    seriesTitle: string;
    versionNo: number | null;
    roles: CreationMaterialRole[];
  } | null;
  dictionary: {
    termId: string;
    termName: string;
    additionalTermCount: number;
  } | null;
  favorite: {
    materialId: string;
    createdAt: string;
  } | null;
  metadata: ExternalMaterialMetadataDto | null;
  ratings: {
    aesthetic: ImageRatingDto | null;
    realism: ImageRatingDto | null;
  };
}

export interface ExternalMaterialMetadataDto {
  materialId: string;
  originalName: string;
  displayName: string;
  note: string;
  sourceUrl: string;
  aiGeneratedStatus: ImportedImageAiGeneratedStatus;
  /** Set only while the name still matches a runtime generation model. */
  modelKey: string | null;
  /** Free-text model name — a model is not the same thing as a runtime route. */
  modelName: string;
  /** Platform the model was reached through, e.g. an official API or OpenRouter. */
  modelProvider: string;
  modelVersion: string;
  generationTextType: ImportedImageGenerationTextType;
  generationText: string;
  provenanceConfidence: 'DECLARED' | 'UNKNOWN';
  updatedAt: string;
}

export interface ExternalMaterialMetadataUpdateInput {
  materialId: string;
  displayName: string;
  note: string;
  sourceUrl: string;
  aiGeneratedStatus: ExternalMaterialMetadataDto['aiGeneratedStatus'];
  modelKey: string | null;
  modelName: string;
  modelProvider: string;
  modelVersion: string;
  generationTextType: ExternalMaterialMetadataDto['generationTextType'];
  generationText: string;
}

/** Library history and current runtime values offered as editable combobox suggestions. */
export interface MaterialProvenanceSuggestionsDto {
  modelNames: string[];
  modelProviders: string[];
}

export interface GalleryPageDto {
  items: GalleryItemDto[];
  total: number;
  nextCursor: string | null;
}

export interface AssetRelationshipPackIdentityDto {
  packId: string;
  packDisplayName: string;
  packReleaseId: string;
  packReleaseVersion: string;
}

export interface AssetRelationshipPackReleaseItemDto {
  id: string;
  itemKey: string;
  objectType: string;
  objectRevisionId: string;
}

export interface AssetDirectPackSourceDto {
  id: string;
  pack: AssetRelationshipPackIdentityDto;
  releaseItem: AssetRelationshipPackReleaseItemDto;
  localObjectType: string;
  localObjectId: string;
  localRevisionId: string;
  mappingKind: 'INSTALLED_NEW' | 'REUSED_IDENTICAL' | 'MANUALLY_MAPPED' | 'RETAINED_HISTORY';
}

export interface AssetRelationshipTermUseDto {
  termId: string;
  termRevisionId: string;
  title: string;
  titleLocale: ContentLocale;
  localizations: LocalizedTitleDto[];
}

export interface AssetRelationshipRecipeUseDto {
  useId: string;
  paletteId: string;
  paletteRevisionId: string;
  name: string;
  nameLocale: ContentLocale;
  localizations: LocalizedNameDto[];
  parameterValues: Record<string, string>;
}

export interface AssetCreationInputPackUseDto {
  pack: AssetRelationshipPackIdentityDto;
  releaseItems: AssetRelationshipPackReleaseItemDto[];
  viaDirectTerms: AssetRelationshipTermUseDto[];
  /** Recipe uses stay aggregate objects; nested recipe terms are not projected here. */
  viaRecipes: Array<
    AssetRelationshipRecipeUseDto & {
      sourceKinds: Array<'RECIPE' | 'NESTED_TERM'>;
    }
  >;
  viaReferences: Array<{
    assetId: string;
    role: 'DIRECT_REFERENCE' | 'RECIPE_REFERENCE';
    recipeUseId: string | null;
  }>;
}

export interface AssetCreationRelationshipDto {
  kind: 'GENERATION_RUN' | 'IMPORTED_OUTPUT';
  runId: string | null;
  importedOutputId: string | null;
  series: {
    id: string;
    title: string;
    deletedAt: string | null;
  };
  promptVersion: {
    id: string;
    versionNo: number;
    userInstruction: string;
    promptInputSnapshotId: string;
  } | null;
  modelKey: string | null;
  runStatus: GenerationStatus | null;
  directTerms: AssetRelationshipTermUseDto[];
  recipes: AssetRelationshipRecipeUseDto[];
  inputPackSources: AssetCreationInputPackUseDto[];
  createdAt: string;
  deletedAt: string | null;
}

export interface AssetTermRelationshipDto {
  kind: 'EVIDENCE' | 'MEDIA';
  id: string;
  termId: string;
  currentTermRevisionId: string | null;
  title: string;
  titleLocale: ContentLocale;
  localizations: LocalizedTitleDto[];
  verdict: string | null;
  note: string;
  mediaRole: TermMediaRole | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface AssetRelationshipDto {
  assetId: string;
  creations: AssetCreationRelationshipDto[];
  termRelationships: AssetTermRelationshipDto[];
  /** Sources that directly provide this asset/material object. */
  directPackSources: AssetDirectPackSourceDto[];
}

export interface FavoriteTextMaterialDto {
  id: string;
  text: string;
  createdAt: string;
  favoritedAt: string;
}

export interface FavoriteAddResult {
  materialId: string;
  createdAt: string;
  created: boolean;
}

export interface TermMediaItemDto {
  id: string;
  role: TermMediaRole;
  sortOrder: number;
  focalX: number;
  focalY: number;
  asset: AssetDto;
}

export interface TermMediaPreviewDto {
  totalCount: number;
  items: TermMediaItemDto[];
}

export interface AddTermMediaInput {
  termId: string;
  assetIds: string[];
}

export interface ReorderTermMediaInput {
  termId: string;
  mediaIds: string[];
}

export interface AnnotationDto {
  id: string;
  imageAssetId: string;
  type: AnnotationType;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  geometry: AnnotationBrushGeometry | null;
  comment: string;
  status: AnnotationStatus;
  createdAt: string;
}

export interface PromptPackSourceReferenceDto {
  packId: string;
  packReleaseId: string;
  packReleaseItemId: string;
}

export interface PromptCommonTermReferenceDto {
  termId: string;
  termRevisionId: string;
  /** Direct terms may override the snapshot-wide Prompt language. */
  promptLocale?: Locale;
  packSources?: PromptPackSourceReferenceDto[];
}

export interface PromptCommonParameterReferenceDto {
  parameterRevisionId: string;
  stableKey: string;
  optionId: string;
  valueKey: string;
}

export type PromptCommonRecipeContentDto =
  | {
      id: string;
      kind: 'TEXT';
      promptFragment: string;
      negativeFragment: string;
    }
  | {
      id: string;
      kind: 'TERM';
      term: PromptCommonTermReferenceDto;
    };

export type PromptCommonRecipeNodeDto =
  | PromptCommonRecipeContentDto
  | {
      id: string;
      kind: 'SLOT';
      stableKey: string;
      parameter: PromptCommonParameterReferenceDto | null;
      contents: PromptCommonRecipeContentDto[];
    };

export interface PromptCommonAssetReferenceDto {
  assetId: string;
  contentHash: string;
  role: 'DIRECT_REFERENCE' | 'RECIPE_REFERENCE';
  packSources?: PromptPackSourceReferenceDto[];
}

export interface PromptCommonRecipeReferenceDto {
  useId: string;
  paletteId: string;
  paletteRevisionId: string;
  /** Immutable revision labels frozen for historical display. */
  name: string;
  nameLocale: ContentLocale;
  localizations: LocalizedNameDto[];
  promptLocale: Locale;
  parameterValues: Record<string, string>;
  terms: PromptCommonTermReferenceDto[];
  parameters: PromptCommonParameterReferenceDto[];
  contentNodes: PromptCommonRecipeNodeDto[];
  references: PromptCommonAssetReferenceDto[];
  packSources?: PromptPackSourceReferenceDto[];
}

export type PromptCommonContentNodeDto =
  { kind: 'TEXT'; text: string } | { kind: 'TERM'; termId: string } | { kind: 'RECIPE'; useId: string };

/** Model-neutral input frozen on a PromptVersion. */
export interface PromptCommonInputDto {
  userInstruction: string;
  directTermPromptLocale: Locale;
  directTerms: PromptCommonTermReferenceDto[];
  recipes: PromptCommonRecipeReferenceDto[];
  directReferences: PromptCommonAssetReferenceDto[];
  /** Ordered creator-composer content. Omitted by pre-composer snapshots. */
  contentNodes?: PromptCommonContentNodeDto[];
  /** Present when this snapshot freezes an already-composed Prompt. */
  flatPrompt?: string;
  flatNegativePrompt?: string;
  flatResolvedPrompt?: {
    commonExpression: string;
    negativeExpression: string;
  };
}

export interface PromptInputSnapshotDto {
  id: string;
  sourceKind: 'COMPOSED' | 'FLAT_INPUT';
  commonInput: PromptCommonInputDto;
  contentHash: string;
  createdAt: string;
}

export interface ImageGenerationRouteSnapshotDto {
  id: string;
  descriptor: ImageGenerationRouteDto;
  contentHash: string;
  createdAt: string;
}

/** @deprecated Use ImageGenerationRouteSnapshotDto. */
export type GenerationModelSnapshotDto = ImageGenerationRouteSnapshotDto;

export type GenerationExecutionRoute = 'CODEX_CLI' | 'PROVIDER_ADAPTER' | 'INTERNAL_REPLAY' | 'MODEL_INPUT';

export interface GenerationExecutionCommonInputDto {
  promptInput: PromptCommonInputDto;
  resolvedPrompt: ResolvedPromptComposition;
  referenceAssetIds: string[];
  canvasPresetKey: string | null;
  width: number | null;
  height: number | null;
  quality: GenerationQuality;
}

export interface ExecutionInputSnapshotDto {
  id: string;
  route: GenerationExecutionRoute;
  requestSchema: string;
  commonInput: GenerationExecutionCommonInputDto;
  actualRequest: Record<string, unknown>;
  /** Audit text for the transport request; use commonInput.resolvedPrompt for user-visible Prompt behavior. */
  clientRequestText: string | null;
  contentHash: string;
  createdAt: string;
}

export interface ProviderReturnedDescriptionInput {
  fieldName: string;
  rawValue: string;
  interpretation?: string | null;
  scopeKind?: 'RUN' | 'OUTPUT';
  outputOrdinal?: number | null;
}

export interface ProviderReturnedDescriptionDto {
  id: string;
  fieldName: string;
  rawValue: string;
  interpretation: string | null;
  scopeKind: 'RUN' | 'OUTPUT';
  outputOrdinal: number | null;
  contentHash: string;
  receivedAt: string;
}

export interface CodexTaskReferenceDto {
  threadId: string;
  threadName: string;
}

export type GenerationOutputDisposition = 'VISIBLE' | 'FAILED';

export interface GenerationErrorDetailsDto {
  retryable: boolean;
  providerCode: string | null;
  metadata: Record<string, unknown>;
}

export interface GenerationRunDto {
  id: string;
  modelKey: string;
  status: GenerationStatus;
  /** Synthetic comparison runs may omit this and are treated as VISIBLE. */
  outputDisposition?: GenerationOutputDisposition;
  phase?: GenerationRunPhase;
  progress?: number | null;
  providerRequestId?: string | null;
  retryOfRunId?: string | null;
  errorCode?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  canvasPresetKey: string | null;
  width: number | null;
  height: number | null;
  quality: GenerationQuality;
  asset: AssetDto | null;
  derivation: GenerationAssetDerivationDto | null;
  errorMessage: string | null;
  errorDetails?: GenerationErrorDetailsDto | null;
  createdAt: string;
  modelSnapshot?: ImageGenerationRouteSnapshotDto | null;
  executionInputSnapshot?: ExecutionInputSnapshotDto | null;
  providerReturnedDescriptions?: ProviderReturnedDescriptionDto[];
  /** Present only after a Codex-backed run has created its persistent Codex task. */
  codexTask?: CodexTaskReferenceDto | null;
}

export interface GenerationOutputSetFailedInput {
  runId: string;
  failed: boolean;
}

export interface GenerationAssetDerivationDto {
  sourceAssetId: string;
  relationType: string;
}

export interface GenerationTaskDto {
  runId: string;
  seriesId: string;
  versionId: string;
  modelKey: string;
  /** Present when multiple runs were submitted as one user-visible batch. */
  batchId?: string | null;
  batchPosition?: number | null;
  batchTotal?: number | null;
  batchModelKeys?: string[];
  status: Extract<GenerationStatus, 'QUEUED' | 'RUNNING'>;
  phase: GenerationTaskPhase;
  progress: number | null;
  queuePosition: number | null;
  submittedAt: string;
  startedAt: string | null;
  updatedAt: string;
}

export interface GenerationChangedEvent {
  runId: string;
  tasks: GenerationTaskDto[];
  terminal: boolean;
}

export interface ModelWorkerStatusDto {
  state: 'CONNECTED' | 'RECONNECTING';
  workerId: string | null;
  generationTaskCount: number;
  codexTaskCount: number;
}

export interface PromptVersionDto {
  id: string;
  parentVersionId?: string | null;
  /** Frozen edit source for image-edit versions; null for ordinary generations. */
  sourceImageId?: string | null;
  versionNo: number;
  manualPrompt: string;
  finalPrompt: string;
  isStructured: boolean;
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
  referenceAssets: AssetDto[];
  changeSummary: string;
  createdAt: string;
  runs: GenerationRunDto[];
  promptInputSnapshot: PromptInputSnapshotDto;
}

export interface PromptSeriesDto {
  id: string;
  title: string;
  currentVersionId: string | null;
  versions: PromptVersionDto[];
  importedOutputs?: ImportedCreationOutputDto[];
  transformedOutputs?: ImageTransformOutputDto[];
  cover: AssetDto | null;
  /** Explicit order while this series is shown at the creation sidebar root. */
  creatorRootSortOrder?: number | null;
}

export type ImageTransformKind = 'CROP';

export interface ImageTransformOutputDto {
  id: string;
  kind: ImageTransformKind;
  seriesId: string;
  sourceAssetId: string;
  ratioWidth: number;
  ratioHeight: number;
  asset: AssetDto;
  createdAt: string;
}

export interface ImageCropInput {
  seriesId: string;
  sourceAssetId: string;
  ratioWidth: number;
  ratioHeight: number;
}

export type NewExternalCreationSourceKind = 'EXTERNAL_IMPORT' | 'MANUAL_PROMPT';

export type NewExternalCreationPromptInput = { knowledge: 'UNKNOWN' } | { knowledge: 'EXACT'; text: string };

export interface NewExternalCreationImportInput {
  intent: 'NEW_EXTERNAL_CREATION';
  sourceKind?: NewExternalCreationSourceKind;
  /** Consumes and rehomes this working draft when saving a manual Prompt as V01. */
  creationDraftId?: string | null;
  albumId?: string | null;
  title: string;
  prompt: NewExternalCreationPromptInput;
  source?: CreatorImageImportSource;
  sourceUrl?: string;
  /** May be empty for a text-only MANUAL_PROMPT creation. */
  outputs: CreatorImageImportItemInput[];
}

export interface ImportedCreationOutputDto {
  id: string;
  batchId: string;
  seriesId: string;
  promptVersionId: string | null;
  imageAssetId: string;
  sourceType: CreatorImageImportSource;
  originalName: string;
  displayName: string;
  note: string;
  sourceUrl: string;
  aiGeneratedStatus: 'YES' | 'NO' | 'UNKNOWN' | 'OTHER';
  comparisonRole: 'MODEL' | 'UNKNOWN' | 'ACTUAL';
  modelKey: string | null;
  modelName: string;
  modelProvider: string;
  modelVersion: string;
  generationTextType: 'EXACT_PROMPT' | 'DESCRIPTION' | 'RECONSTRUCTION' | 'UNKNOWN';
  generationText: string;
  provenanceConfidence: 'VERIFIED' | 'DECLARED' | 'INFERRED' | 'UNKNOWN';
  /** Durable source task for outputs imported through Codex image discovery. */
  codexTask?: CodexTaskReferenceDto | null;
  createdAt: string;
  asset: AssetDto;
}

export interface CreatorOutputsImportResult {
  seriesId: string;
  assetIds: string[];
  importedOutputs: ImportedCreationOutputDto[];
  duplicateCount: number;
}

export interface NewExternalCreationImportResult extends CreatorOutputsImportResult {
  versionId: string;
  albumId: string | null;
}

export interface ImportedCreationOutputUpdateInput {
  outputId: string;
  promptVersionId: string | null;
  displayName: string;
  note: string;
  sourceUrl: string;
  aiGeneratedStatus: ImportedCreationOutputDto['aiGeneratedStatus'];
  comparisonRole: ImportedCreationOutputDto['comparisonRole'];
  modelKey: string | null;
  modelName: string;
  modelProvider: string;
  modelVersion: string;
  generationTextType: ImportedCreationOutputDto['generationTextType'];
  generationText: string;
}

export interface CreationGroupDto {
  id: string;
  title: string;
  items: Array<{ id: string; targetType: 'ALBUM' | 'PROMPT_SERIES'; targetId: string }>;
}

export interface RenameCreationGroupInput {
  creationGroupId: string;
  title: string;
}

export type AlbumMemberTargetType = 'MATERIAL' | 'SERIES' | 'ALBUM';

export interface AlbumMemberDto {
  id: string;
  albumId: string;
  targetType: AlbumMemberTargetType;
  targetId: string;
  sortOrder: number;
  imageAsset: AssetDto | null;
  materialText: string | null;
  seriesTitle: string | null;
  childAlbumTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlbumDto {
  id: string;
  title: string;
  intent: string;
  creationDefaults: AlbumCreationDefaultsDto;
  pinned: boolean;
  materialCount: number;
  seriesCount: number;
  previewAssets: AssetDto[];
  createdAt: string;
  updatedAt: string;
  /** Latest content activity in this album or any descendant. */
  activityAt: string;
  archivedAt: string | null;
  creatorRootSortOrder?: number | null;
  galleryRootSortOrder?: number | null;
  members: AlbumMemberDto[];
}

export interface AlbumCreateInput {
  title: string;
  intent?: string;
  parentAlbumId?: string | null;
}

export interface AlbumDictionarySourceDto {
  packId: string;
  packReleaseId: string;
}

export interface CreationDictionaryScopeDto {
  mode: 'ALL' | 'SELECTED';
  sources: AlbumDictionarySourceDto[];
  includeLocalTerms: boolean;
}

export interface AlbumCreationDefaultsDto {
  schemaVersion: 1;
  recipes: WordPaletteReferenceInput[];
  dictionaryScope: CreationDictionaryScopeDto;
}

export interface AlbumCreationDefaultsUpdateInput {
  albumId: string;
  defaults: AlbumCreationDefaultsDto;
}

export interface AlbumRenameInput {
  albumId: string;
  title: string;
}

export interface AlbumAddMembersInput {
  albumId: string;
  members: Array<{ targetType: AlbumMemberTargetType; targetId: string }>;
}

export interface AlbumRemoveMembersInput {
  albumId: string;
  memberIds: string[];
}

export interface AlbumReorderMembersInput {
  albumId: string;
  memberIds: string[];
}

export interface SidebarRootOrderTargetInput {
  targetType: 'ALBUM' | 'SERIES';
  targetId: string;
}

export interface SidebarRootReorderInput {
  scope: 'CREATOR' | 'GALLERY';
  targets: SidebarRootOrderTargetInput[];
}

export interface AlbumSetPinnedInput {
  albumId: string;
  pinned: boolean;
}

export interface AlbumSetArchivedInput {
  albumId: string;
  archived: boolean;
}

export interface AlbumMoveInput {
  albumId: string;
  parentAlbumId: string | null;
}

export interface AlbumMoveSeriesInput {
  seriesIds: string[];
  albumId: string | null;
}

export type MaterialAlbumKind = 'SYSTEM' | 'USER';
export type MaterialAlbumSystemKey =
  'CREATION_ROOT' | 'CREATION_GROUP' | 'CREATION_UNASSIGNED' | 'CREATION_SERIES' | 'DICTIONARY' | 'DICTIONARY_DOMAIN';

export interface MaterialAlbumMemberDto {
  id: string;
  albumId: string;
  materialId: string;
  kind: 'IMAGE' | 'TEXT';
  imageAsset: AssetDto | null;
  text: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialAlbumDto {
  id: string;
  kind: MaterialAlbumKind;
  systemKey: MaterialAlbumSystemKey | null;
  sourceAlbumId: string | null;
  sourceSeriesId: string | null;
  title: string;
  materialCount: number;
  previewAssets: AssetDto[];
  readOnly: boolean;
  parentId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  members: MaterialAlbumMemberDto[];
}

export type MaterialViewDto = MaterialAlbumDto & {
  kind: 'SYSTEM';
  systemKey: MaterialAlbumSystemKey;
  readOnly: true;
};

export type MaterialCollectionDto = MaterialAlbumDto & {
  kind: 'USER';
  systemKey: null;
  sourceAlbumId: null;
  sourceSeriesId: null;
  readOnly: false;
  parentId: string | null;
};

export type MaterialCollectionSource =
  | { kind: 'MATERIAL_VIEW'; viewId: string }
  | { kind: 'CREATION_GROUP'; creationGroupId: string }
  | { kind: 'PROMPT_SERIES'; seriesId: string };

export type MaterialCollectionSnapshot =
  | {
      kind: 'GALLERY_QUERY';
      query: {
        source: GallerySourceFilter;
        query?: string;
        assetKinds?: AssetDto['kind'][];
        albumId: string;
        unratedDimensions: ImageRatingDimension[];
      };
    }
  | { kind: 'ORDERED_ASSETS'; imageAssetIds: string[] };

export interface CreateMaterialCollectionFromSourceInput {
  source: MaterialCollectionSource;
  snapshot: MaterialCollectionSnapshot;
  title?: string;
  locale: Locale;
}

export interface CreateMaterialCollectionFromSourceResult {
  source: MaterialCollectionSource;
  collection: MaterialCollectionDto;
  capturedMaterialCount: number;
}

export interface MaterialAlbumListInput {
  locale: Locale;
}

export interface MaterialAlbumCreateInput {
  title: string;
  parentAlbumId?: string;
}

export interface MaterialAlbumRenameInput {
  albumId: string;
  title: string;
}

export type MaterialSelectionTargetInput =
  { kind: 'MATERIAL'; materialId: string } | { kind: 'IMAGE_ASSET'; imageAssetId: string };

export interface MaterialAlbumAddManyInput {
  albumId: string;
  targets: MaterialSelectionTargetInput[];
}

export interface MaterialAlbumRemoveInput {
  albumId: string;
  materialIds: string[];
}

export interface AddMaterialsToDestinationsInput {
  targets: MaterialSelectionTargetInput[];
  albumIds: string[];
  termIds: string[];
}

export interface AddMaterialsToDestinationsResult {
  materialIds: string[];
  albumIds: string[];
  termIds: string[];
  addedAlbumMembershipCount: number;
  addedTermMediaCount: number;
  /** Exact post-commit counts let the renderer acknowledge the write without re-reading every album member first. */
  albumMaterialCounts: Record<string, number>;
}

export interface AlbumCreateFromMaterialsInput {
  title: string;
  targets: MaterialSelectionTargetInput[];
}

export interface AlbumCreateFromMaterialsResult {
  album: AlbumDto;
  capturedMaterialCount: number;
}

export interface CanvasPresetDto {
  stableKey: string;
  ratio: string;
  width: number;
  height: number;
  name: string;
  note: string;
  platforms: string[];
}

export interface BootstrapDto {
  locale: Locale;
  spaceName: string;
  spaceCoverUrl: string | null;
  terms: TermListItem[];
  categories: TermCategoryDto[];
  facets: FacetDefinitionDto[];
  wordPalettes: WordPaletteDto[];
  canvasPresets: CanvasPresetDto[];
  series: PromptSeriesDto[];
  albums: AlbumDto[];
  codex: CodexHealth;
  extensions?: ExtensionDto[];
  modelWorker: ModelWorkerStatusDto;
  imageGenerationRoutes: ImageGenerationRouteDto[];
  generationTasks: GenerationTaskDto[];
  assistantRuns: AssistantRunDto[];
  /** Independent creative work containers. PromptSeries remains one possible child element. */
  creations?: CreationDto[];
  styleExplorationBatches: StyleExplorationBatchDto[];
  agentTasks: DirectionExperimentDirectorTaskDto[];
  libraryEmpty: boolean;
  creationDraft: CreationDraftDto | null;
}

export interface CreationDraftDto {
  id: string;
  targetAlbumId: string | null;
  title: string;
  text: string;
  promptNodes?: CreatorPromptNodeInput[];
  referenceAssets: AssetDto[];
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
  dictionaryScope: CreationDictionaryScopeDto;
  canvasPresetKey: string | null;
  quality: GenerationQuality;
  selectedModelKeys: string[];
  repeatCount: number;
  modelTargets: GenerationTargetInput[];
  createdAt: string;
  updatedAt: string;
}

export interface CreationDraftSaveInput {
  id: string | null;
  targetAlbumId?: string | null;
  title: string;
  text: string;
  promptNodes?: CreatorPromptNodeInput[];
  referenceAssetIds: string[];
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
  dictionaryScope?: CreationDictionaryScopeDto;
  canvasPresetKey: string | null;
  quality: GenerationQuality;
  selectedModelKeys: string[];
  repeatCount: number;
  modelTargets?: GenerationTargetInput[];
}

export interface CreationDraftStartInput {
  albumId: string | null;
  termPromptLocale: Locale;
}

export interface CreationInputSnapshotInput {
  schemaVersion: 1;
  title: string;
  manualPrompt: string;
  promptNodes?: CreatorPromptNodeInput[];
  resolvedPrompt: string;
  referenceAssetIds: string[];
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
  dictionaryScope: CreationDictionaryScopeDto;
  canvasPresetKey: string | null;
  generationTargets: GenerationTargetInput[];
}

export interface CreationInputSnapshotDto extends CreationInputSnapshotInput {
  referenceAssets: AssetDto[];
}

export interface CreationInputStashCreateInput {
  scope: CreatorAgentScope;
  snapshot: CreationInputSnapshotInput;
}

export interface CreationInputStashDto {
  id: string;
  scope: CreatorAgentScope;
  revisionNo: number;
  snapshot: CreationInputSnapshotDto;
  contentHash: string;
  createdAt: string;
}

/**
 * What the user wants to happen *after* the material lands in the library.
 * Both intents import; `START_CREATION` additionally opens a creation draft on
 * the imported items. Favoriting and album placement are modifiers, not intents.
 */
export type IntakeCommitIntent = 'IMPORT' | 'START_CREATION';
export type IntakeCommitSource = 'PASTE' | 'DROP' | 'UPLOAD';
export type IntakeImageMimeType = CreatorImageImportItemInput['mimeType'] | 'image/gif';
export type IntakeVideoMimeType = 'video/mp4' | 'video/webm' | 'video/quicktime';
export type IntakeMediaMimeType = IntakeImageMimeType | IntakeVideoMimeType;

export type IntakeCommitItemInput =
  | { id: string; kind: 'TEXT'; text: string }
  | {
      id: string;
      kind: 'IMAGE';
      name: string;
      mimeType: IntakeMediaMimeType;
      width?: number;
      height?: number;
      bytes: Uint8Array;
      sourceUrl?: string;
      metadata?: ImportedImageMetadataInput;
      relationship?: ImportedImageRelationshipInput | null;
    };

export interface IntakeCommitInput {
  intent: IntakeCommitIntent;
  source: IntakeCommitSource;
  items: IntakeCommitItemInput[];
  /** Also mark every imported material as a favorite. */
  favorite?: boolean;
  /** Album that receives the imported materials, when the user imports from one. */
  albumId?: string | null;
}

export interface IntakeCommitResult {
  intent: IntakeCommitIntent;
  draft: CreationDraftDto | null;
  favoriteCount: number;
  materialIds: string[];
  imageMaterialIds: string[];
  /** Imported-output relationships created or updated by this review batch. */
  linkedOutputs: ImportedCreationOutputDto[];
  /** Album the materials were filed into, echoed back for post-import feedback. */
  albumId: string | null;
}

export interface DictionarySearchInput {
  locale: Locale;
  query: string;
  facetValueIds: string[];
  /** Semantic facet roles for which matching terms must have no assigned value. */
  missingFacetSystemRoles?: FacetSystemRole[];
  /** Recursive classifications whose complete subtrees should match. */
  classificationIds?: string[];
  /** Matches terms without any classification membership. */
  missingClassification?: boolean;
  termIds?: string[];
  excludeDrafts: boolean;
  excludeUncited: boolean;
  includeArchived: boolean;
  packReleaseIds?: string[];
  includeLocalTerms?: boolean;
}

export interface DictionaryScopeResolveInput {
  packReleaseIds: string[];
  includeLocalTerms: boolean;
}

export interface DictionaryScopeContentsDto {
  paletteRevisionIds: string[];
}

export interface DictionaryPageInput extends DictionarySearchInput {
  offset: number;
  limit: number;
  prioritizeTermId?: string;
}

export interface DictionaryPageDto {
  items: TermListItem[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export type WordPaletteContentInput =
  | {
      kind: 'TEXT';
      promptFragment: string;
      negativeFragment: string;
    }
  | {
      kind: 'TERM';
      termId: string;
    };

export type WordPalettePromptNodeInput =
  | WordPaletteContentInput
  | {
      kind: 'SLOT';
      stableKey: string;
    };

export type WordPaletteContentDto =
  | {
      id: string;
      kind: 'TEXT';
      promptFragment: string;
      negativeFragment: string;
    }
  | {
      id: string;
      kind: 'TERM';
      term: TermListItem;
    };

export type WordPalettePromptNodeDto =
  | WordPaletteContentDto
  | {
      id: string;
      kind: 'SLOT';
      stableKey: string;
    };

export interface WordPaletteLocalizationDto {
  locale: ContentLocale;
  name: string;
  description: string;
}

export interface WordPaletteParameterLocalizationDto {
  locale: ContentLocale;
  name: string;
}

export interface WordPaletteOptionLocalizationDto {
  locale: ContentLocale;
  label: string;
}

export interface WordPaletteParameterOptionDto {
  id: string;
  value: string;
  label: string;
  labelLocale: ContentLocale;
  localizations: WordPaletteOptionLocalizationDto[];
  contents: WordPaletteContentDto[];
}

export interface WordPaletteParameterDto {
  id: string;
  stableKey: string;
  name: string;
  nameLocale: ContentLocale;
  localizations: WordPaletteParameterLocalizationDto[];
  required: boolean;
  options: WordPaletteParameterOptionDto[];
}

export type WordPaletteStatus = 'ACTIVE' | 'ARCHIVED';

export interface WordPaletteRevisionDto {
  id: string;
  revisionNo: number;
  name: string;
  nameLocale: ContentLocale;
  description: string;
  localizations: WordPaletteLocalizationDto[];
  kind: 'STATIC' | 'PARAMETERIZED';
  terms: TermListItem[];
  parameters: WordPaletteParameterDto[];
  promptNodes: WordPalettePromptNodeDto[];
  referenceAssets: AssetDto[];
  createdAt: string;
}

export interface WordPaletteDto {
  id: string;
  revisionId: string;
  revisionNo: number;
  name: string;
  nameLocale: ContentLocale;
  description: string;
  localizations: WordPaletteLocalizationDto[];
  kind: 'STATIC' | 'PARAMETERIZED';
  status: WordPaletteStatus;
  terms: TermListItem[];
  parameters: WordPaletteParameterDto[];
  promptNodes: WordPalettePromptNodeDto[];
  referenceAssets: AssetDto[];
  revisions: WordPaletteRevisionDto[];
  usageCount: number;
  updatedAt: string;
}

export interface WordPaletteParameterInput {
  stableKey: string;
  name: string;
  nameLocale: ContentLocale;
  localizations: WordPaletteParameterLocalizationDto[];
  required: boolean;
  options: Array<{
    value: string;
    label: string;
    labelLocale: ContentLocale;
    localizations: WordPaletteOptionLocalizationDto[];
    contents: WordPaletteContentInput[];
  }>;
}

export interface CreateWordPaletteInput {
  locale: Locale;
  name: string;
  nameLocale: ContentLocale;
  description: string;
  localizations: WordPaletteLocalizationDto[];
  referenceAssetIds: string[];
  parameters: WordPaletteParameterInput[];
  promptNodes: WordPalettePromptNodeInput[];
}

export interface UpdateWordPaletteInput extends CreateWordPaletteInput {
  paletteId: string;
}

export interface WordPaletteReferenceInput {
  paletteId: string;
  paletteRevisionId: string;
  parameterValues: Record<string, string>;
  promptLocale: Locale;
}

/** Renderer-authored ordering for free text and structured creator materials. */
export type CreatorPromptNodeInput =
  | { kind: 'TEXT'; text: string }
  | { kind: 'TERM'; termId: string; promptLocale?: Locale }
  | { kind: 'RECIPE'; paletteId: string };

export interface ImportPreview {
  batchId: string;
  fileName: string;
  rows: number;
  valid: number;
  duplicate: number;
  invalid: number;
  samples: Array<{ title: string; titleLocale: ContentLocale; state: string }>;
}

export interface ReferenceSelection {
  assets: AssetDto[];
}

export interface CodexAssistTermInput {
  stableId: string;
  revisionId: string;
  expressionRevisionId: string | null;
  displayName: string;
  promptFragment: string;
  negativeFragment: string;
}

export interface CodexAssistRecipeParameterInput {
  stableId: string;
  revisionId: string;
  displayName: string;
  selectedValue: string;
  selectedOptionId: string | null;
  selectedOptionLabel: string;
  promptFragment: string;
}

export interface CodexAssistRecipeAssetInput {
  assetId: string;
  kind: AssetDto['kind'];
  originType?: string;
  width: number;
  height: number;
  mimeType: string;
}

/** A recipe is one aggregate creator reference; its internals are nested details. */
export interface CodexAssistRecipeInput {
  useId: string;
  stableId: string;
  revisionId: string;
  displayName: string;
  promptLocale: Locale;
  parameterValues: Record<string, string>;
  parameters: CodexAssistRecipeParameterInput[];
  referenceAssets: CodexAssistRecipeAssetInput[];
  promptFragment: string;
  negativeFragment: string;
  internalTerms: CodexAssistTermInput[];
}

/** Frozen editor ordering supplied to the assistant. IDs always refer to the
 * exact term or recipe revisions included in the same request. */
export type CodexAssistPromptNodeInput =
  | { kind: 'TEXT'; text: string }
  | { kind: 'TERM'; termId: string; termRevisionId: string }
  | { kind: 'RECIPE'; paletteId: string; paletteRevisionId: string };

export interface CodexAssistInput {
  mode: 'optimize' | 'directions' | 'chat';
  /** Request-level grounding intent. Each provider maps this to its own search mechanism. */
  webSearchMode?: AssistantWebSearchMode;
  /** Host-selected proposal strategy; never inferred from hidden conversation history. */
  directionStrategy?: 'DIVERGENT' | 'ADJACENT';
  /** Explicit compact memory of direction territory already covered in this frozen context. */
  previousDirectionCoverage?: Array<{
    label: string;
    variableAxis: string;
  }>;
  prompt: string;
  message?: string;
  locale: Locale;
  directTerms: CodexAssistTermInput[];
  recipes: CodexAssistRecipeInput[];
  /** Current ordered prompt document. */
  contentNodes?: CodexAssistPromptNodeInput[];
  /** Locally retrieved existing terms the model may add to a prompt draft. */
  candidateTerms?: CodexAssistTermInput[];
  /** Direct creator references are metadata-only until a verified vision role is available. */
  referenceAssets?: CodexAssistRecipeAssetInput[];
  canvasPresetKey?: string | null;
  canvasWidth?: number | null;
  canvasHeight?: number | null;
  generationTargets?: GenerationTargetInput[];
}

export interface PromptEditChangeDto {
  before: string;
  after: string;
  reason: string;
}

export interface PromptEditProposalDto {
  summary: string;
  preserved: string[];
  changes: PromptEditChangeDto[];
  removed: string[];
  /** Only the user-authored instruction. Selected terms and recipes stay structured. */
  revisedUserInstruction: string;
}

export type PromptDraftNodeDto =
  | { kind: 'TEXT'; text: string }
  | {
      kind: 'TERM';
      termId: string;
      termRevisionId: string;
      displayName: string;
    }
  | {
      kind: 'RECIPE';
      paletteId: string;
      paletteRevisionId: string;
      displayName: string;
      parameterValues: Record<string, string>;
      promptLocale: Locale;
    };

/** Complete ordered draft returned by Prompt organization. Existing
 * dictionary objects remain references and are never flattened into text. */
export interface PromptDraftProposalDto {
  summary: string;
  warnings: string[];
  contentNodes: PromptDraftNodeDto[];
}

export type AssistantProposalApplyValue =
  { kind: 'PROMPT_TEXT'; prompt: string } | { kind: 'PROMPT_DRAFT'; draft: PromptDraftProposalDto };

export interface AssistantAssumptionDto {
  label: string;
  interpretation: string;
  impact: string;
}

export interface DirectionProposalDto {
  label: string;
  prompt: string;
  rationale: string;
  variableAxis: string;
  risk: string;
}

export interface CodexAssistResult {
  assistantMessage: string;
  /** Conversational Prompt suggestion; Prompt organization uses promptDraft instead. */
  optimizedPrompt?: string;
  promptEdit?: PromptEditProposalDto;
  /** Present for Prompt organization; absent on directions and chat. */
  promptDraft?: PromptDraftProposalDto;
  sharedConstraints: string[];
  assumptions: AssistantAssumptionDto[];
  directions: DirectionProposalDto[];
}

export interface CreatorAgentScope {
  kind: 'DRAFT' | 'SERIES';
  id: string;
}

export interface CreatorAgentAssistInput extends CodexAssistInput {
  scope: CreatorAgentScope;
  /** Append this run to an existing idea creation instead of creating a new one. */
  creationId?: string | null;
  /** Explicit lineage only; no implicit conversation history is consulted. */
  parentProposalId?: string | null;
  /** Completed experiment slot explicitly selected as the basis for an adjacent-variable proposal. */
  sourceExperimentSlotId?: string | null;
  /** Fingerprint of prompt, terms, recipes, references, canvas and model targets. */
  contextKey: string;
  referenceAssets: CodexAssistRecipeAssetInput[];
  termPromptLocale: Locale;
  canvasPresetKey: string | null;
  /** Exact dimensions authorized with the proposal, independent of the preset label. */
  canvasWidth: number | null;
  canvasHeight: number | null;
  generationTargets: GenerationTargetInput[];
}

/** A conversational turn is persisted separately from assistant prompt proposals.
 * Only explicitly attached asset ids are sent to the model as images; the wider
 * referenceAssets collection remains structured creation context. */
export interface CreatorAgentChatInput extends CodexAssistInput {
  scope: CreatorAgentScope;
  mode: 'chat';
  message: string;
  attachmentAssetIds: string[];
  referenceAssets: CodexAssistRecipeAssetInput[];
}

export type AssistantRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';
export type AssistantProposalStatus = 'READY' | 'EXPIRED' | 'ADOPTED' | 'CLOSED';

export type CreationStatus = 'FORMING' | 'ACTIVE' | 'FAILED' | 'ARCHIVED';
export type CreationElementKind =
  | 'BRIEF'
  | 'ASSISTANT_RUN'
  | 'DIRECTION_SET'
  | 'PROMPT_SERIES'
  | 'DOCUMENT'
  | 'MATERIAL'
  | 'STYLE_EXPLORATION_BATCH'
  | 'COMPARISON_SET';

export type AssistantActivityPhase =
  | 'CREATION_SAVED'
  | 'MODEL_REQUESTED'
  | 'MODEL_RESPONDING'
  | 'RESULT_VALIDATED'
  | 'COMPLETED'
  | 'FAILED'
  | 'INTERRUPTED';

export interface AssistantActivityEventDto {
  id: string;
  creationId: string;
  assistantRunId: string | null;
  scope: CreatorAgentScope;
  contextKey: string;
  sequence: number;
  phase: AssistantActivityPhase;
  providerKey: string | null;
  modelKey: string | null;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CreationElementDto {
  id: string;
  creationId: string;
  kind: CreationElementKind;
  targetId: string;
  payload: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreationDto {
  id: string;
  sourceScope: CreatorAgentScope;
  title: string;
  briefText: string;
  status: CreationStatus;
  failureMessage: string;
  elements: CreationElementDto[];
  activityEvents: AssistantActivityEventDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AssistantCapabilityReceiptDto {
  directTermCount: number;
  candidateTermCount?: number;
  recipeCount: number;
  referenceCount: number;
  visionAnalyzed: false;
}

export interface AssistantProposalDto {
  id: string;
  assistantRunId: string;
  status: AssistantProposalStatus;
  adoptedContextKey: string | null;
  result: CodexAssistResult;
  createdAt: string;
  updatedAt: string;
}

/** One immutable, explicitly accepted Prompt draft. The authorization key
 * remains separate so accepting a draft never approves changed external settings. */
export interface AssistantPromptDocumentSnapshot {
  promptNodes: CreatorPromptNodeInput[];
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
}

export interface AssistantProposalAdoptionInput {
  runId: string;
  baseContextKey: string;
  resultContextKey: string;
  authorizedContextKey: string;
  beforePrompt: string;
  afterPrompt: string;
  beforeDocument?: AssistantPromptDocumentSnapshot;
  afterDocument?: AssistantPromptDocumentSnapshot;
  /** Persist the accepted editor state in the same transaction as the proposal status. */
  persistence?: { kind: 'DRAFT'; draft: CreationDraftSaveInput } | { kind: 'SERIES'; version: GenerationInput };
}

export interface AssistantRunDto {
  id: string;
  scope: CreatorAgentScope;
  mode: Extract<CodexAssistInput['mode'], 'optimize' | 'directions'>;
  /** Stable ordinal among runs with the same scope and operation mode. */
  occurrenceNo?: number;
  occurrenceCount?: number;
  status: AssistantRunStatus;
  /** Null when the run is not attached to a persisted creation. */
  creationId?: string | null;
  creationTitle?: string | null;
  providerKey?: string;
  modelKey?: string;
  reasoningEffort?: AssistantReasoningEffort | null;
  activityEvents?: AssistantActivityEventDto[];
  contextKey: string;
  contextHash: string;
  /** Complete immutable request used for this run. */
  input: CreatorAgentAssistInput;
  capabilityReceipt: AssistantCapabilityReceiptDto;
  proposal: AssistantProposalDto | null;
  errorMessage: string;
  dismissedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CreatorAgentTurnDto {
  id: string;
  scope: CreatorAgentScope;
  mode: CodexAssistInput['mode'];
  prompt: string;
  message: string;
  attachments: AssetDto[];
  result: CodexAssistResult;
  createdAt: string;
}

export interface CodexTitleInput {
  prompt: string;
  title: string;
  mode: 'fill' | 'regenerate';
}

export interface CodexTitleResult {
  title: string;
}

export interface RenamePromptSeriesInput {
  seriesId: string;
  title: string;
  expectedTitle?: string;
}

export type PromptSeriesOutputDisposition = 'KEEP' | 'TRASH';

export interface DeletePromptSeriesInput {
  seriesId: string;
  outputDisposition: PromptSeriesOutputDisposition;
}

export interface DeletePromptSeriesResult {
  seriesId: string;
  outputDisposition: PromptSeriesOutputDisposition;
  trashedOutputCount: number;
  retainedOutputCount: number;
}

/** A comment-driven edit executed by the built-in Codex App Server extension. */
export interface CodexImageRefinementInput {
  seriesId: string;
  sourceAssetId: string;
  annotationIds: string[];
  locale: Locale;
  quality: GenerationQuality;
}

export type ImageEditMode = 'AUTO' | 'SEMANTIC' | 'MASK';

/** Provider-neutral image edit request. Local paths and mask artifacts are resolved in the main process. */
export interface ImageEditStartInput {
  seriesId: string;
  sourceAssetId: string;
  annotationIds: string[];
  modelKey: string;
  mode: ImageEditMode;
  locale: Locale;
  quality: GenerationQuality;
}

/** One frozen annotated edit submitted to every selected generation target. */
export interface ImageEditBatchStartInput {
  seriesId: string;
  sourceAssetId: string;
  annotationIds: string[];
  targets: GenerationTargetInput[];
  mode: ImageEditMode;
  locale: Locale;
}

/** Generative aspect-ratio change. Unlike ImageCropInput this may redraw the source image. */
export interface ImageReframeStartInput {
  seriesId: string;
  sourceAssetId: string;
  modelKey: string;
  ratioWidth: number;
  ratioHeight: number;
  locale: Locale;
  quality: GenerationQuality;
}

export interface GenerationInput {
  seriesId: string | null;
  creationDraftId?: string | null;
  /** Selected historical version to reuse or branch from instead of the series head. */
  baseVersionId?: string | null;
  /** Preserves edit lineage when a generation is derived from an existing image. */
  sourceAssetId?: string | null;
  title: string;
  manualPrompt: string;
  promptNodes?: CreatorPromptNodeInput[];
  prompt: string;
  resolvedPrompt?: ResolvedPromptComposition;
  changeSummary: string;
  referenceAssetIds: string[];
  termPromptLocale?: Locale;
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
  modelKey: string;
  canvasPresetKey: string | null;
  width: number | null;
  height: number | null;
  quality: GenerationQuality;
}

export interface CreationDraftCommitInput {
  creationDraftId: string;
  title: string;
  manualPrompt: string;
  promptNodes?: CreatorPromptNodeInput[];
  prompt: string;
  resolvedPrompt?: ResolvedPromptComposition;
  changeSummary: string;
  referenceAssetIds: string[];
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
}

export interface CreationDraftCommitResult {
  seriesId: string;
  versionId: string;
}

export interface GenerationTargetInput {
  modelKey: string;
  count: number;
  quality: GenerationQuality;
}

export interface GenerationBatchInput {
  input: Omit<GenerationInput, 'modelKey'>;
  targets: GenerationTargetInput[];
}

export type StyleExplorationStatus =
  'QUEUED' | 'RUNNING' | 'PARTIAL' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';

export interface StyleExplorationSlotInput {
  label: string;
  rationale: string;
  variableAxis: string;
  risk: string;
  userInstruction: string;
  input: Omit<GenerationInput, 'seriesId' | 'creationDraftId' | 'modelKey'>;
}

export interface DirectionExperimentDecisionReceiptDto {
  label: string;
  interpretation: string;
  impact: string;
}

/** The exact, user-visible handoff attached to a direction experiment. It is
 * intentionally specific to this workflow rather than a generic Agent DSL. */
export interface DirectionExperimentDelegationInput {
  objective: string;
  deadlineAt: string | null;
  remoteScope: string[];
  decisions: DirectionExperimentDecisionReceiptDto[];
}

export type DirectionExperimentDirectorTaskStatus =
  | 'DELEGATED'
  | 'PREPARING'
  | 'EXECUTING'
  | 'WAITING_DECISION'
  | 'PAUSED'
  | 'WRAPPING_UP'
  | 'SUCCEEDED'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export interface DirectionExperimentDirectorAuthorizationDto {
  objective: string;
  fixedConstraints: string[];
  directionCount: number;
  targets: GenerationTargetInput[];
  maximumRuns: number;
  deadlineAt: string | null;
  cost: {
    state: 'UNKNOWN';
    maximumMinorUnits: null;
    currency: null;
  };
  remoteScope: string[];
  decisions: DirectionExperimentDecisionReceiptDto[];
  /** A director may submit authorized generations, but never mutate these
   * relationship or knowledge objects as a completion side effect. */
  relationshipActionsAllowed: false;
}

export interface DirectionExperimentDirectorCompletionReportDto {
  authorizedRunCount: number;
  submittedRunCount: number;
  retryRunCount: number;
  outputCount: number;
  failedCount: number;
  cancelledCount: number;
  interruptedCount: number;
  knownCostMinorUnits: null;
  currency: null;
  relationshipActionsPerformed: [];
  relationshipActionsNotPerformed: Array<'FAVORITE' | 'ADOPT' | 'ADD_TO_ALBUM' | 'UPDATE_DICTIONARY' | 'PUBLISH'>;
}

export interface DirectionExperimentDirectorTaskDto {
  id: string;
  kind: 'DIRECTION_EXPERIMENT_DIRECTOR';
  scope: CreatorAgentScope;
  sourceAssistantRunId: string;
  batchId: string;
  status: DirectionExperimentDirectorTaskStatus;
  objective: string;
  authorization: DirectionExperimentDirectorAuthorizationDto;
  runIds: string[];
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  interruptedCount: number;
  activeCount: number;
  totalCount: number;
  completionReport: DirectionExperimentDirectorCompletionReportDto | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StyleExplorationStartInput {
  scope: CreatorAgentScope;
  sourceAssistantRunId: string;
  commonConstraints: string[];
  slots: StyleExplorationSlotInput[];
  targets: GenerationTargetInput[];
  delegation?: DirectionExperimentDelegationInput;
}

export interface StyleExplorationSlotDto {
  id: string;
  batchId: string;
  sortOrder: number;
  label: string;
  rationale: string;
  variableAxis: string;
  risk: string;
  userInstruction: string;
  seriesId: string;
  versionId: string;
  runIds: string[];
  status: StyleExplorationStatus;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  interruptedCount: number;
  activeCount: number;
  totalCount: number;
}

export interface StyleExplorationBatchDto {
  id: string;
  scope: CreatorAgentScope;
  sourceAssistantRunId: string;
  commonConstraints: string[];
  status: StyleExplorationStatus;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  interruptedCount: number;
  activeCount: number;
  totalCount: number;
  slots: StyleExplorationSlotDto[];
  directorTask?: DirectionExperimentDirectorTaskDto | null;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeDistillationMatchSource = 'DIRECT_TERM' | 'RECIPE_TERM' | 'PROMPT_MATCH';

export interface KnowledgeDistillationTermMatchDto {
  termId: string;
  termRevisionId: string;
  title: string;
  titleLocale: ContentLocale;
  localizations: LocalizedTitleDto[];
  positive: string;
  source: KnowledgeDistillationMatchSource;
  confidence: number;
  reason: string;
}

export interface KnowledgeDistillationTermCandidateDto {
  id: string;
  title: string;
  titleLocale: ContentLocale;
  localizations: LocalizedTitleDto[];
  positive: string;
  negative: string;
  evidenceText: string;
  reason: string;
}

export interface KnowledgeDistillationRecipeCandidateDto {
  name: string;
  nameLocale: ContentLocale;
  description: string;
  localizations: WordPaletteLocalizationDto[];
  matchedTermIds: string[];
  remainingTermCandidateIds: string[];
}

export interface KnowledgeDistillationProposalDto {
  id: string;
  sourceAssetId: string;
  sourceSeriesId: string;
  sourcePromptVersionId: string;
  sourceVersionNo: number;
  sourceTitleZh: string;
  sourceTitleEn: string;
  status: 'READY' | 'ACCEPTED' | 'CLOSED';
  acceptedPaletteId: string | null;
  acceptedPaletteRevisionId: string | null;
  acceptedAt: string | null;
  acceptedSelection: {
    matchedTermIds: string[];
    candidateIds: string[];
  } | null;
  capabilityReceipt: {
    visionAnalyzed: false;
    basis: 'PROMPT_VERSION';
    modelKey: string | null;
  };
  inputSnapshot: {
    userInstruction: string;
    finalPrompt: string;
    directTermIds: string[];
    recipeIds: string[];
    directTerms: PromptCommonTermReferenceDto[];
    recipes: PromptCommonRecipeReferenceDto[];
    referenceAssetIds: string[];
  };
  matchedTerms: KnowledgeDistillationTermMatchDto[];
  remainingTermCandidates: KnowledgeDistillationTermCandidateDto[];
  recipeCandidate: KnowledgeDistillationRecipeCandidateDto;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDistillationCreateInput {
  sourceAssetId: string;
  locale: Locale;
}

export interface KnowledgeDistillationAcceptInput {
  proposalId: string;
  locale: Locale;
  matchedTermIds: string[];
  candidateIds: string[];
}

export interface KnowledgeDistillationAcceptResult {
  proposal: KnowledgeDistillationProposalDto;
  palette: WordPaletteDto;
  candidateTermIds: Record<string, string>;
}

export type HistoricalTermRecommendationBasis = 'SIMILAR_PROMPT' | 'TERM_COOCCURRENCE' | 'PROMPT_MATCH';

export interface HistoricalTermRecommendationItemDto {
  termId: string;
  termRevisionId: string;
  title: string;
  titleLocale: ContentLocale;
  localizations: LocalizedTitleDto[];
  score: number;
  reason: string;
  bases: HistoricalTermRecommendationBasis[];
  similarPromptCount: number;
  cooccurrenceCount: number;
  lastUsedAt: string | null;
}

export interface HistoricalTermRecommendationRunDto {
  id: string;
  scope: CreatorAgentScope | null;
  status: 'READY';
  inputSnapshot: {
    prompt: string;
    selectedTermIds: string[];
    candidateTermIds: string[];
  };
  recommendations: HistoricalTermRecommendationItemDto[];
  indexedPromptCount: number;
  createdAt: string;
}

export interface HistoricalTermRecommendationCreateInput {
  scope: CreatorAgentScope | null;
  prompt: string;
  selectedTermIds: string[];
  candidateTermIds: string[];
  locale: Locale;
  limit?: number;
}

export interface HistoricalTermRecommendationListInput {
  scope: CreatorAgentScope | null;
  limit?: number;
}

export type DictionaryMaintenanceIssueCode =
  | 'MISSING_TITLE'
  | 'MISSING_TITLE_LOCALE'
  | 'MISSING_DEFINITION'
  | 'MISSING_CATEGORY'
  | 'MISSING_POSITIVE_EXPRESSION'
  | 'DUPLICATE_POSITIVE_EXPRESSION'
  | 'UNUSED_TERM';

export type DictionaryMaintenanceSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface DictionaryMaintenanceIssueDto {
  code: DictionaryMaintenanceIssueCode;
  field: string;
  before: string;
  expected: string;
  reason: string;
  relatedTermIds: string[];
}

export interface DictionaryMaintenanceCandidateDto {
  id: string;
  termId: string;
  termRevisionId: string;
  title: string;
  titleLocale: ContentLocale;
  severity: DictionaryMaintenanceSeverity;
  issues: DictionaryMaintenanceIssueDto[];
  citationCount: number;
  distinctPromptSeries: number;
}

export interface DictionaryMaintenanceSummaryDto {
  termCount: number;
  readyTermCount: number;
  citedTermCount: number;
  uncitedTermCount: number;
  missingDefinitionCount: number;
  missingCategoryCount: number;
  missingPositiveExpressionCount: number;
  duplicateExpressionGroupCount: number;
  candidateTermCount: number;
  issueCounts: Partial<Record<DictionaryMaintenanceIssueCode, number>>;
}

export interface DictionaryMaintenanceReportDto {
  id: string;
  locale: Locale;
  deterministic: true;
  sourceHash: string;
  sourceRevisionCount: number;
  isStale: boolean;
  summary: DictionaryMaintenanceSummaryDto;
  candidates: DictionaryMaintenanceCandidateDto[];
  createdAt: string;
}

export interface DictionaryMaintenanceListInput {
  locale: Locale;
  limit?: number;
}

export interface DictionaryMaintenanceCreateInput {
  locale: Locale;
}

export interface GenerationVersionInput {
  versionId: string;
  modelKey: string;
}

export interface AnnotationInput {
  imageAssetId: string;
  type: AnnotationType;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  geometry?: AnnotationBrushGeometry | null;
  comment: string;
}

export interface AnnotationUpdateInput {
  annotationId: string;
  type: AnnotationType;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  geometry?: AnnotationBrushGeometry | null;
  comment: string;
}

export interface AnnotationHistoryReuseInput {
  promptVersionId: string;
}

export interface AnnotationHistoryReuseResult {
  imageAssetId: string;
  annotations: AnnotationDto[];
}

export interface AnnotationStatusInput {
  annotationId: string;
  status: AnnotationStatus;
}

export type NavigationCommand = 'back' | 'forward';

export interface DesktopApi {
  bootstrap(locale: Locale): Promise<BootstrapDto>;
  appRequestQuit(): Promise<void>;
  extensionsList(): Promise<ExtensionDto[]>;
  extensionLanguagePacksList(): Promise<ExtensionLanguagePackDto[]>;
  extensionInstallLocal(): Promise<ExtensionInstallLocalResult>;
  extensionUninstallLocal(extensionId: string): Promise<ExtensionDto[]>;
  extensionSetEnabled(input: ExtensionSetEnabledInput): Promise<ExtensionDto[]>;
  extensionSetPermission(input: ExtensionSetPermissionInput): Promise<ExtensionDto[]>;
  codexGeneratedImagesList(input: CodexImageDiscoveryListInput): Promise<CodexImageDiscoverySnapshotDto>;
  codexGeneratedImagesImport(input: CodexGeneratedImageImportInput): Promise<CodexGeneratedImageImportResult>;
  openAiImageApiGet(): Promise<OpenAiImageApiConnectionDto>;
  openAiImageApiSave(input: OpenAiImageApiSaveInput): Promise<OpenAiImageApiConnectionDto>;
  openAiImageApiTest(): Promise<OpenAiImageApiConnectionDto>;
  openAiImageApiClear(): Promise<OpenAiImageApiConnectionDto>;
  deepSeekApiGet(): Promise<DeepSeekApiConnectionDto>;
  deepSeekApiSave(input: DeepSeekApiSaveInput): Promise<DeepSeekApiConnectionDto>;
  deepSeekApiTest(): Promise<DeepSeekApiConnectionDto>;
  deepSeekApiClear(): Promise<DeepSeekApiConnectionDto>;
  assistantRoutingGet(): Promise<AssistantRoutingDto>;
  assistantRoutingSave(input: AssistantRoutingSaveInput): Promise<AssistantRoutingDto>;
  externalImageApiGet(extensionId: string): Promise<ExternalImageApiConnectionDto>;
  externalImageApiSave(input: ExternalImageApiSaveInput): Promise<ExternalImageApiConnectionDto>;
  externalImageApiTest(extensionId: string): Promise<ExternalImageApiConnectionDto>;
  externalImageApiClear(extensionId: string): Promise<ExternalImageApiConnectionDto>;
  localSpacesList(): Promise<LocalSpaceRegistryDto>;
  localSpacesOpen(): Promise<LocalSpaceSwitchResult>;
  localSpacesSwitch(spaceId: string): Promise<LocalSpaceSwitchResult>;
  localSpacesCreate(name: string): Promise<LocalSpaceSwitchResult>;
  localSpacesChooseCover(spaceId: string): Promise<LocalSpaceCoverUpdateResult>;
  localSpacesRemoveCover(spaceId: string): Promise<LocalSpaceDescriptorDto>;
  onLocalSpaceTransition(callback: (event: LocalSpaceTransitionEvent) => void): () => void;
  packsList(): Promise<PackCatalogItemDto[]>;
  packImportLocal(): Promise<PackImportLocalResult>;
  packImportStarter(): Promise<string>;
  packReleaseGet(releaseId: string): Promise<PackReleaseDto>;
  packInstallExact(input: PackInstallExactInput): Promise<PackInstallationDto>;
  packSetDisabled(packId: string, disabled: boolean): Promise<PackInstallationDto>;
  packRemove(packId: string): Promise<PackInstallationDto>;
  intakeCommit(input: IntakeCommitInput): Promise<IntakeCommitResult>;
  creatorReferencesImport(input: CreatorImageImportInput): Promise<AssetDto[]>;
  creatorOutputsImport(input: CreatorStagedImageImportInput): Promise<CreatorOutputsImportResult>;
  creatorNewExternalCreationImport(input: NewExternalCreationImportInput): Promise<NewExternalCreationImportResult>;
  creatorOutputsStage(items: CreatorImageImportItemInput[]): Promise<CreatorImageStagePreviewRow[]>;
  creatorOutputsChoose(input: CreatorImageChooseInput): Promise<CreatorImageStagePreviewRow[] | null>;
  creatorOutputsDiscard(stageIds: string[]): Promise<void>;
  creatorOutputUpdate(input: ImportedCreationOutputUpdateInput): Promise<ImportedCreationOutputDto>;
  creationDraftStart(input: CreationDraftStartInput): Promise<CreationDraftDto>;
  creationDraftSave(input: CreationDraftSaveInput): Promise<CreationDraftDto>;
  creationDraftCommit(input: CreationDraftCommitInput): Promise<CreationDraftCommitResult>;
  creationInputStashesList(scope: CreatorAgentScope): Promise<CreationInputStashDto[]>;
  creationInputStashCreate(input: CreationInputStashCreateInput): Promise<CreationInputStashDto>;
  creationsDelete(creationId: string): Promise<void>;
  dictionarySearch(input: DictionarySearchInput): Promise<TermListItem[]>;
  dictionarySearchPage(input: DictionaryPageInput): Promise<DictionaryPageDto>;
  dictionaryScopeResolve(input: DictionaryScopeResolveInput): Promise<DictionaryScopeContentsDto>;
  dictionaryGet(termId: string, locale: Locale): Promise<TermEditorDto>;
  dictionaryCreate(input: NewTermInput): Promise<TermEditorDto>;
  dictionarySaveDraft(input: DictionarySaveDraftInput): Promise<TermEditorDto>;
  dictionaryApprove(termId: string, locale: Locale): Promise<TermEditorDto>;
  dictionaryWithdrawApproval(termId: string, locale: Locale): Promise<TermEditorDto>;
  dictionarySetArchived(termId: string, archived: boolean, locale: Locale): Promise<TermEditorDto>;
  dictionaryAddMedia(input: AddTermMediaInput): Promise<TermMediaItemDto[]>;
  dictionarySetMediaCover(mediaId: string): Promise<TermMediaItemDto[]>;
  dictionaryRemoveMedia(mediaId: string): Promise<TermMediaItemDto[]>;
  dictionaryReorderMedia(input: ReorderTermMediaInput): Promise<TermMediaItemDto[]>;
  dictionaryClassificationsTree(locale: Locale): Promise<DictionaryClassificationTreeDto>;
  dictionaryClassificationsTerms(input: DictionaryClassificationTermsInput): Promise<DictionaryClassificationTermsDto>;
  dictionaryClassificationCreate(input: DictionaryClassificationCreateInput): Promise<DictionaryClassificationTreeDto>;
  dictionaryClassificationUpdate(input: DictionaryClassificationUpdateInput): Promise<DictionaryClassificationTreeDto>;
  dictionaryClassificationRestoreSource(
    input: DictionaryClassificationRestoreSourceInput,
  ): Promise<DictionaryClassificationTreeDto>;
  dictionaryClassificationMovePreview(
    input: DictionaryClassificationMoveInput,
  ): Promise<DictionaryClassificationMovePreviewDto>;
  dictionaryClassificationMove(input: DictionaryClassificationMoveInput): Promise<DictionaryClassificationTreeDto>;
  dictionaryClassificationReorder(
    input: DictionaryClassificationReorderInput,
  ): Promise<DictionaryClassificationTreeDto>;
  dictionaryClassificationSetState(
    input: DictionaryClassificationSetStateInput,
  ): Promise<DictionaryClassificationTreeDto>;
  dictionaryClassificationMergePreview(
    input: DictionaryClassificationMergeInput,
  ): Promise<DictionaryClassificationMergePreviewDto>;
  dictionaryClassificationMerge(input: DictionaryClassificationMergeInput): Promise<DictionaryClassificationTreeDto>;
  materialsAddToDestinations(input: AddMaterialsToDestinationsInput): Promise<AddMaterialsToDestinationsResult>;
  dictionaryChooseImport(): Promise<ImportPreview | null>;
  dictionaryCommitImport(batchId: string): Promise<{ imported: number; skipped: number }>;
  wordPaletteCreate(input: CreateWordPaletteInput): Promise<WordPaletteDto>;
  wordPaletteUpdate(input: UpdateWordPaletteInput): Promise<WordPaletteDto>;
  wordPaletteSetArchived(paletteId: string, archived: boolean): Promise<void>;
  wordPaletteDelete(paletteId: string): Promise<void>;
  assetsChooseReferences(): Promise<ReferenceSelection>;
  codexHealth(): Promise<CodexHealth>;
  codexOpenThread(threadId: string): Promise<void>;
  agentHistory(scope: CreatorAgentScope): Promise<CreatorAgentTurnDto[]>;
  agentChat(input: CreatorAgentChatInput): Promise<CreatorAgentTurnDto>;
  agentAssist(input: CreatorAgentAssistInput): Promise<AssistantRunDto>;
  assistantProposalExpire(runId: string, currentContextKey: string): Promise<AssistantRunDto>;
  assistantProposalRevalidate(runId: string, currentContextKey: string): Promise<AssistantRunDto>;
  assistantProposalAdopt(input: AssistantProposalAdoptionInput): Promise<AssistantRunDto>;
  assistantProposalClose(runId: string): Promise<AssistantRunDto>;
  assistantRunDismiss(runId: string): Promise<AssistantRunDto>;
  codexSuggestTitles(input: CodexTitleInput): Promise<CodexTitleResult>;
  promptSeriesRename(input: RenamePromptSeriesInput): Promise<{ renamed: boolean }>;
  promptSeriesDelete(input: DeletePromptSeriesInput): Promise<DeletePromptSeriesResult>;
  creationGroupsRename(input: RenameCreationGroupInput): Promise<CreationGroupDto>;
  materialCollectionsCreateFromSource(
    input: CreateMaterialCollectionFromSourceInput,
  ): Promise<CreateMaterialCollectionFromSourceResult>;
  materialAlbumsList(input: MaterialAlbumListInput): Promise<MaterialAlbumDto[]>;
  materialAlbumsCreate(input: MaterialAlbumCreateInput): Promise<MaterialAlbumDto>;
  materialAlbumsRename(input: MaterialAlbumRenameInput): Promise<MaterialAlbumDto>;
  materialAlbumsDelete(albumId: string): Promise<void>;
  materialAlbumsAddMany(input: MaterialAlbumAddManyInput): Promise<MaterialAlbumDto>;
  materialAlbumsRemove(input: MaterialAlbumRemoveInput): Promise<MaterialAlbumDto>;
  albumsList(): Promise<AlbumDto[]>;
  albumsListTextMaterials(albumId: string): Promise<FavoriteTextMaterialDto[]>;
  albumsCreate(input: AlbumCreateInput): Promise<AlbumDto>;
  albumsCreateFromMaterials(input: AlbumCreateFromMaterialsInput): Promise<AlbumCreateFromMaterialsResult>;
  albumsRename(input: AlbumRenameInput): Promise<AlbumDto>;
  albumsUpdateCreationDefaults(input: AlbumCreationDefaultsUpdateInput): Promise<AlbumDto>;
  albumsDelete(albumId: string): Promise<void>;
  albumsSetPinned(input: AlbumSetPinnedInput): Promise<AlbumDto>;
  albumsArchive(albumId: string): Promise<AlbumDto>;
  albumsSetArchived(input: AlbumSetArchivedInput): Promise<AlbumDto>;
  albumsMove(input: AlbumMoveInput): Promise<void>;
  albumsMoveSeries(input: AlbumMoveSeriesInput): Promise<void>;
  albumsAddMembers(input: AlbumAddMembersInput): Promise<AlbumDto>;
  albumsRemoveMembers(input: AlbumRemoveMembersInput): Promise<AlbumDto>;
  albumsReorderMembers(input: AlbumReorderMembersInput): Promise<void>;
  albumsReorderRoot(input: SidebarRootReorderInput): Promise<void>;
  materialMetadataUpdate(input: ExternalMaterialMetadataUpdateInput): Promise<ExternalMaterialMetadataDto>;
  materialProvenanceSuggestions(): Promise<MaterialProvenanceSuggestionsDto>;
  generationStart(input: GenerationInput): Promise<{ runId: string; seriesId: string; versionId: string }>;
  generationStartBatch(
    input: GenerationBatchInput,
  ): Promise<{ batchId: string | null; runIds: string[]; seriesId: string; versionId: string }>;
  imageEditStart(input: ImageEditStartInput): Promise<{ runId: string; seriesId: string; versionId: string }>;
  imageEditStartBatch(
    input: ImageEditBatchStartInput,
  ): Promise<{ batchId: string | null; runIds: string[]; seriesId: string; versionId: string }>;
  imageCrop(input: ImageCropInput): Promise<ImageTransformOutputDto>;
  imageReframeStart(input: ImageReframeStartInput): Promise<{ runId: string; seriesId: string; versionId: string }>;
  codexImageRefinementStart(
    input: CodexImageRefinementInput,
  ): Promise<{ runId: string; seriesId: string; versionId: string }>;
  styleExplorationStart(input: StyleExplorationStartInput): Promise<StyleExplorationBatchDto>;
  styleExplorationProposeAdjacent(slotId: string): Promise<AssistantRunDto>;
  styleExplorationCancel(batchId: string): Promise<void>;
  styleExplorationRetrySlot(slotId: string): Promise<void>;
  knowledgeDistillationList(sourceAssetId: string): Promise<KnowledgeDistillationProposalDto[]>;
  knowledgeDistillationCreate(input: KnowledgeDistillationCreateInput): Promise<KnowledgeDistillationProposalDto>;
  knowledgeDistillationAccept(input: KnowledgeDistillationAcceptInput): Promise<KnowledgeDistillationAcceptResult>;
  historicalTermRecommendationsList(
    input: HistoricalTermRecommendationListInput,
  ): Promise<HistoricalTermRecommendationRunDto[]>;
  historicalTermRecommendationsCreate(
    input: HistoricalTermRecommendationCreateInput,
  ): Promise<HistoricalTermRecommendationRunDto>;
  dictionaryMaintenanceList(input: DictionaryMaintenanceListInput): Promise<DictionaryMaintenanceReportDto[]>;
  dictionaryMaintenanceCreate(input: DictionaryMaintenanceCreateInput): Promise<DictionaryMaintenanceReportDto>;
  generationStartVersion(
    input: GenerationVersionInput,
  ): Promise<{ runId: string; seriesId: string; versionId: string }>;
  generationRetry(runId: string): Promise<{ runId: string; seriesId: string; versionId: string }>;
  generationCancel(runId: string): Promise<void>;
  generationOutputSetFailed(input: GenerationOutputSetFailedInput): Promise<void>;
  annotationsList(assetId: string): Promise<AnnotationDto[]>;
  annotationsAdd(input: AnnotationInput): Promise<AnnotationDto>;
  annotationsUpdate(input: AnnotationUpdateInput): Promise<AnnotationDto>;
  annotationsReuseHistory(input: AnnotationHistoryReuseInput): Promise<AnnotationHistoryReuseResult | null>;
  annotationsSetStatus(input: AnnotationStatusInput): Promise<AnnotationDto>;
  galleryList(input: GalleryListInput): Promise<GalleryPageDto>;
  assetRelationshipGet(assetId: string): Promise<AssetRelationshipDto>;
  assetFileAvailability(assetId: string): Promise<AssetFileAvailabilityDto>;
  assetFileCopy(assetId: string): Promise<void>;
  assetFileSaveAs(assetId: string): Promise<AssetFileSaveResult>;
  assetFileRevealTargets(assetId: string, context?: AssetFileRevealTargetContext): Promise<AssetFileRevealTargetDto[]>;
  assetFileReveal(assetId: string, context?: AssetFileRevealContext): Promise<void>;
  assetFileOpen(assetId: string): Promise<void>;
  assetDelete(assetId: string): Promise<void>;
  favoriteTextsList(): Promise<FavoriteTextMaterialDto[]>;
  favoriteAdd(target: MaterialSelectionTargetInput): Promise<FavoriteAddResult>;
  favoriteRemove(materialId: string): Promise<boolean>;
  imageRatingSet(
    imageAssetId: string,
    dimension: ImageRatingDimension,
    score: number | null,
  ): Promise<ImageRatingDto | null>;
  onCodexGeneratedImagesChanged(callback: () => void): () => void;
  onGenerationChanged(callback: (event: GenerationChangedEvent) => void): () => void;
  onAssistantProgress(callback: (event: AssistantActivityEventDto) => void): () => void;
  onModelWorkerChanged(callback: (status: ModelWorkerStatusDto) => void): () => void;
  onNavigationCommand(callback: (command: NavigationCommand) => void): () => void;
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
