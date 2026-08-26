import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { FileTextIcon, HistoryIcon, ImportIcon, PencilIcon, VideoIcon } from 'lucide-react';
import type {
  AssetDto,
  ArticleContentInput,
  ArticleDto,
  AssistantActivityEventDto,
  AssistantProposalApplyValue,
  AssistantRunDto,
  AssistantWebSearchMode,
  BootstrapDto,
  CanvasPresetDto,
  CreationDictionaryScopeDto,
  CreationDraftDto,
  CreationInputSnapshotDto,
  CreationInputStashDto,
  CreationFormEntityKind,
  CreationItemDto,
  ImageCropInput,
  ImageEditBatchStartInput,
  ImageReframeStartInput,
  ImageTransformOutputDto,
  HistoricalTermRecommendationRunDto,
  ImportedCreationOutputDto,
  InspirationStashContentInput,
  InspirationStashDto,
  KnowledgeDistillationProposalDto,
  CreatorAgentScope,
  CreatorPromptNodeInput,
  DirectionExperimentDelegationInput,
  DirectionProposalDto,
  DerivedVisualDto,
  DerivedVisualWorkspaceOpenResult,
  GenerationInput,
  GenerationTargetInput,
  GenerationVersionInput,
  Locale,
  AlbumDto,
  PromptSeriesDto,
  PromptVersionCreateResult,
  PromptVersionDto,
  SocialPostContentInput,
  SocialPostDto,
  StyleExplorationSlotDto,
  TermListItem,
  VideoDocumentDto,
  VideoDocumentSummaryDto,
  WordPaletteDto,
} from '@/shared/contracts';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import { fallbackTitleSuggestion } from '@/shared/title-fallback';
import { termFacetValueIds } from '@/shared/term-localization';
import { CODEX_APP_SERVER_PROVIDER_KEY, CODEX_CLI_PROVIDER_KEY } from '@/shared/extension-ids';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';
import { DictionaryIcon, ImageIcon } from '@/renderer/icons';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { CreateAlbumDialog } from '@/renderer/components/albums/CreateAlbumDialog';
import { AlbumCreationDefaultsDialog } from '@/renderer/components/albums/AlbumCreationDefaultsDialog';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { SearchableAlbumSelect } from '@/renderer/components/albums/SearchableAlbumSelect';
import {
  useContentLifecycleActions,
  type ContentLifecycleActionRequest,
} from '@/renderer/components/albums/useContentLifecycleActions';
import {
  navigationLocationKey,
  type CreatorLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { CanvasPresetPicker } from '@/renderer/components/creator/CanvasPresetPicker';
import { CreationMaterialPicker } from '@/renderer/components/creator/CreationMaterialPicker';
import { CreationReferenceStrip } from '@/renderer/components/creator/CreationReferenceStrip';
import { CreationInputStashDialog } from '@/renderer/components/creator/CreationInputStashDialog';
import {
  readCreationLibraryFilter,
  writeCreationLibraryFilter,
  type CreationLibraryFilter,
} from '@/renderer/components/creator/creationLibraryFilter';
import {
  readCreationStartMode,
  writeCreationStartMode,
  type CreationStartMode,
} from '@/renderer/components/creator/creationStartMode';
import { CreatorAlbumDetail } from '@/renderer/components/creator/CreatorAlbumDetail';
import { DictionaryPicker } from '@/renderer/components/creator/DictionaryPicker';
import { DerivedVisualWorkbench } from '@/renderer/components/creator/DerivedVisualWorkbench';
import { generationReadiness } from '@/renderer/components/creator/generationReadiness';
import {
  initialGenerationTargets,
  latestVersionGenerationRun,
  latestVersionGenerationTargets,
} from '@/renderer/components/creator/generationTargetDefaults';
import { GenerationTaskTray } from '@/renderer/components/creator/GenerationTaskTray';
import {
  imageImportItems,
  isEditableTarget,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';
import { ImageImportPreviewDialog } from '@/renderer/components/creator/ImageImportPreviewDialog';
import { useCreatorTermSearch } from '@/renderer/components/creator/useCreatorTermSearch';
import { useCreatorOutputImport } from '@/renderer/components/creator/useCreatorOutputImport';
import { CreatorRecordPanel } from '@/renderer/components/creator/CreatorAssistantOutputPanel';
import { CreatorInputPanel } from '@/renderer/components/creator/CreatorInputPanel';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { MinimalCreationStarter } from '@/renderer/components/creator/MinimalCreationStarter';
import type { CreatorPromptComposerHandle } from '@/renderer/components/creator/CreatorPromptComposer';
import { articleMarkdownFromPlainText } from '@/renderer/components/creator/articleMarkdownFromPlainText';
import {
  appendCreatorPromptText,
  creatorPromptNodesFromCommonInput,
  creatorPromptNodesFromReferences,
  creatorPromptText,
  normalizeCreatorPromptNodes,
  reconcileCreatorPromptNodesWithReferences,
  replaceCreatorPromptText,
} from '@/renderer/components/creator/creatorPromptDocument';
import {
  NewExternalCreationDialog,
  type NewExternalCreationDialogValue,
} from '@/renderer/components/creator/NewExternalCreationDialog';
import { KnowledgeDistillationDialog } from '@/renderer/components/creator/KnowledgeDistillationDialog';
import { OutputInspector } from '@/renderer/components/creator/OutputInspector';
import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import { RenameAlbumDialog } from '@/renderer/components/creator/RenameAlbumDialog';
import { RenameArticleDialog } from '@/renderer/components/creator/RenameArticleDialog';
import { RenameSeriesDialog } from '@/renderer/components/creator/RenameSeriesDialog';
import { ResultLibrary, type ResultLibrarySurface } from '@/renderer/components/creator/ResultLibrary';
import { StyleExplorationDialog } from '@/renderer/components/creator/StyleExplorationDialog';
import { StyleExplorationPanel } from '@/renderer/components/creator/StyleExplorationPanel';
import { buildStyleExplorationStartInput } from '@/renderer/components/creator/styleExploration';
import {
  buildCreatorAssistPromptNodes,
  rankPromptDraftTermCandidates,
} from '@/renderer/components/creator/promptDraftCandidates';
import {
  buildCreationSessionProjection,
  type CreationSessionProjection,
} from '@/renderer/components/creator/creationSessionProjection';
import { creationExperimentContextForSeries } from '@/renderer/components/creator/creationExperimentContext';
import { assistantRunHistory, directionCoverageMemory } from '@/renderer/components/creator/assistantRunHistory';
import { buildCreationOutputProjection } from '@/renderer/components/creator/creationOutputProjection';
import { useCreatorPanes } from '@/renderer/components/creator/useCreatorPanes';
import { CreationOutputTabs, type CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import type { CreationOutcomePlan } from '@/renderer/components/creator/CreationOutcomePicker';
import { SocialPostEditor } from '@/renderer/components/creator/SocialPostEditor';
import { ArticleEditor } from '@/renderer/components/creator/ArticleEditor';
import {
  buildArticleHeaderPrompt,
  buildArticleInlinePrompt,
  buildSocialCoverPrompt,
} from '@/renderer/components/creator/derivedVisualPrompt';
import type { CreationAssistantMode } from '@/renderer/components/creator/CreationCollaborationPanel';
import {
  allAssets,
  appliedWordPalettesFromReferences,
  buildCreatorAssistContext,
  buildCreatorAssistantContextKey,
  creationDiffSummary,
  creatorAssistantTermInput,
  creatorInputMatchesVersion,
  resolveCreatorPrompt,
  type AppliedWordPalette,
} from '@/renderer/components/creator/utils';
import { ApplyWordPaletteDialog } from '@/renderer/components/palette/ApplyWordPaletteDialog';
import { SaveWordPaletteDialog } from '@/renderer/components/palette/SaveWordPaletteDialog';
import { WordPaletteDetailsDialog } from '@/renderer/components/palette/WordPaletteDetailsDialog';
import { Button } from '@/renderer/components/ui/button';
import { Combobox } from '@/renderer/components/ui/combobox';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { createSerialTaskQueue } from '@/renderer/lib/serialTaskQueue';
import { generationReEditLocation } from '@/renderer/features/ai-center/generationReEditNavigation';
import {
  VideoDocumentCreationStarter,
  type VideoDocumentCreationRequest,
} from '@/renderer/features/video-documents/VideoDocumentCreationStarter';
import { VideoFileInput } from '@/renderer/features/video-documents/VideoDocumentFileInputs';
import { VideoDocumentRenameDialog } from '@/renderer/features/video-documents/VideoDocumentRenameDialog';
import { materialTitle, type MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';

interface Props {
  data: BootstrapDto;
  dataRevision: number;
  locale: Locale;
  defaultPromptLocale: Locale | null;
  active: boolean;
  creationLibraryActive: boolean;
  location: CreatorLocation;
  comparisonFullWindow: boolean;
  promptFullWindow: boolean;
  documentWorkspace: ReactNode | null;
  documentWorkspaceActive: boolean;
  selectedDocumentId: string | null;
  selectedDocumentAlbumId: string | null;
  documentNavigationRevision: number;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onDocumentsChange(document: VideoDocumentDto, collectionChanged: boolean): void;
  onNavigate(location: CreatorLocation, mode?: NavigationMode): void;
  onComparisonFullWindowChange(open: boolean): void;
  onPromptFullWindowChange(open: boolean): void;
  onOpenMaterial(materialId: string): void;
  onConfigureExtension(extensionId: string): void;
  onActiveAlbumChange(albumId: string | null): void;
  refresh(): Promise<void>;
  refreshAlbums(): Promise<void>;
  onTermDetailsRequest?(): Promise<void>;
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  notify(message: string): void;
}

type CreationMode = 'existing' | 'new';

interface PendingAutoTitle {
  runId: string;
  seriesId: string;
  prompt: string;
  initialTitle: string;
}

function creatorMaterialLifecycleTarget(item: MaterialLibraryItem) {
  if (item.kind === 'TEXT') return { entityType: 'MATERIAL' as const, entityId: item.text.id };
  return item.image.materialId
    ? { entityType: 'MATERIAL' as const, entityId: item.image.materialId }
    : { entityType: 'IMAGE_ASSET' as const, entityId: item.image.asset.id };
}

interface CreationMaterialsSnapshot {
  referenceAssets: AssetDto[];
  selectedTerms: TermListItem[];
  appliedPalettes: AppliedWordPalette[];
  termPromptLocale: Locale;
}

function articleImageExtension(asset: AssetDto) {
  if (asset.mimeType === 'image/png') return 'png';
  if (asset.mimeType === 'image/webp') return 'webp';
  if (asset.mimeType === 'image/svg+xml') return 'svg';
  return 'jpg';
}

function articleMediaBindings(assets: readonly AssetDto[], prefix: 'reference' | 'post') {
  return assets.map((asset, index) => ({
    path: `assets/${prefix}-${index + 1}-${asset.id}.${articleImageExtension(asset)}`,
    assetId: asset.id,
  }));
}

function markdownWithImages(body: string, bindings: readonly { path: string }[], locale: Locale) {
  const imageMarkdown = bindings
    .map((binding, index) => `![${locale === 'zh' ? '图片' : 'Image'} ${index + 1}](${binding.path})`)
    .join('\n\n');
  return [articleMarkdownFromPlainText(body), imageMarkdown].filter(Boolean).join('\n\n');
}

function socialPostBodyFromMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/gu, '\n')
    .replace(/!\[[^\]]*\]\([^\r\n)]*\)/gu, '')
    .trim();
}

function commitGeneratedImageLocation(
  keepEditorOpen: boolean,
  seriesId: string,
  versionId: string,
  commit: (location: CreatorLocation, mode: NavigationMode) => void,
) {
  if (keepEditorOpen) return;
  commit({ surface: 'existing-creation', seriesId, assetId: null, versionId }, 'replace');
}

function derivedVisualWorkspaceAvailable(visual: DerivedVisualDto, data: BootstrapDto) {
  return visual.promptSeriesId
    ? data.series.some((series) => series.id === visual.promptSeriesId)
    : data.creationDraft?.id === visual.creationDraftId;
}

function defaultStandaloneCreationSeriesId(data: BootstrapDto, sessions: readonly CreationSessionProjection[]) {
  const derivedSeriesIds = new Set(
    (data.derivedVisuals ?? []).flatMap((visual) => (visual.promptSeriesId ? [visual.promptSeriesId] : [])),
  );
  return (
    sessions.find((session) => session.memberSeries.every((series) => !derivedSeriesIds.has(series.id)))?.primarySeries
      .id ?? null
  );
}

function defaultStandaloneCreationDraft(data: BootstrapDto) {
  const draft = data.creationDraft;
  if (!draft) return null;
  return (data.derivedVisuals ?? []).some((visual) => visual.creationDraftId === draft.id) ? null : draft;
}

function creationItemByFormEntity(
  creationItems: readonly CreationItemDto[],
  kind: CreationFormEntityKind,
  entityId: string,
) {
  return (
    creationItems.find((item) => item.forms.some((form) => form.entity.kind === kind && form.entity.id === entityId)) ??
    null
  );
}

function imageSeriesIdForCreationItem(item: CreationItemDto | null) {
  const imageForm = item?.forms.find((form) => form.role === 'IMAGE_CREATION');
  return imageForm?.entity.kind === 'PROMPT_SERIES' ? imageForm.entity.id : null;
}

function defaultDerivedDraftParentLocation(data: BootstrapDto): CreatorLocation | null {
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

interface CapturedCreatorPrompt {
  nodes: CreatorPromptNodeInput[];
  manualPrompt: string;
  selectedTerms: TermListItem[];
  appliedPalettes: AppliedWordPalette[];
}

interface NewExternalCreationDialogState {
  albumId: string | null;
}

type DictionaryFocusTarget = { kind: 'term' | 'palette'; id: string } | null;

const activeWordPalettes = (palettes: WordPaletteDto[]) => palettes.filter((palette) => palette.status === 'ACTIVE');

export function CreatorScreen({
  data,
  dataRevision,
  locale,
  defaultPromptLocale,
  active,
  creationLibraryActive,
  location,
  comparisonFullWindow,
  promptFullWindow,
  documentWorkspace,
  documentWorkspaceActive,
  selectedDocumentId,
  selectedDocumentAlbumId,
  documentNavigationRevision,
  onSelectDocument,
  onDocumentsChange,
  onNavigate,
  onComparisonFullWindowChange,
  onPromptFullWindowChange,
  onOpenMaterial,
  onConfigureExtension,
  onActiveAlbumChange,
  refresh,
  refreshAlbums,
  onTermDetailsRequest,
  onImportedOutputSaved,
  notify,
}: Props) {
  const { messages } = useI18n();
  const c = messages.creator.workbench;
  const locationKey = navigationLocationKey(location);
  const appliedLocationKeyRef = useRef(
    location.surface === 'inspiration-stash' || location.surface === 'social-post' || location.surface === 'article'
      ? ''
      : locationKey,
  );
  const creationSessions = useMemo(
    () => buildCreationSessionProjection(data.series, data.styleExplorationBatches),
    [data.series, data.styleExplorationBatches],
  );
  const initialInspirationStash =
    location.surface === 'inspiration-stash'
      ? (data.inspirationStashes ?? []).find((stash) => stash.id === location.stashId)
      : undefined;
  const initialInspirationItem = initialInspirationStash
    ? creationItemByFormEntity(data.creationItems, 'INSPIRATION_STASH', initialInspirationStash.id)
    : null;
  const initialInspirationSeriesId = imageSeriesIdForCreationItem(initialInspirationItem);
  const initialSocialPost =
    location.surface === 'social-post'
      ? (data.socialPosts ?? []).find((post) => post.id === location.postId)
      : undefined;
  const initialArticle =
    location.surface === 'article'
      ? (data.articles ?? []).find((article) => article.id === location.articleId)
      : undefined;
  const resumableDerivedVisual = (data.derivedVisuals ?? []).find(
    (visual) =>
      visual.adoptedAt === null &&
      ((initialArticle && visual.articleId === initialArticle.id) ||
        (initialSocialPost && visual.socialPostId === initialSocialPost.id)) &&
      ((visual.promptSeriesId && data.series.some((series) => series.id === visual.promptSeriesId)) ||
        data.creationDraft?.id === visual.creationDraftId),
  );
  const resumableDerivedSeriesId = resumableDerivedVisual?.promptSeriesId ?? null;
  const resumableDerivedDraft =
    !resumableDerivedSeriesId && data.creationDraft?.id === resumableDerivedVisual?.creationDraftId
      ? data.creationDraft
      : null;
  const standaloneInitialSeriesId = defaultStandaloneCreationSeriesId(data, creationSessions);
  const standaloneInitialDraft = defaultStandaloneCreationDraft(data);
  const derivedDraftParentLocation = defaultDerivedDraftParentLocation(data);
  const initialCreationMode: CreationMode =
    location.surface === 'new-creation'
      ? 'new'
      : location.surface === 'existing-creation'
        ? 'existing'
        : resumableDerivedSeriesId
          ? 'existing'
          : initialSocialPost || initialArticle
            ? 'new'
            : initialInspirationStash
              ? initialInspirationSeriesId
                ? 'existing'
                : 'new'
              : standaloneInitialDraft
                ? 'new'
                : standaloneInitialSeriesId
                  ? 'existing'
                  : 'new';
  const initialDraft =
    resumableDerivedDraft ??
    (initialCreationMode === 'new' && !initialSocialPost && !initialArticle ? standaloneInitialDraft : null);
  const initialSeriesId =
    resumableDerivedSeriesId ??
    (initialSocialPost || initialArticle
      ? null
      : location.surface === 'existing-creation'
        ? location.seriesId
        : initialInspirationSeriesId
          ? initialInspirationSeriesId
          : initialDraft
            ? null
            : standaloneInitialSeriesId);
  const initialAssistantRun =
    data.assistantRuns.find(
      (run) =>
        !run.dismissedAt &&
        run.proposal?.status !== 'CLOSED' &&
        (initialCreationMode === 'new'
          ? run.scope.kind === 'DRAFT' && run.scope.id === initialDraft?.id
          : run.scope.kind === 'SERIES' && run.scope.id === initialSeriesId),
    ) ?? null;
  const [creationMode, setCreationMode] = useState<CreationMode>(initialCreationMode);
  const [creationStartMode, setCreationStartMode] = useState<CreationStartMode>(readCreationStartMode);
  const [videoCreationRequest, setVideoCreationRequest] = useState<VideoDocumentCreationRequest | null>(null);
  const [creationLibraryFilter, setCreationLibraryFilter] = useState<CreationLibraryFilter>(readCreationLibraryFilter);
  useEffect(() => {
    writeCreationLibraryFilter(creationLibraryFilter);
  }, [creationLibraryFilter]);
  useEffect(() => {
    if (documentWorkspaceActive && !creationLibraryFilter.documents) {
      setCreationLibraryFilter((current) => ({ ...current, documents: true }));
    }
  }, [creationLibraryFilter.documents, documentWorkspaceActive]);
  const [seriesId, setSeriesId] = useState<string | null>(initialSeriesId);
  const [selectedInspirationStashId, setSelectedInspirationStashId] = useState<string | null>(
    location.surface === 'inspiration-stash' ? location.stashId : null,
  );
  const selectedInspirationStash =
    (data.inspirationStashes ?? []).find((stash) => stash.id === selectedInspirationStashId) ?? null;
  const [selectedSocialPostId, setSelectedSocialPostId] = useState<string | null>(
    location.surface === 'social-post' ? location.postId : null,
  );
  const selectedSocialPost = (data.socialPosts ?? []).find((post) => post.id === selectedSocialPostId) ?? null;
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    location.surface === 'article' ? location.articleId : null,
  );
  const selectedArticle = (data.articles ?? []).find((article) => article.id === selectedArticleId) ?? null;
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(
    location.surface === 'album-detail' ? location.albumId : null,
  );
  const selectedAlbum = data.albums.find((album) => album.id === selectedAlbumId) ?? null;
  const [selectedIdeaCreationId, setSelectedIdeaCreationId] = useState<string | null>(
    location.surface === 'idea-creation' ? location.creationId : null,
  );
  const [outputMode, setOutputMode] = useState<CreationOutputMode>(
    location.surface === 'idea-creation' ? 'records' : 'results',
  );
  const selectedIdeaCreation =
    (data.creations ?? []).find((creation) => creation.id === selectedIdeaCreationId) ?? null;
  const [targetAlbumId, setTargetAlbumId] = useState<string | null>(
    location.surface === 'new-creation'
      ? location.albumId
      : (initialInspirationItem?.albumId ?? initialInspirationStash?.albumId ?? initialDraft?.targetAlbumId ?? null),
  );
  const targetAlbum = data.albums.find((album) => album.id === targetAlbumId) ?? null;
  const albumTree = useMemo(() => buildAlbumTreeIndex(data.albums), [data.albums]);
  const targetAlbumUnavailable = Boolean(
    targetAlbumId && (!targetAlbum || albumTree.effectivelyArchived.has(targetAlbumId)),
  );
  const [creationDraftId, setCreationDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const creationDraftIdRef = useRef(initialDraft?.id ?? null);
  const draftSavePromiseRef = useRef<Promise<CreationDraftDto> | null>(null);
  const savedDraftRef = useRef(initialDraft);
  const draftAutosaveEpochRef = useRef(0);
  const [inputSessionRevision, setInputSessionRevision] = useState(0);
  const series = creationMode === 'existing' ? data.series.find((item) => item.id === seriesId) : undefined;
  const seriesAlbumId =
    data.creationItems.find((item) =>
      item.forms.some((form) => form.entity.kind === 'PROMPT_SERIES' && form.entity.id === seriesId),
    )?.albumId ?? null;
  const activeAlbumContextId = selectedSocialPostId
    ? (selectedSocialPost?.albumId ?? null)
    : selectedArticleId
      ? (selectedArticle?.albumId ?? null)
      : selectedIdeaCreationId
        ? null
        : (selectedAlbumId ?? (creationMode === 'new' ? targetAlbumId : seriesAlbumId));
  const activeCreationSession = series
    ? creationSessions.find((session) => session.memberSeries.some((item) => item.id === series.id))
    : undefined;
  const sessionHostSeries = activeCreationSession?.primarySeries ?? series;
  const projectIdeaCreation =
    sessionHostSeries == null
      ? null
      : ((data.creations ?? []).find(
          (creation) =>
            creation.status !== 'ARCHIVED' &&
            creation.sourceScope.kind === 'SERIES' &&
            creation.sourceScope.id === sessionHostSeries.id,
        ) ?? null);
  const assistantScope = useMemo<CreatorAgentScope | null>(
    () =>
      selectedSocialPostId || selectedArticleId
        ? null
        : creationMode === 'existing' && sessionHostSeries
          ? { kind: 'SERIES', id: sessionHostSeries.id }
          : creationDraftId
            ? { kind: 'DRAFT', id: creationDraftId }
            : null,
    [creationDraftId, creationMode, selectedArticleId, selectedSocialPostId, sessionHostSeries],
  );
  const viewingExperimentBranch = Boolean(series && sessionHostSeries && series.id !== sessionHostSeries.id);
  const [outputSeriesId, setOutputSeriesId] = useState<string | null>(seriesId);
  const outputSeries = data.series.find((item) => item.id === outputSeriesId);
  const draftDerivedVisual =
    (data.derivedVisuals ?? []).find((visual) => visual.creationDraftId === creationDraftId) ?? null;
  const seriesDerivedVisual = (data.derivedVisuals ?? []).find((visual) => visual.promptSeriesId === seriesId) ?? null;
  const outputDerivedVisual =
    (data.derivedVisuals ?? []).find((visual) => visual.promptSeriesId === outputSeries?.id) ?? null;
  const socialCoverWorkspace = selectedSocialPost
    ? ((data.derivedVisuals ?? []).find(
        (visual) =>
          visual.role === 'SOCIAL_POST_COVER' &&
          visual.socialPostId === selectedSocialPost.id &&
          derivedVisualWorkspaceAvailable(visual, data),
      ) ?? null)
    : null;
  const socialCoverWorkspaceExists = Boolean(socialCoverWorkspace);
  const articleHeaderWorkspace = selectedArticle
    ? ((data.derivedVisuals ?? []).find(
        (visual) =>
          visual.role === 'ARTICLE_HEADER' &&
          visual.articleId === selectedArticle.id &&
          derivedVisualWorkspaceAvailable(visual, data),
      ) ?? null)
    : null;
  const articleHeaderWorkspaceExists = Boolean(articleHeaderWorkspace);
  const activeDerivedVisual = creationMode === 'new' ? draftDerivedVisual : seriesDerivedVisual;
  const [dismissedDerivedVisualId, setDismissedDerivedVisualId] = useState<string | null>(null);
  const editorDerivedVisual =
    activeDerivedVisual &&
    activeDerivedVisual.id !== dismissedDerivedVisualId &&
    ((selectedArticle && activeDerivedVisual.articleId === selectedArticle.id) ||
      (selectedSocialPost && activeDerivedVisual.socialPostId === selectedSocialPost.id))
      ? activeDerivedVisual
      : null;
  const outputCreationSession = outputSeries
    ? creationSessions.find((session) => session.memberSeries.some((item) => item.id === outputSeries.id))
    : undefined;
  const outputPrimarySeries = outputCreationSession?.primarySeries ?? outputSeries;
  const outputProjection = useMemo(
    () =>
      outputPrimarySeries
        ? buildCreationOutputProjection(outputPrimarySeries, data.series, data.styleExplorationBatches)
        : [],
    [data.series, data.styleExplorationBatches, outputPrimarySeries],
  );
  const seriesExperimentContext = useMemo(
    () => creationExperimentContextForSeries(series?.id, data.series, data.styleExplorationBatches),
    [data.series, data.styleExplorationBatches, series?.id],
  );
  const initialVersionId =
    location.surface === 'existing-creation' &&
    location.seriesId === series?.id &&
    location.versionId &&
    series.versions.some((item) => item.id === location.versionId)
      ? location.versionId
      : (series?.currentVersionId ?? '');
  const [versionId, setVersionId] = useState(initialVersionId);
  const version = series?.versions.find((item) => item.id === versionId);
  const restoredVersionIdRef = useRef<string | null>(null);
  const [hydratedVersionId, setHydratedVersionId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState(() => initialDraft?.title ?? '');
  const initialManualPrompt = initialDraft?.text ?? version?.manualPrompt ?? series?.versions[0]?.manualPrompt ?? '';
  const initialTermIds = initialDraft?.termIds ?? version?.termIds ?? series?.versions[0]?.termIds ?? [];
  const initialWordPaletteReferences =
    initialDraft?.wordPaletteReferences ??
    version?.wordPaletteReferences ??
    series?.versions[0]?.wordPaletteReferences ??
    [];
  const initialPromptNodes = creatorPromptNodesFromReferences({
    manualPrompt: initialManualPrompt,
    termIds: initialTermIds,
    wordPaletteReferences: initialWordPaletteReferences,
    nodes:
      initialDraft?.promptNodes ??
      creatorPromptNodesFromCommonInput(
        version?.promptInputSnapshot.commonInput ?? series?.versions[0]?.promptInputSnapshot.commonInput,
      ),
  });
  const [manualPrompt, setManualPrompt] = useState(initialManualPrompt);
  const [promptNodes, setPromptNodes] = useState<CreatorPromptNodeInput[]>(initialPromptNodes);
  const promptComposerRef = useRef<CreatorPromptComposerHandle>(null);
  const newCreationVideoInputRef = useRef<HTMLInputElement>(null);
  const [referenceAssets, setReferenceAssets] = useState<AssetDto[]>(initialDraft?.referenceAssets ?? []);
  const [selectedTerms, setSelectedTerms] = useState<TermListItem[]>(() =>
    initialTermIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []),
  );
  const [termPromptLocale, setTermPromptLocale] = useState<Locale>(
    initialDraft?.termPromptLocale ?? version?.termPromptLocale ?? defaultPromptLocale ?? locale,
  );
  const [wordPalettes, setWordPalettes] = useState(() => activeWordPalettes(data.wordPalettes));
  const [dictionaryScope, setDictionaryScope] = useState<CreationDictionaryScopeDto>(
    initialDraft?.dictionaryScope ?? emptyCreationDictionaryScope(),
  );
  const [scopePaletteRevisionIds, setScopePaletteRevisionIds] = useState<string[]>([]);
  const [appliedPalettes, setAppliedPalettes] = useState<AppliedWordPalette[]>(() =>
    appliedWordPalettesFromReferences(data.wordPalettes, initialWordPaletteReferences),
  );
  const promptNodesRef = useRef(promptNodes);
  const appliedPaletteCacheRef = useRef<Map<string, AppliedWordPalette>>(
    new Map(appliedPalettes.map((reference) => [reference.palette.id, reference])),
  );
  const materialsRef = useRef<CreationMaterialsSnapshot>({
    referenceAssets,
    selectedTerms,
    appliedPalettes,
    termPromptLocale,
  });
  const materialsUndoRef = useRef<CreationMaterialsSnapshot[]>([]);
  promptNodesRef.current = promptNodes;
  for (const reference of appliedPalettes) appliedPaletteCacheRef.current.set(reference.palette.id, reference);
  materialsRef.current = { referenceAssets, selectedTerms, appliedPalettes, termPromptLocale };
  const [paletteToApply, setPaletteToApply] = useState<WordPaletteDto | null>(null);
  const [paletteInspector, setPaletteInspector] = useState<{
    mode: 'view' | 'edit';
    palette: WordPaletteDto;
  } | null>(null);
  const pendingRecipeInsertPositionRef = useRef<number | null>(null);
  const paletteDialogFrameRef = useRef<number | null>(null);
  const dictionaryHandoffFrameRef = useRef<number | null>(null);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [dictionaryFocusTarget, setDictionaryFocusTarget] = useState<DictionaryFocusTarget>(null);
  const [historicalTermRecommendationRuns, setHistoricalTermRecommendationRuns] = useState<
    HistoricalTermRecommendationRunDto[]
  >([]);
  const [historicalTermRecommendationBusy, setHistoricalTermRecommendationBusy] = useState(false);
  const [minimalAssistantRun, setMinimalAssistantRun] = useState<AssistantRunDto | null>(initialAssistantRun);
  const [minimalAssistantBusy, setMinimalAssistantBusy] = useState(false);
  const [minimalAssistantMode, setMinimalAssistantMode] = useState<CreationAssistantMode | null>(null);
  const [minimalAssistantError, setMinimalAssistantError] = useState('');
  const [minimalAssistantProgressEvents, setMinimalAssistantProgressEvents] = useState<AssistantActivityEventDto[]>(
    initialAssistantRun?.activityEvents ?? [],
  );
  const [pendingExperimentDirections, setPendingExperimentDirections] = useState<DirectionProposalDto[]>([]);
  const [pendingExperimentAssistantRun, setPendingExperimentAssistantRun] = useState<AssistantRunDto | null>(null);
  const [explorationDialogOpen, setExplorationDialogOpen] = useState(false);
  const [explorationStarting, setExplorationStarting] = useState(false);
  const [explorationError, setExplorationError] = useState('');
  const [stoppingExplorationIds, setStoppingExplorationIds] = useState<string[]>([]);
  const [retryingExplorationSlotIds, setRetryingExplorationSlotIds] = useState<string[]>([]);
  const [proposingAdjacentSlotIds, setProposingAdjacentSlotIds] = useState<string[]>([]);
  const [distillationAssetId, setDistillationAssetId] = useState<string | null>(null);
  const [distillationProposals, setDistillationProposals] = useState<KnowledgeDistillationProposalDto[]>([]);
  const [distillationDialogOpen, setDistillationDialogOpen] = useState(false);
  const [distillingAssetId, setDistillingAssetId] = useState<string | null>(null);
  const [acceptingDistillationProposalId, setAcceptingDistillationProposalId] = useState<string | null>(null);
  const [distillationError, setDistillationError] = useState('');
  const [distilledPaletteToEdit, setDistilledPaletteToEdit] = useState<WordPaletteDto | null>(null);
  const minimalAssistantRequestRevision = useRef(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameAlbum, setRenameAlbum] = useState<AlbumDto | null>(null);
  const [renameArticle, setRenameArticle] = useState<ArticleDto | null>(null);
  const [renameDocument, setRenameDocument] = useState<VideoDocumentSummaryDto | null>(null);
  const [settingsAlbum, setSettingsAlbum] = useState<AlbumDto | null>(null);
  const [createAlbumRequest, setCreateAlbumRequest] = useState<{
    parent: AlbumDto | null;
    destination: 'LIBRARY' | 'NEW_CREATION';
  } | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [albumMoveQueue] = useState(createSerialTaskQueue);
  const contentLifecycleActions = useContentLifecycleActions({
    notify,
    onApplied: finishContentLifecycleAction,
  });
  const lifecycleActionBusy = lifecycleBusy || contentLifecycleActions.busy;
  const [requestedAssetId, setRequestedAssetId] = useState<string | null>(
    location.surface === 'existing-creation' ? location.assetId : null,
  );
  const [annotationRefinementState, setAnnotationRefinementState] = useState<AnnotationRefinementState | null>(null);
  const [outputGalleryOpen, setOutputGalleryOpen] = useState(false);
  const [health, setHealth] = useState(data.codex);
  const [starting, setStarting] = useState(false);
  const [versionCreating, setVersionCreating] = useState(false);
  const [referenceImporting, setReferenceImporting] = useState(false);
  const [newExternalCreationDialog, setNewExternalCreationDialog] = useState<NewExternalCreationDialogState | null>(
    null,
  );
  const [inputStashDialogOpen, setInputStashDialogOpen] = useState(false);
  const [inputStashes, setInputStashes] = useState<CreationInputStashDto[]>([]);
  const [inputStashBusy, setInputStashBusy] = useState(false);
  const [inspirationStashBusy, setInspirationStashBusy] = useState(false);
  const [savedInspirationContentKey, setSavedInspirationContentKey] = useState<string | null>(null);
  const [pendingAutoTitle, setPendingAutoTitle] = useState<PendingAutoTitle | null>(null);
  const initialAssistantGenerationTargets =
    initialAssistantRun?.proposal && ['READY', 'ADOPTED'].includes(initialAssistantRun.proposal.status)
      ? initialAssistantRun.input.generationTargets
      : [];
  const initialGenerationTargetHint = initialAssistantGenerationTargets.length
    ? initialAssistantGenerationTargets
    : latestVersionGenerationTargets(version, series?.versions ?? []);
  const [generationTargets, setGenerationTargets] = useState<GenerationTargetInput[]>(() =>
    initialGenerationTargets(
      {
        creationDraft: initialDraft,
        imageGenerationRoutes: data.imageGenerationRoutes,
      },
      initialGenerationTargetHint,
    ),
  );
  const [canvasPresetKey, setCanvasPresetKey] = useState(initialDraft?.canvasPresetKey ?? '');
  const canvasPreset = data.canvasPresets.find((preset) => preset.stableKey === canvasPresetKey);
  const imageGenerationRoutes = useMemo(
    () =>
      data.imageGenerationRoutes.map((model) =>
        model.providerKey === CODEX_APP_SERVER_PROVIDER_KEY || model.providerKey === CODEX_CLI_PROVIDER_KEY
          ? { ...model, state: health.state === 'ready' ? ('READY' as const) : ('UNAVAILABLE' as const) }
          : model,
      ),
    [data.imageGenerationRoutes, health.state],
  );
  const selectedModelKeys = useMemo(() => generationTargets.map((target) => target.modelKey), [generationTargets]);
  const promptProfileId = useMemo(() => {
    const selectedRoute = imageGenerationRoutes.find((route) => route.key === generationTargets[0]?.modelKey);
    return imageGenerationPromptProfileId(selectedRoute);
  }, [generationTargets, imageGenerationRoutes]);
  const dictionaryPackReleaseIds = useMemo(
    () => dictionaryScope.sources.map((source) => source.packReleaseId),
    [dictionaryScope.sources],
  );
  const {
    query: termQuery,
    setQuery: setTermQuery,
    results: termResults,
  } = useCreatorTermSearch({
    active,
    locale,
    initialTerms: data.terms,
    dictionaryScope,
    packReleaseIds: dictionaryPackReleaseIds,
    loadFailedMessage: messages.dictionary.editor.loadFailed,
    notify,
  });
  const outputImport = useCreatorOutputImport({
    createContext: creatorImportContext,
    defaultPromptVersionId: creationMode === 'existing' ? (version?.id ?? null) : null,
    applyImportedOutputs,
    refresh,
    notify,
    messages: {
      importFailed: c.importFailed,
      imported: c.imported,
      duplicates: c.duplicates,
      tooManyImages: c.importDraftLimit,
    },
  });
  const scopedWordPalettes = useMemo(
    () =>
      dictionaryScope.mode === 'ALL'
        ? wordPalettes
        : wordPalettes.filter((palette) => scopePaletteRevisionIds.includes(palette.revisionId)),
    [dictionaryScope.mode, scopePaletteRevisionIds, wordPalettes],
  );
  const quality = generationTargets[0]?.quality ?? 'low';
  const repeatCount = generationTargets[0]?.count ?? 1;
  const promptResolution = useMemo(
    () =>
      resolveCreatorPrompt({
        manualPrompt,
        promptNodes,
        selectedTerms,
        appliedPalettes,
        termPromptLocale,
        promptProfileId,
      }),
    [manualPrompt, promptNodes, selectedTerms, appliedPalettes, termPromptLocale, promptProfileId],
  );
  const assistantContextKey = useMemo(
    () =>
      buildCreatorAssistantContextKey({
        resolution: promptResolution,
        referenceAssets,
        canvasPresetKey: canvasPreset?.stableKey ?? null,
        canvasWidth: canvasPreset?.width ?? null,
        canvasHeight: canvasPreset?.height ?? null,
        generationTargets,
      }),
    [
      promptResolution,
      referenceAssets,
      canvasPreset?.stableKey,
      canvasPreset?.width,
      canvasPreset?.height,
      generationTargets,
    ],
  );
  const assistantHistory = useMemo(
    () =>
      assistantScope
        ? assistantRunHistory({
            runs: minimalAssistantRun ? [minimalAssistantRun, ...data.assistantRuns] : data.assistantRuns,
            scope: assistantScope,
            currentContextKey: assistantContextKey,
          })
        : [],
    [assistantContextKey, assistantScope, data.assistantRuns, minimalAssistantRun],
  );
  const assistantProposalSyncReady = Boolean(
    active &&
    data.modelWorker.state === 'CONNECTED' &&
    data.imageGenerationRoutes.length > 0 &&
    generationTargets.length > 0 &&
    generationTargets.every((target) => data.imageGenerationRoutes.some((model) => model.key === target.modelKey)) &&
    (creationMode !== 'existing' || hydratedVersionId === (version?.id ?? null)),
  );
  const expirableAssistantRunIds = useMemo(
    () =>
      assistantHistory
        .filter(
          (run) =>
            run.proposal &&
            !run.input.sourceExperimentSlotId &&
            ['READY', 'ADOPTED'].includes(run.proposal.status) &&
            run.contextKey !== assistantContextKey &&
            run.proposal.adoptedContextKey !== assistantContextKey,
        )
        .map((run) => run.id),
    [assistantContextKey, assistantHistory],
  );
  const revalidatableAssistantRunIds = useMemo(
    () =>
      assistantHistory
        .filter((run) => {
          if (!run.proposal || run.input.sourceExperimentSlotId || run.proposal.status !== 'EXPIRED') return false;
          return run.proposal.adoptedContextKey
            ? run.proposal.adoptedContextKey === assistantContextKey
            : run.contextKey === assistantContextKey;
        })
        .map((run) => run.id),
    [assistantContextKey, assistantHistory],
  );
  const effectiveTerms = promptResolution.effectiveTerms;
  const livePrompt = promptResolution.livePrompt;
  const currentInputSnapshot: CreationInputSnapshotDto = {
    schemaVersion: 1,
    title: creationMode === 'new' ? newTitle : (sessionHostSeries?.title ?? ''),
    manualPrompt,
    promptNodes,
    resolvedPrompt: livePrompt,
    referenceAssetIds: referenceAssets.map((asset) => asset.id),
    referenceAssets,
    termPromptLocale,
    termIds: selectedTerms.map((term) => term.id),
    wordPaletteReferences: appliedPalettes.map((reference) => ({
      paletteId: reference.palette.id,
      paletteRevisionId: reference.revision.id,
      parameterValues: reference.parameterValues,
      promptLocale: reference.promptLocale,
    })),
    dictionaryScope,
    canvasPresetKey: canvasPreset?.stableKey ?? null,
    generationTargets,
  };
  const currentInspirationContent: InspirationStashContentInput = {
    schemaVersion: 1,
    manualPrompt,
    promptNodes,
    referenceAssetIds: referenceAssets.map((asset) => asset.id),
    termPromptLocale,
    termIds: selectedTerms.map((term) => term.id),
    wordPaletteReferences: appliedPalettes.map((reference) => ({
      paletteId: reference.palette.id,
      paletteRevisionId: reference.revision.id,
      parameterValues: reference.parameterValues,
      promptLocale: reference.promptLocale,
    })),
  };
  const currentInspirationContentKey = JSON.stringify(currentInspirationContent);
  const automaticChangeSummary = useMemo(
    () =>
      creationDiffSummary({
        locale,
        previousPrompt: version?.finalPrompt ?? '',
        nextPrompt: livePrompt,
        previousReferenceIds: (version?.referenceAssets ?? []).map((asset) => asset.id),
        nextReferenceIds: referenceAssets.map((asset) => asset.id),
        previousCanvasKey: version?.runs[0]?.canvasPresetKey ?? null,
        nextCanvasKey: canvasPreset?.stableKey ?? null,
        nextCanvasLabel: canvasPreset?.ratio ?? '',
        previousQuality: version?.runs[0]?.quality ?? null,
        nextQuality: quality,
      }),
    [version, livePrompt, locale, referenceAssets, canvasPreset, quality],
  );
  const dictionarySelectionCount =
    effectiveTerms.filter(({ directSource }) => directSource).length + promptResolution.recipeSources.length;
  const generationCount = generationTargets.reduce((total, target) => total + target.count, 0);
  const readiness = useMemo(
    () =>
      generationReadiness({
        prompt: livePrompt,
        routes: imageGenerationRoutes,
        selectedModelKeys,
        referenceCount: referenceAssets.length,
      }),
    [livePrompt, imageGenerationRoutes, selectedModelKeys, referenceAssets.length],
  );
  const activeIdeaCreation = selectedIdeaCreation ?? projectIdeaCreation;
  const showOutputPane =
    !documentWorkspaceActive &&
    (Boolean(editorDerivedVisual) ||
      (!selectedSocialPost &&
        !selectedArticle &&
        (comparisonFullWindow ||
          (!selectedAlbum &&
            ((creationMode === 'existing' && Boolean(outputSeries)) ||
              (outputMode === 'records' && Boolean(activeIdeaCreation || assistantScope)))))));
  const creatorSurface: ResultLibrarySurface = selectedSocialPost
    ? 'social-post'
    : selectedArticle
      ? 'article'
      : selectedIdeaCreation
        ? 'idea-creation'
        : selectedInspirationStash
          ? 'inspiration-stash'
          : selectedAlbum
            ? 'album-detail'
            : creationMode === 'new'
              ? 'new-creation'
              : 'existing-creation';
  const newCreationSurface =
    creationMode === 'new' && !selectedAlbum && !selectedIdeaCreation && !selectedSocialPost && !selectedArticle;
  const ideaAssistantRuns = activeIdeaCreation
    ? data.assistantRuns.filter((run) => run.creationId === activeIdeaCreation.id)
    : assistantHistory.filter((run) => run.mode === 'directions');
  const recordAssistantRuns = [
    ...new Map([...assistantHistory, ...ideaAssistantRuns].map((run) => [run.id, run])).values(),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  // The creation list stays mounted even when empty, so it can offer its empty state and keep the layout stable.
  const panes = useCreatorPanes({
    showResultLibrary: true,
    showOutputInspector: showOutputPane,
    comparisonFullWindow: comparisonFullWindow || promptFullWindow,
  });

  function replaceMaterials(next: CreationMaterialsSnapshot, remember = false) {
    const current = materialsRef.current;
    if (remember) {
      materialsUndoRef.current.push(current);
      if (materialsUndoRef.current.length > 50) materialsUndoRef.current.shift();
    } else {
      materialsUndoRef.current = [];
    }
    for (const reference of next.appliedPalettes) {
      appliedPaletteCacheRef.current.set(reference.palette.id, reference);
    }
    materialsRef.current = next;
    setReferenceAssets(next.referenceAssets);
    setSelectedTerms(next.selectedTerms);
    setAppliedPalettes(next.appliedPalettes);
    setTermPromptLocale(next.termPromptLocale);
  }

  function updateMaterials(update: (current: CreationMaterialsSnapshot) => CreationMaterialsSnapshot) {
    const current = materialsRef.current;
    const next = update(current);
    if (
      next.referenceAssets === current.referenceAssets &&
      next.selectedTerms === current.selectedTerms &&
      next.appliedPalettes === current.appliedPalettes &&
      next.termPromptLocale === current.termPromptLocale
    )
      return;
    replaceMaterials(next, true);
  }

  function updatePromptDocument(nextNodes: CreatorPromptNodeInput[]) {
    const normalized = normalizeCreatorPromptNodes(nextNodes);
    const termIds = normalized.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : []));
    const paletteIds = normalized.flatMap((node) => (node.kind === 'RECIPE' ? [node.paletteId] : []));
    const current = materialsRef.current;
    const availablePalettes = new Map(appliedPaletteCacheRef.current);
    for (const reference of current.appliedPalettes) availablePalettes.set(reference.palette.id, reference);
    const nextMaterials: CreationMaterialsSnapshot = {
      ...current,
      selectedTerms: termIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []),
      appliedPalettes: paletteIds.flatMap((paletteId) => availablePalettes.get(paletteId) ?? []),
    };
    materialsRef.current = nextMaterials;
    promptNodesRef.current = normalized;
    setPromptNodes(normalized);
    setManualPrompt(creatorPromptText(normalized));
    setSelectedTerms(nextMaterials.selectedTerms);
    setAppliedPalettes(nextMaterials.appliedPalettes);
  }

  function captureVisiblePrompt(): CapturedCreatorPrompt {
    const nodes = normalizeCreatorPromptNodes(promptComposerRef.current?.getNodes() ?? promptNodesRef.current);
    const termIds = nodes.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : []));
    const paletteIds = nodes.flatMap((node) => (node.kind === 'RECIPE' ? [node.paletteId] : []));
    const capturedTerms = termIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []);
    if (capturedTerms.length !== termIds.length) {
      throw new Error(
        locale === 'zh' ? '有词条已不可用，请移除后重试' : 'A term is unavailable. Remove it and try again.',
      );
    }

    const availablePalettes = new Map<string, AppliedWordPalette>();
    const remember = (references: readonly AppliedWordPalette[]) => {
      for (const reference of references) availablePalettes.set(reference.palette.id, reference);
    };
    remember(appliedWordPalettesFromReferences(data.wordPalettes, version?.wordPaletteReferences ?? []));
    remember(appliedWordPalettesFromReferences(data.wordPalettes, savedDraftRef.current?.wordPaletteReferences ?? []));
    remember([...appliedPaletteCacheRef.current.values()]);
    remember(materialsRef.current.appliedPalettes);
    const capturedPalettes = paletteIds.flatMap((paletteId) => availablePalettes.get(paletteId) ?? []);
    if (capturedPalettes.length !== paletteIds.length) {
      const missingId = paletteIds.find((paletteId) => !availablePalettes.has(paletteId));
      const label = data.wordPalettes.find((palette) => palette.id === missingId)?.name ?? missingId ?? '';
      throw new Error(
        locale === 'zh'
          ? `配方“${label}”的配置已失效，请重新应用`
          : `Recipe “${label}” is no longer configured. Apply it again.`,
      );
    }
    return {
      nodes,
      manualPrompt: creatorPromptText(nodes),
      selectedTerms: capturedTerms,
      appliedPalettes: capturedPalettes,
    };
  }

  function synchronizeCapturedPrompt(captured: CapturedCreatorPrompt) {
    for (const reference of captured.appliedPalettes) {
      appliedPaletteCacheRef.current.set(reference.palette.id, reference);
    }
    promptNodesRef.current = captured.nodes;
    materialsRef.current = {
      ...materialsRef.current,
      selectedTerms: captured.selectedTerms,
      appliedPalettes: captured.appliedPalettes,
    };
    setPromptNodes(captured.nodes);
    setManualPrompt(captured.manualPrompt);
    setSelectedTerms(captured.selectedTerms);
    setAppliedPalettes(captured.appliedPalettes);
  }

  function appendPromptText(value: string) {
    updatePromptDocument(appendCreatorPromptText(promptNodes, value));
  }

  useEffect(() => {
    if (!active) return;
    function undoMaterials(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(event.target)) return;
      const previous = materialsUndoRef.current.pop();
      if (!previous) return;
      event.preventDefault();
      const nextPromptNodes = reconcileCreatorPromptNodesWithReferences({
        nodes: promptNodesRef.current,
        termIds: previous.selectedTerms.map((term) => term.id),
        paletteIds: previous.appliedPalettes.map((reference) => reference.palette.id),
      });
      promptNodesRef.current = nextPromptNodes;
      materialsRef.current = previous;
      setPromptNodes(nextPromptNodes);
      setManualPrompt(creatorPromptText(nextPromptNodes));
      setReferenceAssets(previous.referenceAssets);
      setSelectedTerms(previous.selectedTerms);
      setAppliedPalettes(previous.appliedPalettes);
      setTermPromptLocale(previous.termPromptLocale);
    }
    window.addEventListener('keydown', undoMaterials);
    return () => window.removeEventListener('keydown', undoMaterials);
  }, [active]);

  function restoreVersion(next: PromptVersionDto | undefined) {
    restoredVersionIdRef.current = next?.id ?? null;
    setHydratedVersionId(next?.id ?? null);
    if (!next) {
      promptNodesRef.current = [];
      setManualPrompt('');
      setPromptNodes([]);
      setTermPromptLocale(defaultPromptLocale ?? locale);
      replaceMaterials({
        referenceAssets: [],
        selectedTerms: [],
        appliedPalettes: [],
        termPromptLocale: defaultPromptLocale ?? locale,
      });
      setCanvasPresetKey('');
      setGenerationTargets((current) => {
        const defaults = initialGenerationTargets({
          creationDraft: null,
          imageGenerationRoutes: data.imageGenerationRoutes,
        });
        return defaults.length ? defaults : current.map((target) => ({ ...target, quality: 'low' }));
      });
      return;
    }
    const nextPromptNodes = creatorPromptNodesFromReferences({
      manualPrompt: next.manualPrompt,
      termIds: next.termIds,
      wordPaletteReferences: next.wordPaletteReferences,
      nodes: creatorPromptNodesFromCommonInput(next.promptInputSnapshot.commonInput),
    });
    promptNodesRef.current = nextPromptNodes;
    setPromptNodes(nextPromptNodes);
    setManualPrompt(creatorPromptText(nextPromptNodes));
    setTermPromptLocale(next.termPromptLocale);
    const nextTerms = next.termIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []);
    const nextPalettes = next.wordPaletteReferences.flatMap((reference) => {
      const palette = data.wordPalettes.find((item) => item.id === reference.paletteId);
      const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
      return palette && revision
        ? [{ palette, revision, parameterValues: reference.parameterValues, promptLocale: reference.promptLocale }]
        : [];
    });
    replaceMaterials({
      referenceAssets: next.referenceAssets,
      selectedTerms: nextTerms,
      appliedPalettes: nextPalettes,
      termPromptLocale: next.termPromptLocale,
    });
    const latestRun = latestVersionGenerationRun(next, series?.versions ?? []);
    const restoredTargets = latestVersionGenerationTargets(next, series?.versions ?? []);
    setGenerationTargets((current) =>
      restoredTargets.length
        ? restoredTargets
        : current.length
          ? current
          : initialGenerationTargets({ creationDraft: null, imageGenerationRoutes: data.imageGenerationRoutes }),
    );
    if (latestRun) {
      const preset =
        data.canvasPresets.find((item) => item.stableKey === latestRun.canvasPresetKey) ??
        data.canvasPresets.find((item) => item.width === latestRun.width && item.height === latestRun.height);
      setCanvasPresetKey(preset?.stableKey ?? '');
    } else {
      setCanvasPresetKey('');
    }
  }

  function chooseVersion(id: string) {
    const next = series?.versions.find((item) => item.id === id);
    if (!next) return;
    setVersionId(next.id);
    restoreVersion(next);
  }

  function restoreDraft(draft = savedDraftRef.current) {
    restoredVersionIdRef.current = null;
    setHydratedVersionId(null);
    creationDraftIdRef.current = draft?.id ?? null;
    setCreationDraftId(draft?.id ?? null);
    setTargetAlbumId(draft?.targetAlbumId ?? null);
    setNewTitle(draft?.title ?? '');
    const nextPromptNodes = creatorPromptNodesFromReferences({
      manualPrompt: draft?.text ?? '',
      termIds: draft?.termIds ?? [],
      wordPaletteReferences: draft?.wordPaletteReferences ?? [],
      nodes: draft?.promptNodes,
    });
    promptNodesRef.current = nextPromptNodes;
    setPromptNodes(nextPromptNodes);
    setManualPrompt(creatorPromptText(nextPromptNodes));
    setTermPromptLocale(draft?.termPromptLocale ?? defaultPromptLocale ?? locale);
    const nextTerms = (draft?.termIds ?? []).flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []);
    const nextPalettes = (draft?.wordPaletteReferences ?? []).flatMap((reference) => {
      const palette = data.wordPalettes.find((item) => item.id === reference.paletteId);
      const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
      return palette && revision
        ? [{ palette, revision, parameterValues: reference.parameterValues, promptLocale: reference.promptLocale }]
        : [];
    });
    replaceMaterials({
      referenceAssets: draft?.referenceAssets ?? [],
      selectedTerms: nextTerms,
      appliedPalettes: nextPalettes,
      termPromptLocale: draft?.termPromptLocale ?? defaultPromptLocale ?? locale,
    });
    setDictionaryScope(draft?.dictionaryScope ?? emptyCreationDictionaryScope());
    setCanvasPresetKey(draft?.canvasPresetKey ?? '');
    if (draft) {
      const restoredTargets = draft.modelTargets.length
        ? draft.modelTargets
        : draft.selectedModelKeys.map((modelKey) => ({
            modelKey,
            count: draft.repeatCount,
            quality: draft.quality,
          }));
      setGenerationTargets(restoredTargets.length ? restoredTargets : initialGenerationTargets(data));
    } else {
      setGenerationTargets(initialGenerationTargets(data));
    }
  }

  async function saveCreationDraftNow(
    targetAlbumOverride: string | null | undefined = undefined,
    capturedPrompt?: CapturedCreatorPrompt,
  ) {
    if (draftSavePromiseRef.current) {
      try {
        await draftSavePromiseRef.current;
      } catch {
        // A newer save below is the recovery attempt and must not inherit an
        // already-settled failure from an older autosave.
      }
    }
    const captured = capturedPrompt ?? captureVisiblePrompt();
    const promise = window.desktopApi.creationDraftSave({
      id: creationDraftIdRef.current,
      targetAlbumId: targetAlbumOverride === undefined ? targetAlbumId : targetAlbumOverride,
      title: newTitle,
      text: captured.manualPrompt,
      promptNodes: captured.nodes,
      referenceAssetIds: referenceAssets.map((asset) => asset.id),
      termPromptLocale,
      termIds: captured.selectedTerms.map((term) => term.id),
      wordPaletteReferences: captured.appliedPalettes.map((reference) => ({
        paletteId: reference.palette.id,
        paletteRevisionId: reference.revision.id,
        parameterValues: reference.parameterValues,
        promptLocale: reference.promptLocale,
      })),
      dictionaryScope,
      canvasPresetKey: canvasPreset?.stableKey ?? null,
      quality,
      selectedModelKeys,
      repeatCount,
      modelTargets: generationTargets,
    });
    draftSavePromiseRef.current = promise;
    try {
      const draft = await promise;
      savedDraftRef.current = draft;
      creationDraftIdRef.current = draft.id;
      setCreationDraftId(draft.id);
      return draft;
    } finally {
      if (draftSavePromiseRef.current === promise) draftSavePromiseRef.current = null;
    }
  }

  function invalidatePendingCreationDraftAutosaves() {
    draftAutosaveEpochRef.current += 1;
  }

  async function autosaveCreationDraft(expectedEpoch: number, expectedDraftId: string | null) {
    if (draftAutosaveEpochRef.current !== expectedEpoch || creationDraftIdRef.current !== expectedDraftId) {
      return;
    }
    if (draftSavePromiseRef.current) {
      try {
        await draftSavePromiseRef.current;
      } catch {
        // The guarded autosave below is the recovery attempt for this input session.
      }
    }
    if (draftAutosaveEpochRef.current !== expectedEpoch || creationDraftIdRef.current !== expectedDraftId) {
      return;
    }
    await saveCreationDraftNow();
  }

  async function changeNewCreationAlbum(nextAlbumId: string | null) {
    if (creationMode !== 'new' || nextAlbumId === targetAlbumId) return;
    const previousAlbumId = targetAlbumId;
    setTargetAlbumId(nextAlbumId);
    if (location.surface === 'new-creation') {
      commitCreatorLocation({ surface: 'new-creation', albumId: nextAlbumId }, 'replace');
    }
    try {
      await saveCreationDraftNow(nextAlbumId);
    } catch (reason) {
      setTargetAlbumId(previousAlbumId);
      if (location.surface === 'new-creation') {
        commitCreatorLocation({ surface: 'new-creation', albumId: previousAlbumId }, 'replace');
      }
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function ensureAgentScope(): Promise<CreatorAgentScope> {
    if (creationMode === 'existing' && sessionHostSeries) return { kind: 'SERIES', id: sessionHostSeries.id };
    const draft = await saveCreationDraftNow();
    return { kind: 'DRAFT', id: draft.id };
  }

  async function openInputStashDialog() {
    if (inputStashBusy) return;
    setInputStashBusy(true);
    try {
      const scope = await ensureAgentScope();
      const stashes = await window.desktopApi.creationInputStashesList(scope);
      setInputStashes(stashes);
      setInputStashDialogOpen(true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInputStashBusy(false);
    }
  }

  async function stashCurrentInput() {
    if (inputStashBusy) return;
    setInputStashBusy(true);
    try {
      const scope = await ensureAgentScope();
      const { referenceAssets: _referenceAssets, ...snapshot } = currentInputSnapshot;
      const stash = await window.desktopApi.creationInputStashCreate({ scope, snapshot });
      setInputStashes((current) => [stash, ...current.filter((item) => item.id !== stash.id)]);
      notify(
        locale === 'zh'
          ? `已暂存输入 S${String(stash.revisionNo).padStart(2, '0')}`
          : `Input stashed as S${String(stash.revisionNo).padStart(2, '0')}`,
      );
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInputStashBusy(false);
    }
  }

  function restoreInputStash(stash: CreationInputStashDto) {
    const snapshot = stash.snapshot;
    const nextTerms = snapshot.termIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []);
    const nextPalettes = snapshot.wordPaletteReferences.flatMap((reference) => {
      const palette = data.wordPalettes.find((item) => item.id === reference.paletteId);
      const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
      return palette && revision
        ? [
            {
              palette,
              revision,
              parameterValues: reference.parameterValues,
              promptLocale: reference.promptLocale,
            },
          ]
        : [];
    });
    const nextPromptNodes = creatorPromptNodesFromReferences({
      manualPrompt: snapshot.manualPrompt,
      termIds: snapshot.termIds,
      wordPaletteReferences: snapshot.wordPaletteReferences,
      nodes: snapshot.promptNodes,
    });
    setPromptNodes(nextPromptNodes);
    setManualPrompt(creatorPromptText(nextPromptNodes));
    replaceMaterials({
      referenceAssets: snapshot.referenceAssets,
      selectedTerms: nextTerms,
      appliedPalettes: nextPalettes,
      termPromptLocale: snapshot.termPromptLocale,
    });
    setDictionaryScope(snapshot.dictionaryScope);
    setCanvasPresetKey(snapshot.canvasPresetKey ?? '');
    setGenerationTargets(snapshot.generationTargets);
    if (creationMode === 'new') {
      const restoredTitle = snapshot.title;
      setNewTitle(restoredTitle);
      if (savedDraftRef.current) {
        savedDraftRef.current = {
          ...savedDraftRef.current,
          title: restoredTitle,
        };
      }
    }
    setInputStashDialogOpen(false);
    notify(
      locale === 'zh'
        ? `已恢复暂存 S${String(stash.revisionNo).padStart(2, '0')}`
        : `Restored S${String(stash.revisionNo).padStart(2, '0')}`,
    );
  }

  function restoreInspirationStash(stash: InspirationStashDto) {
    const { referenceAssets: stashReferenceAssets, ...content } = stash.content;
    const nextTerms = content.termIds.flatMap((termId) => data.terms.find((term) => term.id === termId) ?? []);
    const nextPalettes = content.wordPaletteReferences.flatMap((reference) => {
      const palette = data.wordPalettes.find((item) => item.id === reference.paletteId);
      const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
      return palette && revision
        ? [
            {
              palette,
              revision,
              parameterValues: reference.parameterValues,
              promptLocale: reference.promptLocale,
            },
          ]
        : [];
    });
    const nextPromptNodes = creatorPromptNodesFromReferences({
      manualPrompt: content.manualPrompt,
      termIds: content.termIds,
      wordPaletteReferences: content.wordPaletteReferences,
      nodes: content.promptNodes,
    });
    promptNodesRef.current = nextPromptNodes;
    setPromptNodes(nextPromptNodes);
    setManualPrompt(creatorPromptText(nextPromptNodes));
    setTermPromptLocale(content.termPromptLocale);
    replaceMaterials({
      referenceAssets: stashReferenceAssets,
      selectedTerms: nextTerms,
      appliedPalettes: nextPalettes,
      termPromptLocale: content.termPromptLocale,
    });
    setSavedInspirationContentKey(JSON.stringify(content));
  }

  async function stashInspiration() {
    if (inspirationStashBusy) return;
    let capturedPrompt: CapturedCreatorPrompt;
    try {
      capturedPrompt = captureVisiblePrompt();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const content: InspirationStashContentInput = {
      schemaVersion: 1,
      manualPrompt: capturedPrompt.manualPrompt,
      promptNodes: capturedPrompt.nodes,
      referenceAssetIds: referenceAssets.map((asset) => asset.id),
      termPromptLocale,
      termIds: capturedPrompt.selectedTerms.map((term) => term.id),
      wordPaletteReferences: capturedPrompt.appliedPalettes.map((reference) => ({
        paletteId: reference.palette.id,
        paletteRevisionId: reference.revision.id,
        parameterValues: reference.parameterValues,
        promptLocale: reference.promptLocale,
      })),
    };
    setInspirationStashBusy(true);
    try {
      synchronizeCapturedPrompt(capturedPrompt);
      const currentItem =
        creationMode === 'existing' && sessionHostSeries
          ? creationItemByFormEntity(data.creationItems, 'PROMPT_SERIES', sessionHostSeries.id)
          : null;
      if (creationMode === 'existing' && sessionHostSeries && !currentItem) {
        throw new Error(locale === 'zh' ? '所属创作项不可用' : 'The containing creation item is unavailable');
      }
      const stash = await window.desktopApi.inspirationStashSave(
        selectedInspirationStashId
          ? { mode: 'UPDATE', id: selectedInspirationStashId, content }
          : currentItem
            ? { mode: 'ADD_FORM', creationItemId: currentItem.id, content }
            : { mode: 'CREATE_STANDALONE', albumId: targetAlbumId, content },
      );
      if (creationMode === 'new') {
        const started = await startNewCreation(targetAlbumId, 'replace', true);
        await refresh();
        if (started) {
          notify(locale === 'zh' ? '已暂存灵感' : 'Inspiration stashed');
          return;
        }
      } else {
        await refresh();
      }
      setSelectedInspirationStashId(stash.id);
      setSavedInspirationContentKey(JSON.stringify(content));
      setSelectedIdeaCreationId(null);
      setSelectedAlbumId(null);
      panes.setCompactPanel('creator');
      commitCreatorLocation({ surface: 'inspiration-stash', stashId: stash.id }, 'replace');
      notify(locale === 'zh' ? '已暂存灵感' : 'Inspiration stashed');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInspirationStashBusy(false);
    }
  }

  const restoreVersionForEffect = useStableCallback(restoreVersion);
  const saveCreationDraftForEffect = useStableCallback(saveCreationDraftNow);
  const autosaveCreationDraftForEffect = useStableCallback(autosaveCreationDraft);
  const commitCreatorLocationForEffect = useStableCallback(commitCreatorLocation);
  const workbenchLocationForEffect = useStableCallback(workbenchLocation);
  const chooseAlbumForEffect = useStableCallback(chooseAlbum);
  const chooseIdeaCreationForEffect = useStableCallback(chooseIdeaCreation);
  const chooseInspirationStashForEffect = useStableCallback(chooseInspirationStash);
  const chooseSocialPostForEffect = useStableCallback(chooseSocialPost);
  const chooseArticleForEffect = useStableCallback(chooseArticle);
  const chooseSeriesForEffect = useStableCallback(chooseSeries);
  const startNewCreationForEffect = useStableCallback(startNewCreation);
  const notifyForEffect = useStableCallback(notify);

  useEffect(() => {
    if (creationMode !== 'existing' || !series) return;
    const requestedVersionId =
      location.surface === 'existing-creation' && location.seriesId === series.id ? location.versionId : undefined;
    const next =
      series.versions.find((item) => item.id === requestedVersionId) ??
      series.versions.find((item) => item.id === series.currentVersionId) ??
      series.versions[0];
    setVersionId(next?.id ?? '');
    if (restoredVersionIdRef.current !== (next?.id ?? null)) restoreVersionForEffect(next);
  }, [creationMode, location, restoreVersionForEffect, series]);

  useEffect(() => {
    if (creationMode !== 'existing' || !version || restoredVersionIdRef.current === version.id) return;
    restoreVersionForEffect(version);
  }, [creationMode, restoreVersionForEffect, version]);

  useEffect(() => {
    if (creationMode !== 'new' || selectedInspirationStashId || selectedSocialPostId || selectedArticleId || starting) {
      return undefined;
    }
    const hasContent = Boolean(
      newTitle.trim() ||
      manualPrompt.trim() ||
      referenceAssets.length ||
      selectedTerms.length ||
      appliedPalettes.length,
    );
    if (!hasContent && !creationDraftId) return undefined;
    const expectedEpoch = draftAutosaveEpochRef.current;
    const expectedDraftId = creationDraftId;
    const timer = window.setTimeout(() => {
      void autosaveCreationDraftForEffect(expectedEpoch, expectedDraftId).catch((reason) =>
        notifyForEffect(reason instanceof Error ? reason.message : String(reason)),
      );
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    creationMode,
    creationDraftId,
    targetAlbumId,
    newTitle,
    manualPrompt,
    promptNodes,
    referenceAssets,
    selectedInspirationStashId,
    selectedSocialPostId,
    selectedArticleId,
    selectedTerms,
    appliedPalettes,
    dictionaryScope,
    termPromptLocale,
    canvasPresetKey,
    generationTargets,
    locale,
    notifyForEffect,
    autosaveCreationDraftForEffect,
    starting,
  ]);

  useEffect(() => {
    if (creationMode !== 'new' || !targetAlbumId || !targetAlbumUnavailable) return;
    setTargetAlbumId(null);
    if (location.surface === 'new-creation') {
      commitCreatorLocationForEffect({ surface: 'new-creation', albumId: null }, 'replace');
    }
    void saveCreationDraftForEffect(null)
      .then(() =>
        notifyForEffect(
          locale === 'zh'
            ? '目标图集不可用，草稿已移到顶层'
            : 'The target album is unavailable; the draft was moved to the root',
        ),
      )
      .catch((reason) => notifyForEffect(reason instanceof Error ? reason.message : String(reason)));
  }, [
    commitCreatorLocationForEffect,
    creationMode,
    locale,
    location.surface,
    notifyForEffect,
    saveCreationDraftForEffect,
    targetAlbumId,
    targetAlbumUnavailable,
  ]);

  useEffect(() => {
    if (data.codex.state === 'checking') void window.desktopApi.codexHealth().then(setHealth);
    else setHealth(data.codex);
  }, [data.codex]);

  useEffect(
    () =>
      window.desktopApi.onAssistantProgress((event) => {
        if (event.contextKey !== assistantContextKey) return;
        setMinimalAssistantProgressEvents((current) => {
          const sameCreation = current.length === 0 || current[0]?.creationId === event.creationId;
          const base = sameCreation ? current : [];
          if (base.some((item) => item.id === event.id)) return base;
          return [...base, event].sort((left, right) => left.sequence - right.sequence);
        });
      }),
    [assistantContextKey],
  );

  useEffect(() => {
    if (!assistantProposalSyncReady || (!expirableAssistantRunIds.length && !revalidatableAssistantRunIds.length))
      return;
    let requestActive = true;
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        ...expirableAssistantRunIds.map((runId) =>
          window.desktopApi.assistantProposalExpire(runId, assistantContextKey),
        ),
        ...revalidatableAssistantRunIds.map((runId) =>
          window.desktopApi.assistantProposalRevalidate(runId, assistantContextKey),
        ),
      ]).then((results) => {
        if (!requestActive) return;
        const updatedRuns = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        setMinimalAssistantRun((current) => updatedRuns.find((run) => run.id === current?.id) ?? current);
        if (updatedRuns.length) void refresh().catch(() => undefined);
      });
    }, 150);
    return () => {
      requestActive = false;
      window.clearTimeout(timer);
    };
  }, [
    assistantContextKey,
    assistantProposalSyncReady,
    expirableAssistantRunIds,
    refresh,
    revalidatableAssistantRunIds,
  ]);

  useEffect(() => {
    if (!pendingAutoTitle) return;
    const targetSeries = data.series.find((item) => item.id === pendingAutoTitle.seriesId);
    const targetVersion = targetSeries?.versions.find((item) =>
      item.runs.some((run) => run.id === pendingAutoTitle.runId),
    );
    if (!targetVersion) return;
    const hasSuccessfulOutput = targetVersion.runs.some((run) => run.status === 'SUCCEEDED');
    const hasActiveRun = targetVersion.runs.some((run) => run.status === 'QUEUED' || run.status === 'RUNNING');
    if (!hasSuccessfulOutput && hasActiveRun) return;
    const request = pendingAutoTitle;
    setPendingAutoTitle(null);
    if (!hasSuccessfulOutput) return;
    void window.desktopApi
      .codexSuggestTitles({
        prompt: request.prompt,
        title: '',
        mode: 'regenerate',
      })
      .then(async (result) => {
        const safeTitle = fallbackTitleSuggestion({
          prompt: request.prompt,
          title: result.title,
          mode: 'fill',
        }).title;
        const rename = await window.desktopApi.promptSeriesRename({
          seriesId: request.seriesId,
          title: safeTitle,
          locale,
          expectedTitle: request.initialTitle,
        });
        if (!rename.renamed) return;
        await refresh();
        notify(c.titleGenerated);
      })
      .catch(() => {
        const fallback = fallbackTitleSuggestion({
          prompt: request.prompt,
          title: '',
          mode: 'regenerate',
        });
        void window.desktopApi
          .promptSeriesRename({
            seriesId: request.seriesId,
            title: fallback.title,
            locale,
            expectedTitle: request.initialTitle,
          })
          .then(async (rename) => {
            if (!rename.renamed) return;
            await refresh();
            notify(c.titleGenerated);
          })
          .catch(() => notify(c.titleGenerationFailed));
      });
  }, [c.titleGenerated, c.titleGenerationFailed, data.series, locale, notify, pendingAutoTitle, refresh]);

  useEffect(() => {
    setWordPalettes(activeWordPalettes(data.wordPalettes));
  }, [data.wordPalettes]);

  useEffect(() => {
    if (!active) return undefined;
    if (dictionaryScope.mode === 'ALL') {
      setScopePaletteRevisionIds([]);
      return undefined;
    }
    let requestActive = true;
    void window.desktopApi
      .dictionaryScopeResolve({
        packReleaseIds: dictionaryPackReleaseIds,
        includeLocalTerms: dictionaryScope.includeLocalTerms,
      })
      .then((scope) => {
        if (requestActive) setScopePaletteRevisionIds(scope.paletteRevisionIds);
      })
      .catch((reason) => {
        if (requestActive) notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      requestActive = false;
    };
  }, [active, dictionaryPackReleaseIds, dictionaryScope.mode, dictionaryScope.includeLocalTerms, notify]);

  useEffect(() => {
    if (!imageGenerationRoutes.length) return;
    setGenerationTargets((current) => {
      const available = current.filter((target) =>
        imageGenerationRoutes.some((model) => model.key === target.modelKey),
      );
      if (available.length === current.length && available.length) return current;
      if (available.length) return available;
      const defaults = initialGenerationTargets({ creationDraft: null, imageGenerationRoutes });
      return defaults.length ? defaults : current;
    });
  }, [imageGenerationRoutes]);

  useEffect(() => {
    if (creationMode === 'new' && selectedTerms.length === 0) setTermPromptLocale(defaultPromptLocale ?? locale);
  }, [creationMode, defaultPromptLocale, locale, selectedTerms.length]);

  useEffect(() => {
    if (!active || (!dictionaryOpen && !promptFullWindow)) return;
    let requestActive = true;
    setHistoricalTermRecommendationBusy(true);
    void window.desktopApi
      .historicalTermRecommendationsList({ scope: assistantScope, limit: 6 })
      .then((runs) => {
        if (requestActive) setHistoricalTermRecommendationRuns(runs);
      })
      .catch((reason) => {
        if (requestActive) notify(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestActive) setHistoricalTermRecommendationBusy(false);
      });
    return () => {
      requestActive = false;
    };
  }, [active, assistantScope, dictionaryOpen, notify, promptFullWindow]);

  function resetInputs() {
    invalidatePendingCreationDraftAutosaves();
    minimalAssistantRequestRevision.current += 1;
    setInputSessionRevision((revision) => revision + 1);
    restoredVersionIdRef.current = null;
    setHydratedVersionId(null);
    promptNodesRef.current = [];
    setManualPrompt('');
    setPromptNodes([]);
    replaceMaterials({ ...materialsRef.current, referenceAssets: [], selectedTerms: [], appliedPalettes: [] });
    setDictionaryOpen(false);
    onPromptFullWindowChange(false);
    setDictionaryFocusTarget(null);
    setMinimalAssistantRun(null);
    setMinimalAssistantBusy(false);
    setMinimalAssistantMode(null);
    setMinimalAssistantError('');
    setPendingExperimentDirections([]);
    setPendingExperimentAssistantRun(null);
    setExplorationDialogOpen(false);
    setExplorationError('');
    setRenameOpen(false);
    setInputStashDialogOpen(false);
    setInputStashes([]);
  }

  function restoreAssistantForScope(scope: CreatorAgentScope | null) {
    if (!scope) return;
    const candidates = [...(minimalAssistantRun ? [minimalAssistantRun] : []), ...data.assistantRuns]
      .filter(
        (run, index, runs) =>
          run.scope.kind === scope.kind &&
          run.scope.id === scope.id &&
          !run.dismissedAt &&
          run.proposal?.status !== 'CLOSED' &&
          runs.findIndex((candidate) => candidate.id === run.id) === index,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const latest = candidates[0] ?? null;
    setMinimalAssistantRun(latest);
    const contextTargetRun = candidates.find(
      (run) =>
        run.proposal && ['READY', 'ADOPTED'].includes(run.proposal.status) && run.input.generationTargets.length > 0,
    );
    if (contextTargetRun) {
      setGenerationTargets(contextTargetRun.input.generationTargets.map((target) => ({ ...target })));
    }
    setMinimalAssistantError('');
  }

  function commitCreatorLocation(nextLocation: CreatorLocation, mode: NavigationMode = 'push') {
    appliedLocationKeyRef.current = navigationLocationKey(nextLocation);
    onNavigate(nextLocation, mode);
  }

  function selectCreationStartMode(mode: CreationStartMode) {
    setCreationStartMode(mode);
    writeCreationStartMode(mode);
    if (mode === 'image') setVideoCreationRequest(null);
    else onPromptFullWindowChange(false);
  }

  function workbenchLocation(): CreatorLocation {
    if (selectedSocialPostId) return { surface: 'social-post', postId: selectedSocialPostId };
    if (selectedArticleId) return { surface: 'article', articleId: selectedArticleId };
    if (selectedIdeaCreationId) return { surface: 'idea-creation', creationId: selectedIdeaCreationId };
    if (selectedInspirationStashId) return { surface: 'inspiration-stash', stashId: selectedInspirationStashId };
    if (creationMode === 'new') return { surface: 'new-creation', albumId: targetAlbumId };
    if (seriesId) return { surface: 'existing-creation', seriesId, assetId: requestedAssetId };
    return { surface: 'default' };
  }

  function selectOutputAsset(assetId: string, mode: NavigationMode = 'push') {
    setRequestedAssetId(assetId);
    if (creationMode === 'existing' && seriesId) {
      commitCreatorLocation({ surface: 'existing-creation', seriesId, assetId }, mode);
    }
  }

  async function startNewCreation(
    albumId: string | null = null,
    navigationMode: NavigationMode | null = 'push',
    fresh = false,
  ) {
    invalidatePendingCreationDraftAutosaves();
    try {
      if (fresh && draftSavePromiseRef.current) {
        try {
          await draftSavePromiseRef.current;
        } catch {
          // Starting a fresh session supersedes an older autosave failure.
        }
      }
      if (
        !fresh &&
        !selectedSocialPostId &&
        !selectedArticleId &&
        creationMode === 'new' &&
        (creationDraftIdRef.current ||
          newTitle.trim() ||
          manualPrompt.trim() ||
          referenceAssets.length ||
          selectedTerms.length ||
          appliedPalettes.length)
      ) {
        await saveCreationDraftNow();
      }
      const draft = await window.desktopApi.creationDraftStart({
        albumId,
        termPromptLocale: defaultPromptLocale ?? locale,
        fresh,
      });
      savedDraftRef.current = draft;
      onComparisonFullWindowChange(false);
      setSelectedSocialPostId(null);
      setSelectedArticleId(null);
      setSelectedInspirationStashId(null);
      setSavedInspirationContentKey(null);
      setSelectedIdeaCreationId(null);
      setOutputMode('results');
      setSelectedAlbumId(null);
      setVideoCreationRequest(null);
      setCreationMode('new');
      setSeriesId(null);
      setOutputSeriesId(null);
      setVersionId('');
      setRequestedAssetId(null);
      setOutputGalleryOpen(false);
      panes.setCompactPanel('creator');
      resetInputs();
      restoreDraft(draft);
      restoreAssistantForScope({ kind: 'DRAFT', id: draft.id });
      if (navigationMode) {
        commitCreatorLocation({ surface: 'new-creation', albumId: draft.targetAlbumId }, navigationMode);
      }
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  async function createExternalCreation(value: NewExternalCreationDialogValue) {
    if (creationMode === 'new' && hasNewCreationDraftState()) await saveCreationDraftNow();
    const outputItems = await imageImportItems(value.outputs.map((output) => output.file));
    const result = await window.desktopApi.creatorNewExternalCreationImport({
      intent: 'NEW_EXTERNAL_CREATION',
      sourceKind: 'EXTERNAL_IMPORT',
      creationDraftId: null,
      albumId: value.albumId,
      title: value.title,
      titleLocale: locale,
      prompt: value.promptKnowledge === 'EXACT' ? { knowledge: 'EXACT', text: value.prompt } : { knowledge: 'UNKNOWN' },
      source: value.source,
      sourceUrl: value.sourceUrl,
      outputs: outputItems.map((output, index) => ({ ...output, metadata: value.outputs[index]?.metadata })),
    });
    await refresh();
    const firstAssetId = result.assetIds[0] ?? null;
    onComparisonFullWindowChange(false);
    setSelectedSocialPostId(null);
    setSelectedArticleId(null);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    setSelectedIdeaCreationId(null);
    setOutputMode('results');
    setSelectedAlbumId(null);
    setTargetAlbumId(null);
    setCreationMode('existing');
    setSeriesId(result.seriesId);
    setOutputSeriesId(result.seriesId);
    setVersionId(result.versionId);
    setRequestedAssetId(firstAssetId);
    setOutputGalleryOpen(false);
    panes.setCompactPanel('output');
    commitCreatorLocation(
      { surface: 'existing-creation', seriesId: result.seriesId, assetId: firstAssetId },
      'replace',
    );
    notify(messages.creator.externalCreationImport.imported);
  }

  async function commitCreationAsV01() {
    if (starting) return;
    let capturedPrompt: CapturedCreatorPrompt;
    try {
      capturedPrompt = captureVisiblePrompt();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const capturedResolution = resolveCreatorPrompt({
      manualPrompt: capturedPrompt.manualPrompt,
      promptNodes: capturedPrompt.nodes,
      selectedTerms: capturedPrompt.selectedTerms,
      appliedPalettes: capturedPrompt.appliedPalettes,
      termPromptLocale,
      promptProfileId,
    });
    if (!capturedResolution.livePrompt.trim()) return;
    synchronizeCapturedPrompt(capturedPrompt);
    const typedTitle = newTitle.trim();
    const title = typedTitle || savedDraftRef.current?.title.trim() || '新创作';
    invalidatePendingCreationDraftAutosaves();
    setStarting(true);
    try {
      const draft = await saveCreationDraftNow(undefined, capturedPrompt);
      const result = await window.desktopApi.creationDraftCommit({
        creationDraftId: draft.id,
        inspirationStashId: selectedInspirationStashId,
        title: title,
        manualPrompt: capturedPrompt.manualPrompt,
        promptNodes: capturedPrompt.nodes,
        prompt: capturedResolution.livePrompt,
        resolvedPrompt: capturedResolution.composition,
        changeSummary: automaticChangeSummary,
        referenceAssetIds: referenceAssets.map((asset) => asset.id),
        termPromptLocale,
        termIds: capturedPrompt.selectedTerms.map((term) => term.id),
        wordPaletteReferences: capturedPrompt.appliedPalettes.map((reference) => ({
          paletteId: reference.palette.id,
          paletteRevisionId: reference.revision.id,
          parameterValues: reference.parameterValues,
          promptLocale: reference.promptLocale,
        })),
      });
      await refresh();
      savedDraftRef.current = null;
      creationDraftIdRef.current = null;
      setCreationDraftId(null);
      setTargetAlbumId(null);
      setSelectedSocialPostId(null);
      setSelectedArticleId(null);
      setSelectedInspirationStashId(null);
      setSavedInspirationContentKey(null);
      setSelectedIdeaCreationId(null);
      setOutputMode('results');
      setSelectedAlbumId(null);
      setCreationMode('existing');
      setSeriesId(result.seriesId);
      setOutputSeriesId(result.seriesId);
      setVersionId(result.versionId);
      panes.setOutputCollapsed(false);
      panes.setCompactPanel('output');
      commitCreatorLocation({ surface: 'existing-creation', seriesId: result.seriesId, assetId: null }, 'replace');
      notify(locale === 'zh' ? '已开启创作' : 'Creation started');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  async function commitSocialPost(_plan: Extract<CreationOutcomePlan, { kind: 'social-post' }>) {
    if (starting) return;
    let capturedPrompt: CapturedCreatorPrompt;
    try {
      capturedPrompt = captureVisiblePrompt();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const body = capturedPrompt.manualPrompt;
    if (!body.trim()) return;
    const firstLine = body
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    const title =
      newTitle.trim() ||
      Array.from(firstLine ?? '')
        .slice(0, 60)
        .join('') ||
      '新贴图';
    synchronizeCapturedPrompt(capturedPrompt);
    invalidatePendingCreationDraftAutosaves();
    setStarting(true);
    try {
      const draft = await saveCreationDraftNow(undefined, capturedPrompt);
      const content: SocialPostContentInput = {
        schemaVersion: 1,
        title,
        body,
        mediaAssetIds: referenceAssets.map((asset) => asset.id),
        coverAssetId: referenceAssets[0]?.id ?? null,
      };
      const sourceItem = selectedInspirationStashId
        ? creationItemByFormEntity(data.creationItems, 'INSPIRATION_STASH', selectedInspirationStashId)
        : null;
      if (selectedInspirationStashId && !sourceItem) {
        throw new Error(locale === 'zh' ? '灵感所属创作项不可用' : 'The inspiration creation item is unavailable');
      }
      const post = sourceItem
        ? await window.desktopApi.socialPostFormAdd({
            creationItemId: sourceItem.id,
            sourceInspirationStashId: selectedInspirationStashId,
            consumeCreationDraftId: draft.id,
            content,
          })
        : await window.desktopApi.socialPostSave({
            id: null,
            albumId: targetAlbumId,
            sourceInspirationStashId: null,
            consumeCreationDraftId: draft.id,
            content,
          });
      await refresh();
      savedDraftRef.current = null;
      creationDraftIdRef.current = null;
      setCreationDraftId(null);
      setTargetAlbumId(null);
      setSelectedSocialPostId(post.id);
      setSelectedArticleId(null);
      setSelectedInspirationStashId(null);
      setSavedInspirationContentKey(null);
      setSelectedIdeaCreationId(null);
      setSelectedAlbumId(null);
      setOutputMode('results');
      setOutputSeriesId(null);
      setRequestedAssetId(null);
      resetInputs();
      restoreDraft(null);
      panes.setCompactPanel('creator');
      commitCreatorLocation({ surface: 'social-post', postId: post.id }, 'replace');
      notify(locale === 'zh' ? '已创建贴图' : 'Social post created');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  async function commitArticle(_plan: Extract<CreationOutcomePlan, { kind: 'article' }>) {
    if (starting) return;
    let capturedPrompt: CapturedCreatorPrompt;
    try {
      capturedPrompt = captureVisiblePrompt();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const body = capturedPrompt.manualPrompt.trim();
    if (!body && referenceAssets.length === 0) return;
    const firstLine = body
      .split(/\r?\n/u)
      .map((line) => line.replace(/^#+\s*/u, '').trim())
      .find(Boolean);
    const title =
      newTitle.trim() ||
      Array.from(firstLine ?? '')
        .slice(0, 60)
        .join('') ||
      '新文章';
    const mediaBindings = articleMediaBindings(referenceAssets, 'reference');
    const markdown = markdownWithImages(body, mediaBindings, locale);
    synchronizeCapturedPrompt(capturedPrompt);
    invalidatePendingCreationDraftAutosaves();
    setStarting(true);
    try {
      const draft = await saveCreationDraftNow(undefined, capturedPrompt);
      const content: ArticleContentInput = {
        schemaVersion: 1,
        title,
        markdown,
        mediaBindings,
        coverAssetId: referenceAssets[0]?.id ?? null,
      };
      const sourceItem = selectedInspirationStashId
        ? creationItemByFormEntity(data.creationItems, 'INSPIRATION_STASH', selectedInspirationStashId)
        : null;
      if (selectedInspirationStashId && !sourceItem) {
        throw new Error(locale === 'zh' ? '灵感所属创作项不可用' : 'The inspiration creation item is unavailable');
      }
      const article = sourceItem
        ? await window.desktopApi.articleFormAdd({
            creationItemId: sourceItem.id,
            sourceInspirationStashId: selectedInspirationStashId,
            consumeCreationDraftId: draft.id,
            content,
          })
        : await window.desktopApi.articleSave({
            id: null,
            albumId: targetAlbumId,
            sourceInspirationStashId: null,
            consumeCreationDraftId: draft.id,
            content,
          });
      await refresh();
      savedDraftRef.current = null;
      creationDraftIdRef.current = null;
      setCreationDraftId(null);
      setTargetAlbumId(null);
      setSelectedSocialPostId(null);
      setSelectedArticleId(article.id);
      setSelectedInspirationStashId(null);
      setSavedInspirationContentKey(null);
      setSelectedIdeaCreationId(null);
      setSelectedAlbumId(null);
      setOutputMode('results');
      setOutputSeriesId(null);
      setRequestedAssetId(null);
      resetInputs();
      restoreDraft(null);
      panes.setCompactPanel('creator');
      commitCreatorLocation({ surface: 'article', articleId: article.id }, 'replace');
      notify(locale === 'zh' ? '已创建文章' : 'Article created');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  function startCreationFromPlan(plan: CreationOutcomePlan) {
    if (plan.kind === 'image') {
      void commitCreationAsV01();
      return;
    }
    if (plan.kind === 'social-post') {
      void commitSocialPost(plan);
      return;
    }
    void commitArticle(plan);
  }

  async function saveSocialPost(post: SocialPostDto, content: SocialPostContentInput) {
    await window.desktopApi.socialPostSave({
      id: post.id,
      albumId: post.albumId,
      sourceInspirationStashId: post.sourceInspirationStashId,
      consumeCreationDraftId: null,
      content,
    });
    await refresh();
  }

  async function saveArticle(article: ArticleDto, content: ArticleContentInput) {
    const saved = await window.desktopApi.articleSave({
      id: article.id,
      albumId: article.albumId,
      sourceInspirationStashId: article.sourceInspirationStashId,
      consumeCreationDraftId: null,
      content,
    });
    await refresh();
    return saved;
  }

  function openDerivedVisualDraftWorkspace(draft: CreationDraftDto) {
    savedDraftRef.current = draft;
    creationDraftIdRef.current = draft.id;
    onComparisonFullWindowChange(false);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    setSelectedIdeaCreationId(null);
    setSelectedAlbumId(null);
    setOutputMode('results');
    setVideoCreationRequest(null);
    setCreationMode('new');
    setSeriesId(null);
    setOutputSeriesId(null);
    setVersionId('');
    setRequestedAssetId(null);
    setOutputGalleryOpen(false);
    resetInputs();
    restoreDraft(draft);
    restoreAssistantForScope({ kind: 'DRAFT', id: draft.id });
    setDismissedDerivedVisualId(null);
    panes.setOutputCollapsed(false);
    panes.setCompactPanel('output');
  }

  function openDerivedVisualSeriesWorkspace(
    visual: DerivedVisualDto,
    hostSeriesId: string,
    options: {
      outputSeriesId?: string;
      assetId?: string;
      prompt?: string;
      canvasPreset?: CanvasPresetDto;
    } = {},
  ) {
    const hostSeries = data.series.find((candidate) => candidate.id === hostSeriesId);
    if (!hostSeries || visual.promptSeriesId !== hostSeries.id) {
      throw new Error(locale === 'zh' ? '派生创作工作区不可用' : 'The derived creation workspace is unavailable');
    }
    const targetVersion =
      hostSeries.versions.find((candidate) => candidate.id === hostSeries.currentVersionId) ?? hostSeries.versions[0];
    const targetArticle = visual.articleId
      ? (data.articles ?? []).find((article) => article.id === visual.articleId)
      : null;
    const targetPost = visual.socialPostId
      ? (data.socialPosts ?? []).find((post) => post.id === visual.socialPostId)
      : null;
    if (!targetArticle && !targetPost) {
      throw new Error(locale === 'zh' ? '父创作不可用' : 'The parent creation is unavailable');
    }

    savedDraftRef.current = null;
    creationDraftIdRef.current = null;
    onComparisonFullWindowChange(false);
    setSelectedSocialPostId(targetPost?.id ?? null);
    setSelectedArticleId(targetArticle?.id ?? null);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    setSelectedIdeaCreationId(null);
    setSelectedAlbumId(null);
    setTargetAlbumId(null);
    setOutputMode('results');
    setVideoCreationRequest(null);
    setCreationMode('existing');
    setSeriesId(hostSeries.id);
    setOutputSeriesId(options.outputSeriesId ?? hostSeries.id);
    setCreationDraftId(null);
    setVersionId(targetVersion?.id ?? '');
    setRequestedAssetId(options.assetId ?? null);
    setOutputGalleryOpen(false);
    setDictionaryScope(emptyCreationDictionaryScope());
    resetInputs();
    restoreVersion(targetVersion);
    if (options.canvasPreset) setCanvasPresetKey(options.canvasPreset.stableKey);
    if (options.prompt) changeDerivedVisualPrompt(options.prompt);
    setDismissedDerivedVisualId(null);
    panes.setOutputCollapsed(false);
    panes.setCompactPanel('output');
    commitCreatorLocation(
      targetArticle
        ? { surface: 'article', articleId: targetArticle.id }
        : { surface: 'social-post', postId: targetPost!.id },
      'replace',
    );
  }

  function openDerivedVisualWorkspace(result: DerivedVisualWorkspaceOpenResult) {
    if (result.kind === 'DRAFT') {
      openDerivedVisualDraftWorkspace(result.draft);
      return;
    }
    openDerivedVisualSeriesWorkspace(result.visual, result.seriesId, {
      assetId: result.visual.selectedImageAssetId ?? undefined,
    });
  }

  function derivedVisualTemplates() {
    const templates = data.derivedVisualPrompts;
    if (!templates?.articleHeader || !templates.articleInline || !templates.socialCover) {
      throw new Error(locale === 'zh' ? '配图提示词配置不可用' : 'Visual prompt configuration is unavailable');
    }
    return templates;
  }

  async function openArticleHeaderWorkspace(article: ArticleDto, content: ArticleContentInput) {
    if (articleHeaderWorkspace?.articleId === article.id) {
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'RESUME',
        visualId: articleHeaderWorkspace.id,
      });
      await refresh();
      openDerivedVisualWorkspace(result);
      notify(locale === 'zh' ? '已继续题图创作' : 'Hero creation resumed');
      return;
    }
    const saved = await saveArticle(article, content);
    const preset = data.canvasPresets.find((item) => item.stableKey === 'wechat_article_cover_2_35_1');
    if (!preset) throw new Error(locale === 'zh' ? '公众号题图画幅不可用' : 'WeChat hero canvas is unavailable');
    const prompt = buildArticleHeaderPrompt(derivedVisualTemplates(), saved.content.title, saved.content.markdown);
    const result = await window.desktopApi.derivedVisualWorkspaceOpen({
      mode: 'CREATE',
      role: 'ARTICLE_HEADER',
      articleId: saved.id,
      articleRevisionId: saved.revisionId,
      prompt,
      canvasPresetKey: preset.stableKey,
      locale,
    });
    await refresh();
    openDerivedVisualWorkspace(result);
    notify(locale === 'zh' ? '已打开题图创作' : 'Hero creation opened');
  }

  async function openArticleIllustrationWorkspace(
    article: ArticleDto,
    content: ArticleContentInput,
    selectedText: string,
    preset: CanvasPresetDto,
  ) {
    const anchorText = selectedText.trim();
    const first = content.markdown.indexOf(anchorText);
    if (!anchorText || first < 0 || first !== content.markdown.lastIndexOf(anchorText)) {
      throw new Error(
        locale === 'zh'
          ? '请选择当前文章中一段唯一的连续文字'
          : 'Select one unique continuous passage in the current article',
      );
    }
    const existingWorkspace = (data.derivedVisuals ?? []).find(
      (visual) =>
        visual.role === 'ARTICLE_INLINE' &&
        visual.articleId === article.id &&
        visual.anchor?.selectedText === anchorText &&
        derivedVisualWorkspaceAvailable(visual, data),
    );
    if (existingWorkspace) {
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'RESUME',
        visualId: existingWorkspace.id,
      });
      await refresh();
      openDerivedVisualWorkspace(result);
      notify(locale === 'zh' ? '已继续正文配图创作' : 'Illustration creation resumed');
      return;
    }
    const saved = await saveArticle(article, content);
    const prompt = buildArticleInlinePrompt(
      derivedVisualTemplates(),
      preset,
      saved.content.title,
      anchorText,
      saved.content.markdown,
    );
    const result = await window.desktopApi.derivedVisualWorkspaceOpen({
      mode: 'CREATE',
      role: 'ARTICLE_INLINE',
      articleId: saved.id,
      articleRevisionId: saved.revisionId,
      prompt,
      canvasPresetKey: preset.stableKey,
      locale,
      anchor: { selectedText: anchorText },
    });
    await refresh();
    openDerivedVisualWorkspace(result);
    notify(locale === 'zh' ? '已打开正文配图创作' : 'Illustration creation opened');
  }

  async function openSocialCoverWorkspace(
    post: SocialPostDto,
    content: SocialPostContentInput,
    preset: CanvasPresetDto,
  ) {
    if (socialCoverWorkspace?.socialPostId === post.id) {
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({
        mode: 'RESUME',
        visualId: socialCoverWorkspace.id,
      });
      await refresh();
      openDerivedVisualWorkspace(result);
      notify(locale === 'zh' ? '已继续封面创作' : 'Cover creation resumed');
      return;
    }
    const saved = await window.desktopApi.socialPostSave({
      id: post.id,
      albumId: post.albumId,
      sourceInspirationStashId: post.sourceInspirationStashId,
      consumeCreationDraftId: null,
      content,
    });
    const prompt = buildSocialCoverPrompt(derivedVisualTemplates(), preset, saved.content.title, saved.content.body);
    const result = await window.desktopApi.derivedVisualWorkspaceOpen({
      mode: 'CREATE',
      role: 'SOCIAL_POST_COVER',
      socialPostId: saved.id,
      socialPostRevisionId: saved.revisionId,
      prompt,
      canvasPresetKey: preset.stableKey,
      locale,
    });
    await refresh();
    openDerivedVisualWorkspace(result);
    notify(locale === 'zh' ? '已打开封面创作' : 'Cover creation opened');
  }

  function changeDerivedVisualPrompt(prompt: string) {
    updatePromptDocument(replaceCreatorPromptText(promptNodesRef.current, prompt));
  }

  function changeDerivedVisualCanvas(preset: CanvasPresetDto) {
    if (!editorDerivedVisual) return;
    try {
      let prompt: string;
      if (editorDerivedVisual.role === 'ARTICLE_HEADER') {
        if (!selectedArticle) return;
        prompt = buildArticleHeaderPrompt(
          derivedVisualTemplates(),
          selectedArticle.content.title,
          selectedArticle.content.markdown,
        );
      } else if (editorDerivedVisual.role === 'ARTICLE_INLINE') {
        if (!selectedArticle || !editorDerivedVisual.anchor) return;
        prompt = buildArticleInlinePrompt(
          derivedVisualTemplates(),
          preset,
          selectedArticle.content.title,
          editorDerivedVisual.anchor.selectedText,
          selectedArticle.content.markdown,
        );
      } else {
        if (!selectedSocialPost) return;
        prompt = buildSocialCoverPrompt(
          derivedVisualTemplates(),
          preset,
          selectedSocialPost.content.title,
          selectedSocialPost.content.body,
        );
      }
      setCanvasPresetKey(preset.stableKey);
      changeDerivedVisualPrompt(prompt);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function adoptDerivedVisual(visualId: string, imageAssetId: string) {
    const result = await window.desktopApi.derivedVisualAdopt({ id: visualId, imageAssetId });
    await refresh();
    if (result.article) {
      setSelectedSocialPostId(null);
      setSelectedArticleId(result.article.id);
      panes.setCompactPanel('creator');
      commitCreatorLocation({ surface: 'article', articleId: result.article.id }, 'replace');
      notify(
        locale === 'zh'
          ? result.visual.role === 'ARTICLE_HEADER'
            ? '已设为文章题图'
            : '已插入文章正文'
          : result.visual.role === 'ARTICLE_HEADER'
            ? 'Article hero updated'
            : 'Illustration inserted in the article',
      );
    } else if (result.socialPost) {
      setSelectedArticleId(null);
      setSelectedSocialPostId(result.socialPost.id);
      panes.setCompactPanel('creator');
      commitCreatorLocation({ surface: 'social-post', postId: result.socialPost.id }, 'replace');
      notify(locale === 'zh' ? '已设为贴图首图' : 'Social cover updated');
    }
  }

  async function exportArticleMarkdown(articleId: string) {
    const result = await window.desktopApi.articleExportMarkdown({ id: articleId });
    if (result.status === 'SAVED') notify(locale === 'zh' ? '已导出 Markdown' : 'Markdown exported');
  }

  async function copyArticleForWechat(articleId: string) {
    const result = await window.desktopApi.articleCopyForWechat({ id: articleId });
    const imageNotice =
      result.remoteImageCount > 0
        ? locale === 'zh'
          ? `；${result.remoteImageCount} 张网络图片需在公众号中确认`
          : `; check ${result.remoteImageCount} remote image${result.remoteImageCount === 1 ? '' : 's'} in WeChat`
        : '';
    notify(locale === 'zh' ? `已复制公众号正文${imageNotice}` : `WeChat article body copied${imageNotice}`);
  }

  function activeDerivedSourceId(sourceId: string | null) {
    return sourceId && (data.inspirationStashes ?? []).some((stash) => stash.id === sourceId) ? sourceId : null;
  }

  function creationItemIdForEntity(kind: 'ARTICLE' | 'SOCIAL_POST', entityId: string) {
    const item = creationItemByFormEntity(data.creationItems, kind, entityId);
    if (!item) throw new Error(locale === 'zh' ? '所属创作项不可用' : 'The containing creation item is unavailable');
    return item.id;
  }

  async function createSocialPostFromArticle(article: ArticleDto, content: ArticleContentInput) {
    const post = await window.desktopApi.socialPostFormAdd({
      creationItemId: creationItemIdForEntity('ARTICLE', article.id),
      sourceInspirationStashId: activeDerivedSourceId(article.sourceInspirationStashId),
      consumeCreationDraftId: null,
      content: {
        schemaVersion: 1,
        title: content.title,
        body: socialPostBodyFromMarkdown(content.markdown),
        mediaAssetIds: content.mediaBindings.map((binding) => binding.assetId),
        coverAssetId: content.coverAssetId,
      },
    });
    await refresh();
    setSelectedArticleId(null);
    setSelectedSocialPostId(post.id);
    commitCreatorLocation({ surface: 'social-post', postId: post.id }, 'push');
    notify(locale === 'zh' ? '已打开贴图创作形式' : 'Social post form opened');
  }

  async function createArticleFromSocialPost(
    post: SocialPostDto,
    content: SocialPostContentInput,
    mediaAssets: readonly AssetDto[],
  ) {
    const byId = new Map(mediaAssets.map((asset) => [asset.id, asset]));
    const orderedAssets = content.mediaAssetIds.flatMap((assetId) => byId.get(assetId) ?? []);
    const mediaBindings = articleMediaBindings(orderedAssets, 'post');
    const article = await window.desktopApi.articleFormAdd({
      creationItemId: creationItemIdForEntity('SOCIAL_POST', post.id),
      sourceInspirationStashId: activeDerivedSourceId(post.sourceInspirationStashId),
      consumeCreationDraftId: null,
      content: {
        schemaVersion: 1,
        title: content.title,
        markdown: markdownWithImages(content.body, mediaBindings, locale),
        mediaBindings,
        coverAssetId: content.coverAssetId,
      },
    });
    await refresh();
    setSelectedSocialPostId(null);
    setSelectedArticleId(article.id);
    commitCreatorLocation({ surface: 'article', articleId: article.id }, 'push');
    notify(locale === 'zh' ? '已打开文章创作形式' : 'Article form opened');
  }

  async function createNextPromptVersion(targetSeriesId: string): Promise<PromptVersionCreateResult | null> {
    if (!series || series.id !== targetSeriesId) {
      notify(messages.creator.resultsOrganizer.versionUnavailable);
      return null;
    }
    if (starting || versionCreating) return null;
    if (typeof window.desktopApi.promptVersionCreate !== 'function') {
      notify(messages.creator.resultsOrganizer.restartRequired);
      return null;
    }
    const nextVersionNo = Math.max(0, ...series.versions.map((item) => item.versionNo)) + 1;
    const nextVersionLabel = `V${String(nextVersionNo).padStart(2, '0')}`;
    let capturedPrompt: CapturedCreatorPrompt;
    try {
      capturedPrompt = captureVisiblePrompt();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
    const capturedResolution = resolveCreatorPrompt({
      manualPrompt: capturedPrompt.manualPrompt,
      promptNodes: capturedPrompt.nodes,
      selectedTerms: capturedPrompt.selectedTerms,
      appliedPalettes: capturedPrompt.appliedPalettes,
      termPromptLocale,
      promptProfileId,
    });
    synchronizeCapturedPrompt(capturedPrompt);
    setVersionCreating(true);
    try {
      const result = await window.desktopApi.promptVersionCreate({
        seriesId: series.id,
        baseVersionId: version?.id ?? null,
        title: series.title,
        titleLocale: locale,
        manualPrompt: capturedPrompt.manualPrompt,
        promptNodes: capturedPrompt.nodes,
        prompt: capturedResolution.livePrompt,
        changeSummary: automaticChangeSummary,
        referenceAssetIds: referenceAssets.map((asset) => asset.id),
        termPromptLocale,
        termIds: capturedPrompt.selectedTerms.map((term) => term.id),
        wordPaletteReferences: capturedPrompt.appliedPalettes.map((reference) => ({
          paletteId: reference.palette.id,
          paletteRevisionId: reference.revision.id,
          parameterValues: reference.parameterValues,
          promptLocale: reference.promptLocale,
        })),
      });
      await refresh();
      setVersionId(result.versionId);
      setOutputSeriesId(result.seriesId);
      notify(`${nextVersionLabel} · ${c.versionCreated}`);
      return result;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setVersionCreating(false);
    }
  }

  function hasNewCreationDraftState() {
    return Boolean(
      creationDraftIdRef.current ||
      newTitle.trim() ||
      manualPrompt.trim() ||
      referenceAssets.length ||
      selectedTerms.length ||
      appliedPalettes.length,
    );
  }

  async function preserveNewCreationBeforeNavigation() {
    if (selectedSocialPostId || selectedArticleId) return true;
    if (creationMode !== 'new' || !hasNewCreationDraftState()) return true;
    try {
      await saveCreationDraftNow();
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  async function detachDraftFromUnavailableAlbum(albumId: string, includeDescendants: boolean) {
    if (creationMode !== 'new' || !targetAlbumId) return false;
    let affected = targetAlbumId === albumId;
    if (!affected && includeDescendants) {
      const visited = new Set<string>();
      let currentAlbumId: string | undefined = targetAlbumId;
      while (currentAlbumId && !visited.has(currentAlbumId)) {
        visited.add(currentAlbumId);
        currentAlbumId = albumTree.parentById.get(currentAlbumId);
        if (currentAlbumId === albumId) {
          affected = true;
          break;
        }
      }
    }
    if (!affected) return false;
    setTargetAlbumId(null);
    try {
      await saveCreationDraftNow(null);
    } catch (reason) {
      notify(
        locale === 'zh'
          ? `草稿已移到顶层，但自动保存失败：${reason instanceof Error ? reason.message : String(reason)}`
          : `The draft was moved to the root, but autosave failed: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
    if (location.surface === 'new-creation') {
      commitCreatorLocation({ surface: 'new-creation', albumId: null }, 'replace');
    }
    return true;
  }

  async function chooseSeries(
    id: string,
    assetId?: string,
    navigationMode: NavigationMode | null = 'push',
    requestedVersionId?: string,
  ) {
    if (!(await preserveNewCreationBeforeNavigation())) return false;
    const targetSeries = data.series.find((item) => item.id === id);
    if (!targetSeries) return false;
    const targetVersion =
      targetSeries.versions.find((item) => item.id === requestedVersionId) ??
      targetSeries.versions.find((item) => item.id === targetSeries.currentVersionId) ??
      targetSeries.versions[0];
    const seriesChanged = creationMode !== 'existing' || seriesId !== id || selectedAlbumId !== null;
    onComparisonFullWindowChange(false);
    setSelectedSocialPostId(null);
    setSelectedArticleId(null);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    setSelectedIdeaCreationId(null);
    setOutputMode('results');
    setSelectedAlbumId(null);
    setTargetAlbumId(null);
    setCreationMode('existing');
    setSeriesId(id);
    setOutputSeriesId(id);
    creationDraftIdRef.current = null;
    setCreationDraftId(null);
    setRequestedAssetId(assetId ?? null);
    if (assetId) panes.setOutputCollapsed(false);
    setOutputGalleryOpen(false);
    if (seriesChanged || requestedVersionId) {
      setDictionaryScope(emptyCreationDictionaryScope());
      setVersionId(targetVersion?.id ?? '');
      resetInputs();
      restoreVersion(targetVersion);
    }
    const session = creationSessions.find((item) => item.memberSeries.some((member) => member.id === id));
    if (seriesChanged) restoreAssistantForScope({ kind: 'SERIES', id: session?.primarySeries.id ?? id });
    panes.setCompactPanel(assetId ? 'output' : 'creator');
    if (navigationMode) {
      commitCreatorLocation({ surface: 'existing-creation', seriesId: id, assetId: assetId ?? null }, navigationMode);
    }
    return true;
  }

  async function resumeDerivedVisual(visualId: string) {
    if (!(await preserveNewCreationBeforeNavigation())) return;
    try {
      const result = await window.desktopApi.derivedVisualWorkspaceOpen({ mode: 'RESUME', visualId });
      await refresh();
      openDerivedVisualWorkspace(result);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function openParentEditorWithoutDerivedWorkspace() {
    setDismissedDerivedVisualId(activeDerivedVisual?.id ?? null);
    setCreationMode('new');
    setSeriesId(null);
    setOutputSeriesId(null);
    setVersionId('');
  }

  async function chooseSocialPost(id: string, navigationMode: NavigationMode | null = 'push') {
    const post = (data.socialPosts ?? []).find((item) => item.id === id);
    if (!post) return false;
    if (!(await preserveNewCreationBeforeNavigation())) return false;
    onComparisonFullWindowChange(false);
    openParentEditorWithoutDerivedWorkspace();
    setSelectedSocialPostId(post.id);
    setSelectedArticleId(null);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    setSelectedIdeaCreationId(null);
    setSelectedAlbumId(null);
    setOutputMode('results');
    setRequestedAssetId(null);
    setOutputGalleryOpen(false);
    panes.setCompactPanel('creator');
    if (navigationMode) commitCreatorLocation({ surface: 'social-post', postId: post.id }, navigationMode);
    return true;
  }

  async function chooseArticle(id: string, navigationMode: NavigationMode | null = 'push') {
    const article = (data.articles ?? []).find((item) => item.id === id);
    if (!article) return false;
    if (!(await preserveNewCreationBeforeNavigation())) return false;
    onComparisonFullWindowChange(false);
    openParentEditorWithoutDerivedWorkspace();
    setSelectedSocialPostId(null);
    setSelectedArticleId(article.id);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    setSelectedIdeaCreationId(null);
    setSelectedAlbumId(null);
    setOutputMode('results');
    setRequestedAssetId(null);
    setOutputGalleryOpen(false);
    panes.setCompactPanel('creator');
    if (navigationMode) commitCreatorLocation({ surface: 'article', articleId: article.id }, navigationMode);
    return true;
  }

  async function chooseInspirationStash(id: string, navigationMode: NavigationMode | null = 'push') {
    const stash = (data.inspirationStashes ?? []).find((item) => item.id === id);
    if (!stash) return false;
    const item = creationItemByFormEntity(data.creationItems, 'INSPIRATION_STASH', stash.id);
    if (!item) {
      notify(locale === 'zh' ? '灵感所属创作项不可用' : 'The inspiration creation item is unavailable');
      return false;
    }
    const hostSeriesId = imageSeriesIdForCreationItem(item);
    if (hostSeriesId) {
      if (!(await chooseSeries(hostSeriesId, undefined, null))) return false;
    } else if (!(await startNewCreation(item.albumId, null))) {
      return false;
    }
    onComparisonFullWindowChange(false);
    setSelectedSocialPostId(null);
    setSelectedArticleId(null);
    setSelectedIdeaCreationId(null);
    setSelectedAlbumId(null);
    setSelectedInspirationStashId(stash.id);
    setOutputMode('results');
    setRequestedAssetId(null);
    setOutputGalleryOpen(false);
    restoreInspirationStash(stash);
    panes.setCompactPanel('creator');
    if (navigationMode) commitCreatorLocation({ surface: 'inspiration-stash', stashId: stash.id }, navigationMode);
    return true;
  }

  async function chooseIdeaCreation(id: string, navigationMode: NavigationMode | null = 'push') {
    const creation = (data.creations ?? []).find((item) => item.id === id);
    if (!creation) return false;
    if (!(await preserveNewCreationBeforeNavigation())) return false;
    onComparisonFullWindowChange(false);
    setSelectedSocialPostId(null);
    setSelectedArticleId(null);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    if (creation.sourceScope.kind === 'SERIES') {
      const sourceLoaded =
        creationMode === 'existing' &&
        (seriesId === creation.sourceScope.id ||
          Boolean(activeCreationSession?.memberSeries.some((item) => item.id === creation.sourceScope.id)));
      if (!sourceLoaded && !(await chooseSeries(creation.sourceScope.id, undefined, null))) return false;
    } else if (data.creationDraft?.id === creation.sourceScope.id) {
      const draftChanged = creationMode !== 'new' || creationDraftIdRef.current !== data.creationDraft.id;
      setSelectedAlbumId(null);
      setTargetAlbumId(data.creationDraft.targetAlbumId);
      setCreationMode('new');
      setSeriesId(null);
      setOutputSeriesId(null);
      savedDraftRef.current = data.creationDraft;
      if (draftChanged) {
        resetInputs();
        restoreDraft(data.creationDraft);
        restoreAssistantForScope({ kind: 'DRAFT', id: data.creationDraft.id });
      }
    }
    setSelectedIdeaCreationId(id);
    setOutputMode('records');
    setSelectedAlbumId(null);
    setRequestedAssetId(null);
    setOutputGalleryOpen(false);
    panes.setOutputCollapsed(false);
    panes.setCompactPanel('output');
    if (navigationMode) commitCreatorLocation({ surface: 'idea-creation', creationId: id }, navigationMode);
    return true;
  }

  async function changeOutputMode(nextMode: CreationOutputMode) {
    if (nextMode !== outputMode) setMinimalAssistantError('');
    if (nextMode === 'records') {
      setOutputMode('records');
      panes.setOutputCollapsed(false);
      panes.setCompactPanel('output');
      return true;
    }

    const ideaSource = selectedIdeaCreation?.sourceScope;
    if (ideaSource?.kind === 'SERIES') {
      const sourceLoaded =
        creationMode === 'existing' &&
        (seriesId === ideaSource.id ||
          Boolean(activeCreationSession?.memberSeries.some((item) => item.id === ideaSource.id)));
      if (!sourceLoaded) {
        if (!(await chooseSeries(ideaSource.id))) return false;
      } else {
        setSelectedIdeaCreationId(null);
        if (seriesId) {
          commitCreatorLocation({ surface: 'existing-creation', seriesId, assetId: requestedAssetId }, 'push');
        }
      }
    } else if (selectedIdeaCreation) {
      setSelectedIdeaCreationId(null);
      if (creationMode === 'new') {
        commitCreatorLocation({ surface: 'new-creation', albumId: targetAlbumId }, 'push');
      }
    }

    setOutputMode(nextMode);
    if (outputSeries) {
      panes.setOutputCollapsed(false);
      panes.setCompactPanel('output');
    } else {
      panes.setCompactPanel('creator');
    }
    return true;
  }

  async function requestProjectIdeas() {
    setOutputMode('records');
    panes.setOutputCollapsed(false);
    panes.setCompactPanel('output');
    if (activeIdeaCreation) {
      setSelectedIdeaCreationId(activeIdeaCreation.id);
      commitCreatorLocation({ surface: 'idea-creation', creationId: activeIdeaCreation.id }, 'push');
    }
    await requestMinimalAssistant('directions', activeIdeaCreation?.id);
  }

  async function requestProjectWriting(webSearchMode: AssistantWebSearchMode = 'DISABLED') {
    if (!(await changeOutputMode('records'))) return;
    await requestMinimalAssistant('optimize', undefined, webSearchMode);
  }

  async function chooseAlbum(id: string, navigationMode: NavigationMode | null = 'push') {
    if (!(await preserveNewCreationBeforeNavigation())) return false;
    onComparisonFullWindowChange(false);
    setSelectedSocialPostId(null);
    setSelectedArticleId(null);
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    setSelectedIdeaCreationId(null);
    setOutputMode('results');
    setSelectedAlbumId(id);
    setRequestedAssetId(null);
    setOutputGalleryOpen(false);
    panes.setCompactPanel('creator');
    if (navigationMode) commitCreatorLocation({ surface: 'album-detail', albumId: id }, navigationMode);
    return true;
  }

  useEffect(() => {
    if (!selectedAlbumId || data.albums.some((album) => album.id === selectedAlbumId)) return;
    setSelectedAlbumId(null);
    if (location.surface === 'album-detail' && location.albumId === selectedAlbumId) {
      commitCreatorLocationForEffect(workbenchLocationForEffect(), 'replace');
    }
  }, [commitCreatorLocationForEffect, data.albums, location, selectedAlbumId, workbenchLocationForEffect]);

  useEffect(() => {
    if (!selectedIdeaCreationId || (data.creations ?? []).some((creation) => creation.id === selectedIdeaCreationId))
      return;
    setSelectedIdeaCreationId(null);
    setOutputMode('results');
    if (location.surface === 'idea-creation' && location.creationId === selectedIdeaCreationId) {
      commitCreatorLocationForEffect(
        creationMode === 'new'
          ? { surface: 'new-creation', albumId: targetAlbumId }
          : seriesId
            ? { surface: 'existing-creation', seriesId, assetId: requestedAssetId }
            : { surface: 'default' },
        'replace',
      );
    }
  }, [
    commitCreatorLocationForEffect,
    creationMode,
    data.creations,
    location,
    requestedAssetId,
    selectedIdeaCreationId,
    seriesId,
    targetAlbumId,
  ]);

  useEffect(() => {
    if (
      !selectedInspirationStashId ||
      (data.inspirationStashes ?? []).some((stash) => stash.id === selectedInspirationStashId)
    )
      return;
    setSelectedInspirationStashId(null);
    setSavedInspirationContentKey(null);
    if (location.surface === 'inspiration-stash' && location.stashId === selectedInspirationStashId) {
      commitCreatorLocationForEffect(
        creationMode === 'new'
          ? { surface: 'new-creation', albumId: targetAlbumId }
          : seriesId
            ? { surface: 'existing-creation', seriesId, assetId: requestedAssetId }
            : { surface: 'default' },
        'replace',
      );
    }
  }, [
    commitCreatorLocationForEffect,
    creationMode,
    data.inspirationStashes,
    location,
    requestedAssetId,
    selectedInspirationStashId,
    seriesId,
    targetAlbumId,
  ]);

  useEffect(() => {
    if (!selectedSocialPostId || (data.socialPosts ?? []).some((post) => post.id === selectedSocialPostId)) return;
    setSelectedSocialPostId(null);
    if (location.surface !== 'social-post' || location.postId !== selectedSocialPostId) return;
    commitCreatorLocationForEffect(
      creationMode === 'new'
        ? { surface: 'new-creation', albumId: targetAlbumId }
        : seriesId
          ? { surface: 'existing-creation', seriesId, assetId: requestedAssetId }
          : { surface: 'default' },
      'replace',
    );
  }, [
    commitCreatorLocationForEffect,
    creationMode,
    data.socialPosts,
    location,
    requestedAssetId,
    selectedSocialPostId,
    seriesId,
    targetAlbumId,
  ]);

  useEffect(() => {
    if (!selectedArticleId || (data.articles ?? []).some((article) => article.id === selectedArticleId)) return;
    setSelectedArticleId(null);
    if (location.surface !== 'article' || location.articleId !== selectedArticleId) return;
    commitCreatorLocationForEffect(
      creationMode === 'new'
        ? { surface: 'new-creation', albumId: targetAlbumId }
        : seriesId
          ? { surface: 'existing-creation', seriesId, assetId: requestedAssetId }
          : { surface: 'default' },
      'replace',
    );
  }, [
    commitCreatorLocationForEffect,
    creationMode,
    data.articles,
    location,
    requestedAssetId,
    selectedArticleId,
    seriesId,
    targetAlbumId,
  ]);

  useEffect(() => {
    onActiveAlbumChange(activeAlbumContextId);
  }, [activeAlbumContextId, onActiveAlbumChange]);

  useEffect(() => {
    if (!active) return;
    if (location.surface === 'default') {
      const canonicalLocation: CreatorLocation =
        derivedDraftParentLocation ??
        (initialDraft
          ? { surface: 'new-creation', albumId: initialDraft.targetAlbumId }
          : initialSeriesId
            ? { surface: 'existing-creation', seriesId: initialSeriesId, assetId: null }
            : { surface: 'new-creation', albumId: null });
      commitCreatorLocationForEffect(canonicalLocation, 'replace');
      return;
    }
    if (appliedLocationKeyRef.current === locationKey) return;
    appliedLocationKeyRef.current = locationKey;
    onPromptFullWindowChange(false);
    if (location.surface === 'album-detail') {
      void chooseAlbumForEffect(location.albumId, null);
      return;
    }
    if (location.surface === 'existing-creation') {
      void chooseSeriesForEffect(location.seriesId, location.assetId ?? undefined, null, location.versionId);
      return;
    }
    if (location.surface === 'idea-creation') {
      void chooseIdeaCreationForEffect(location.creationId, null);
      return;
    }
    if (location.surface === 'inspiration-stash') {
      void chooseInspirationStashForEffect(location.stashId, null);
      return;
    }
    if (location.surface === 'social-post') {
      void chooseSocialPostForEffect(location.postId, null);
      return;
    }
    if (location.surface === 'article') {
      void chooseArticleForEffect(location.articleId, null);
      return;
    }
    void startNewCreationForEffect(location.albumId, null, location.requestId !== undefined);
  }, [
    active,
    chooseAlbumForEffect,
    chooseIdeaCreationForEffect,
    chooseInspirationStashForEffect,
    chooseSocialPostForEffect,
    chooseArticleForEffect,
    chooseSeriesForEffect,
    commitCreatorLocationForEffect,
    derivedDraftParentLocation,
    initialDraft,
    initialSeriesId,
    location,
    locationKey,
    onPromptFullWindowChange,
    startNewCreationForEffect,
  ]);

  async function showMoreResults(id: string) {
    if (!(await chooseSeries(id))) return;
    panes.setOutputCollapsed(false);
    setOutputGalleryOpen(true);
    panes.setCompactPanel('output');
  }

  async function finishContentLifecycleAction({ target }: ContentLifecycleActionRequest) {
    if (target.entityType === 'ALBUM') {
      const draftDetached = await detachDraftFromUnavailableAlbum(target.entityId, true);
      if (selectedAlbumId) {
        let currentAlbumId: string | undefined = selectedAlbumId;
        while (currentAlbumId) {
          if (currentAlbumId === target.entityId) {
            setSelectedAlbumId(null);
            commitCreatorLocation(
              draftDetached ? { surface: 'new-creation', albumId: null } : workbenchLocation(),
              'replace',
            );
            break;
          }
          currentAlbumId = albumTree.parentById.get(currentAlbumId);
        }
      }
      await Promise.all([refresh(), refreshAlbums()]);
      return;
    }

    const selectedCreationItemId = data.creationItems.find((item) =>
      item.forms.some(
        (form) =>
          (form.entity.kind === 'PROMPT_SERIES' && form.entity.id === seriesId) ||
          (form.entity.kind === 'INSPIRATION_STASH' && form.entity.id === selectedInspirationStashId) ||
          (form.entity.kind === 'SOCIAL_POST' && form.entity.id === selectedSocialPostId) ||
          (form.entity.kind === 'ARTICLE' && form.entity.id === selectedArticleId) ||
          (form.entity.kind === 'VIDEO_DOCUMENT' && form.entity.id === selectedDocumentId),
      ),
    )?.id;
    const selectedTarget =
      (target.entityType === 'CREATION_ITEM' && target.entityId === selectedCreationItemId) ||
      (target.entityType === 'PROMPT_SERIES' && target.entityId === seriesId) ||
      (target.entityType === 'CREATION' && target.entityId === selectedIdeaCreationId) ||
      (target.entityType === 'INSPIRATION_STASH' && target.entityId === selectedInspirationStashId) ||
      (target.entityType === 'SOCIAL_POST' && target.entityId === selectedSocialPostId) ||
      (target.entityType === 'ARTICLE' && target.entityId === selectedArticleId) ||
      (target.entityType === 'VIDEO_DOCUMENT' && target.entityId === selectedDocumentId);

    if (target.entityType === 'INSPIRATION_STASH' && target.entityId === selectedInspirationStashId) {
      setSelectedInspirationStashId(null);
      setSavedInspirationContentKey(null);
    }
    if (target.entityType === 'SOCIAL_POST' && target.entityId === selectedSocialPostId) setSelectedSocialPostId(null);
    if (target.entityType === 'ARTICLE' && target.entityId === selectedArticleId) setSelectedArticleId(null);
    if (target.entityType === 'CREATION' && target.entityId === selectedIdeaCreationId) {
      setSelectedIdeaCreationId(null);
      setOutputMode('results');
    }

    await refresh();
    if (selectedTarget) await startNewCreation(null, 'replace', true);
  }

  async function attachReferences() {
    const result = await window.desktopApi.assetsChooseReferences();
    updateMaterials((current) => {
      const referenceAssets = [
        ...current.referenceAssets,
        ...result.assets.filter((item) => !current.referenceAssets.some((existing) => existing.id === item.id)),
      ].slice(0, 8);
      return referenceAssets.length === current.referenceAssets.length ? current : { ...current, referenceAssets };
    });
  }

  function creatorImportContext(source: RendererImageImportSource, sourceUrl = '') {
    const typedTitle = newTitle.trim();
    const exactVersionId =
      creationMode === 'existing' &&
      creatorInputMatchesVersion({
        version,
        manualPrompt,
        promptNodes,
        selectedTerms,
        appliedPalettes,
        termPromptLocale,
        referenceAssets,
      })
        ? version!.id
        : null;
    return {
      seriesId: creationMode === 'existing' ? seriesId : null,
      versionId: exactVersionId,
      title: creationMode === 'new' ? typedTitle : (series?.title ?? ''),
      titleLocale: locale,
      source,
      sourceUrl,
    };
  }

  async function importReferenceFiles(files: File[], source: RendererImageImportSource, sourceUrl = '') {
    if (referenceImporting) return;
    setReferenceImporting(true);
    try {
      const items = await imageImportItems(files);
      if (!items.length) return;
      const assets = await window.desktopApi.creatorReferencesImport({
        context: creatorImportContext(source, sourceUrl),
        items,
      });
      updateMaterials((current) => {
        const referenceAssets = [
          ...current.referenceAssets,
          ...assets.filter((item) => !current.referenceAssets.some((existing) => existing.id === item.id)),
        ].slice(0, 8);
        return referenceAssets.length === current.referenceAssets.length ? current : { ...current, referenceAssets };
      });
    } catch (reason) {
      notify(`${c.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setReferenceImporting(false);
    }
  }

  function applyImportedOutputs(result: { seriesId: string; assetIds: string[] }) {
    setOutputSeriesId(result.seriesId);
    setRequestedAssetId(result.assetIds[0] ?? null);
    setOutputGalleryOpen(false);
    panes.setCompactPanel('output');
  }

  function pasteTextFromOutput(text: string) {
    appendPromptText(text);
    panes.setCompactPanel('creator');
  }

  function openTermInDictionary(term: TermListItem) {
    if (dictionaryHandoffFrameRef.current !== null) cancelAnimationFrame(dictionaryHandoffFrameRef.current);
    setDictionaryOpen(false);
    dictionaryHandoffFrameRef.current = requestAnimationFrame(() => {
      dictionaryHandoffFrameRef.current = requestAnimationFrame(() => {
        dictionaryHandoffFrameRef.current = null;
        setTermQuery(term.title);
        setDictionaryFocusTarget({ kind: 'term', id: term.id });
        setDictionaryOpen(true);
      });
    });
  }

  function openPaletteInDictionary(paletteId: string) {
    if (dictionaryHandoffFrameRef.current !== null) cancelAnimationFrame(dictionaryHandoffFrameRef.current);
    setDictionaryOpen(false);
    dictionaryHandoffFrameRef.current = requestAnimationFrame(() => {
      dictionaryHandoffFrameRef.current = requestAnimationFrame(() => {
        dictionaryHandoffFrameRef.current = null;
        setDictionaryFocusTarget({ kind: 'palette', id: paletteId });
        setDictionaryOpen(true);
      });
    });
  }

  function clearDictionaryMaterials() {
    if (promptComposerRef.current) promptComposerRef.current.clearStructuredNodes();
    else updatePromptDocument(promptNodes.filter((node) => node.kind === 'TEXT'));
  }

  function removeReferenceAsset(id: string) {
    updateMaterials((current) => ({
      ...current,
      referenceAssets: current.referenceAssets.filter((asset) => asset.id !== id),
    }));
  }

  function applyReferenceAssets(assets: AssetDto[]) {
    updateMaterials((current) =>
      current.referenceAssets.length === assets.length &&
      current.referenceAssets.every((asset, index) => asset.id === assets[index]?.id)
        ? current
        : { ...current, referenceAssets: assets },
    );
  }

  function removeAppliedPalette(id: string) {
    if (promptComposerRef.current) promptComposerRef.current.removeRecipe(id);
    else updatePromptDocument(promptNodes.filter((node) => node.kind !== 'RECIPE' || node.paletteId !== id));
  }

  function toggleTerm(term: TermListItem) {
    if (materialsRef.current.selectedTerms.some((item) => item.id === term.id)) {
      if (promptComposerRef.current) promptComposerRef.current.removeTerm(term.id);
      else updatePromptDocument(promptNodes.filter((node) => node.kind !== 'TERM' || node.termId !== term.id));
    } else if (promptComposerRef.current) {
      promptComposerRef.current.insertTerm(term.id);
    } else {
      updatePromptDocument([
        ...promptNodes,
        { kind: 'TERM', termId: term.id, promptLocale: defaultPromptLocale ?? termPromptLocale },
      ]);
    }
  }

  async function recommendTermsFromHistory() {
    if (historicalTermRecommendationBusy || (!manualPrompt.trim() && !effectiveTerms.length)) return;
    setHistoricalTermRecommendationBusy(true);
    try {
      const candidateTerms =
        dictionaryScope.mode === 'SELECTED'
          ? await window.desktopApi.dictionarySearch({
              locale,
              query: '',
              facetValueIds: [],
              excludeDrafts: false,
              excludeUncited: false,
              includeArchived: false,
              packReleaseIds: dictionaryPackReleaseIds,
              includeLocalTerms: dictionaryScope.includeLocalTerms,
            })
          : data.terms;
      const run = await window.desktopApi.historicalTermRecommendationsCreate({
        scope: assistantScope,
        prompt: manualPrompt,
        selectedTermIds: effectiveTerms.map((item) => item.term.id),
        candidateTermIds: candidateTerms.map((term) => term.id),
        locale,
        limit: 8,
      });
      setHistoricalTermRecommendationRuns((current) =>
        [run, ...current.filter((item) => item.id !== run.id)].slice(0, 6),
      );
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setHistoricalTermRecommendationBusy(false);
    }
  }

  function addHistoricalTermRecommendation(termId: string) {
    const term = data.terms.find((item) => item.id === termId);
    if (!term || effectiveTerms.some((item) => item.term.id === termId)) return;
    if (promptComposerRef.current) promptComposerRef.current.insertTerm(term.id);
    else
      updatePromptDocument([
        ...promptNodes,
        { kind: 'TERM', termId: term.id, promptLocale: defaultPromptLocale ?? termPromptLocale },
      ]);
  }

  function applyWordPalette(palette: WordPaletteDto, parameterValues: Record<string, string>, promptLocale: Locale) {
    const alreadyApplied = materialsRef.current.appliedPalettes.some(
      (reference) => reference.palette.id === palette.id,
    );
    updateMaterials((current) => ({
      ...current,
      appliedPalettes: alreadyApplied
        ? current.appliedPalettes.map((reference) =>
            reference.palette.id === palette.id
              ? {
                  palette,
                  revision:
                    palette.revisions.find((revision) => revision.id === palette.revisionId) ?? palette.revisions[0],
                  parameterValues,
                  promptLocale,
                }
              : reference,
          )
        : [
            ...current.appliedPalettes,
            {
              palette,
              revision:
                palette.revisions.find((revision) => revision.id === palette.revisionId) ?? palette.revisions[0],
              parameterValues,
              promptLocale,
            },
          ],
    }));
    if (!alreadyApplied) {
      if (promptComposerRef.current)
        promptComposerRef.current.insertRecipe(palette.id, pendingRecipeInsertPositionRef.current ?? undefined);
      else updatePromptDocument([...promptNodes, { kind: 'RECIPE', paletteId: palette.id }]);
    } else {
      promptComposerRef.current?.focusRecipe(palette.id);
    }
    pendingRecipeInsertPositionRef.current = null;
    notify(c.recipeApplied);
  }

  function changeWordPalettePromptLocale(paletteId: string, promptLocale: Locale) {
    updateMaterials((current) => ({
      ...current,
      appliedPalettes: current.appliedPalettes.map((reference) =>
        reference.palette.id === paletteId ? { ...reference, promptLocale } : reference,
      ),
    }));
  }

  function requestWordPalette(palette: WordPaletteDto, position: number | null = null) {
    pendingRecipeInsertPositionRef.current = position;
    if (paletteDialogFrameRef.current !== null) {
      cancelAnimationFrame(paletteDialogFrameRef.current);
      paletteDialogFrameRef.current = null;
    }
    const alreadyApplied = materialsRef.current.appliedPalettes.some(
      (reference) => reference.palette.id === palette.id,
    );
    if (!alreadyApplied && defaultPromptLocale && palette.parameters.length === 0) {
      applyWordPalette(palette, {}, defaultPromptLocale);
      return;
    }
    paletteDialogFrameRef.current = requestAnimationFrame(() => {
      paletteDialogFrameRef.current = null;
      setPaletteToApply(palette);
    });
  }

  function createdWordPalette(palette: WordPaletteDto) {
    setWordPalettes((current) =>
      palette.status === 'ACTIVE'
        ? [palette, ...current.filter((item) => item.id !== palette.id)]
        : current.filter((item) => item.id !== palette.id),
    );
    void refresh();
    notify(c.recipeSaved);
  }

  async function adoptAssistantPrompt(run: AssistantRunDto, value: AssistantProposalApplyValue): Promise<boolean> {
    const currentTermPromptLocales = new Map(
      promptNodes.flatMap((node) =>
        node.kind === 'TERM' ? [[node.termId, node.promptLocale ?? termPromptLocale] as const] : [],
      ),
    );
    const nextPromptNodes = normalizeCreatorPromptNodes(
      value.kind === 'PROMPT_TEXT'
        ? replaceCreatorPromptText(promptNodes, value.prompt)
        : value.draft.contentNodes.map((node): CreatorPromptNodeInput =>
            node.kind === 'TEXT'
              ? { kind: 'TEXT', text: node.text }
              : node.kind === 'TERM'
                ? {
                    kind: 'TERM',
                    termId: node.termId,
                    promptLocale: currentTermPromptLocales.get(node.termId) ?? defaultPromptLocale ?? termPromptLocale,
                  }
                : { kind: 'RECIPE', paletteId: node.paletteId },
          ),
    );
    const draftTermRevisions = new Map(
      value.kind === 'PROMPT_DRAFT'
        ? value.draft.contentNodes.flatMap((node) =>
            node.kind === 'TERM' ? [[node.termId, node.termRevisionId] as const] : [],
          )
        : selectedTerms.map((term) => [term.id, term.termRevisionId] as const),
    );
    const nextSelectedTerms = nextPromptNodes.flatMap((node) => {
      if (node.kind !== 'TERM') return [];
      const term = data.terms.find((item) => item.id === node.termId);
      return term && draftTermRevisions.get(node.termId) === term.termRevisionId ? [term] : [];
    });
    const expectedTermCount = nextPromptNodes.filter((node) => node.kind === 'TERM').length;
    const availablePalettes = new Map(appliedPaletteCacheRef.current);
    const nextAppliedPalettes = nextPromptNodes.flatMap((node) => {
      if (node.kind !== 'RECIPE') return [];
      const reference = availablePalettes.get(node.paletteId);
      if (!reference) return [];
      if (value.kind === 'PROMPT_DRAFT') {
        const proposed = value.draft.contentNodes.find(
          (item) => item.kind === 'RECIPE' && item.paletteId === node.paletteId,
        );
        if (!proposed || proposed.kind !== 'RECIPE' || proposed.paletteRevisionId !== reference.revision.id) return [];
      }
      return [reference];
    });
    const expectedRecipeCount = nextPromptNodes.filter((node) => node.kind === 'RECIPE').length;
    if (nextSelectedTerms.length !== expectedTermCount || nextAppliedPalettes.length !== expectedRecipeCount) {
      notify(
        locale === 'zh'
          ? 'Prompt 草稿引用的词条或配方已变化，请重新整理'
          : 'A draft term or recipe changed. Organize the Prompt again.',
      );
      return false;
    }
    const nextManualPrompt = creatorPromptText(nextPromptNodes);
    const nextResolution = resolveCreatorPrompt({
      manualPrompt: nextManualPrompt,
      promptNodes: nextPromptNodes,
      selectedTerms: nextSelectedTerms,
      appliedPalettes: nextAppliedPalettes,
      termPromptLocale,
      promptProfileId,
    });
    const adoptedContextKey = buildCreatorAssistantContextKey({
      resolution: nextResolution,
      referenceAssets,
      canvasPresetKey: canvasPreset?.stableKey ?? null,
      canvasWidth: canvasPreset?.width ?? null,
      canvasHeight: canvasPreset?.height ?? null,
      generationTargets,
    });
    if (!run.proposal || run.proposal.status === 'CLOSED') return false;
    const frozenContextMatches =
      run.contextKey === assistantContextKey || run.proposal.adoptedContextKey === assistantContextKey;
    if (!frozenContextMatches) {
      notify(
        locale === 'zh'
          ? '当前创作输入已变化，请重新使用“AI帮写”'
          : 'The creation input changed. Organize the Prompt again.',
      );
      return false;
    }
    const beforeDocument = {
      promptNodes: normalizeCreatorPromptNodes(promptNodes),
      termIds: selectedTerms.map((term) => term.id),
      wordPaletteReferences: appliedPalettes.map((reference) => ({
        paletteId: reference.palette.id,
        paletteRevisionId: reference.revision.id,
        parameterValues: reference.parameterValues,
        promptLocale: reference.promptLocale,
      })),
    };
    const afterDocument = {
      promptNodes: nextPromptNodes,
      termIds: nextSelectedTerms.map((term) => term.id),
      wordPaletteReferences: nextAppliedPalettes.map((reference) => ({
        paletteId: reference.palette.id,
        paletteRevisionId: reference.revision.id,
        parameterValues: reference.parameterValues,
        promptLocale: reference.promptLocale,
      })),
    };
    try {
      const adopted = await window.desktopApi.assistantProposalAdopt({
        runId: run.id,
        baseContextKey: assistantContextKey,
        resultContextKey: adoptedContextKey,
        authorizedContextKey: adoptedContextKey,
        beforePrompt: livePrompt,
        afterPrompt: nextResolution.livePrompt,
        beforeDocument,
        afterDocument,
        persistence:
          run.scope.kind === 'DRAFT'
            ? {
                kind: 'DRAFT',
                draft: {
                  id: run.scope.id,
                  targetAlbumId,
                  title: newTitle,
                  text: nextManualPrompt,
                  promptNodes: nextPromptNodes,
                  referenceAssetIds: referenceAssets.map((asset) => asset.id),
                  termPromptLocale,
                  termIds: nextSelectedTerms.map((term) => term.id),
                  wordPaletteReferences: afterDocument.wordPaletteReferences,
                  dictionaryScope,
                  canvasPresetKey: canvasPreset?.stableKey ?? null,
                  quality,
                  selectedModelKeys,
                  repeatCount,
                  modelTargets: generationTargets,
                },
              }
            : {
                kind: 'SERIES',
                version: {
                  seriesId: run.scope.id,
                  creationDraftId: null,
                  title: data.series.find((item) => item.id === run.scope.id)?.title ?? '',
                  titleLocale: locale,
                  manualPrompt: nextManualPrompt,
                  promptNodes: nextPromptNodes,
                  prompt: nextResolution.livePrompt,
                  resolvedPrompt: nextResolution.composition,
                  changeSummary: locale === 'zh' ? '采用 AI 帮写' : 'Applied AI writing',
                  referenceAssetIds: referenceAssets.map((asset) => asset.id),
                  termPromptLocale,
                  termIds: nextSelectedTerms.map((term) => term.id),
                  wordPaletteReferences: afterDocument.wordPaletteReferences,
                  modelKey: generationTargets[0]?.modelKey ?? 'gpt-image-2',
                  canvasPresetKey: canvasPreset?.stableKey ?? null,
                  width: canvasPreset?.width ?? null,
                  height: canvasPreset?.height ?? null,
                  quality: generationTargets[0]?.quality ?? 'low',
                },
              },
      });
      setMinimalAssistantRun((current) => (current?.id === adopted.id ? adopted : current));
      updatePromptDocument(nextPromptNodes);
      notify(c.promptApplied);
      void refresh().catch(() => undefined);
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  async function requestMinimalAssistant(
    mode: 'directions' | 'optimize',
    creationId?: string,
    webSearchMode: AssistantWebSearchMode = 'DISABLED',
  ) {
    if (minimalAssistantBusy) return;
    if (mode === 'optimize' && !promptNodes.some((node) => node.kind !== 'TEXT' || Boolean(node.text.trim()))) return;
    const requestRevision = ++minimalAssistantRequestRevision.current;
    setMinimalAssistantBusy(true);
    setMinimalAssistantMode(mode);
    setMinimalAssistantError('');
    setMinimalAssistantProgressEvents([]);
    try {
      const scope = await ensureAgentScope();
      const assistContext = buildCreatorAssistContext(promptResolution, selectedTerms, locale);
      const candidatePool =
        mode === 'optimize' && dictionaryScope.mode === 'SELECTED'
          ? await window.desktopApi.dictionarySearch({
              locale,
              query: '',
              facetValueIds: [],
              excludeDrafts: false,
              excludeUncited: false,
              includeArchived: false,
              packReleaseIds: dictionaryPackReleaseIds,
              includeLocalTerms: dictionaryScope.includeLocalTerms,
            })
          : data.terms;
      const candidateTerms =
        mode === 'optimize'
          ? rankPromptDraftTermCandidates({
              terms: candidatePool,
              selectedTermIds: selectedTerms.map((term) => term.id),
              excludedTermIds: assistContext.recipes.flatMap((recipe) =>
                recipe.internalTerms.map((term) => term.stableId),
              ),
              selectedFacetValueIds: selectedTerms.flatMap(termFacetValueIds),
              signalTexts: [
                manualPrompt,
                ...assistContext.directTerms.flatMap((term) => [term.displayName, term.promptFragment]),
                ...assistContext.recipes.flatMap((recipe) => [
                  recipe.displayName,
                  recipe.promptFragment,
                  ...recipe.internalTerms.flatMap((term) => [term.displayName, term.promptFragment]),
                ]),
              ],
            }).map((term) => creatorAssistantTermInput(term, undefined, locale, promptProfileId))
          : [];
      const turn = await window.desktopApi.agentAssist({
        scope,
        ...(creationId ? { creationId } : {}),
        mode,
        webSearchMode,
        ...assistContext,
        contentNodes: buildCreatorAssistPromptNodes(promptNodes, selectedTerms, appliedPalettes),
        candidateTerms,
        ...(mode === 'directions'
          ? {
              previousDirectionCoverage: directionCoverageMemory(assistantHistory, assistantContextKey),
            }
          : {}),
        contextKey: assistantContextKey,
        referenceAssets: referenceAssets.map((asset) => ({
          assetId: asset.id,
          kind: asset.kind,
          ...(asset.originType ? { originType: asset.originType } : {}),
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
        })),
        termPromptLocale,
        canvasPresetKey: canvasPreset?.stableKey ?? null,
        canvasWidth: canvasPreset?.width ?? null,
        canvasHeight: canvasPreset?.height ?? null,
        generationTargets,
      });
      await refresh().catch(() => undefined);
      if (minimalAssistantRequestRevision.current !== requestRevision) return;
      setMinimalAssistantRun(turn);
      setMinimalAssistantProgressEvents(turn.activityEvents ?? []);
      if (turn.status !== 'SUCCEEDED') {
        setMinimalAssistantError(
          turn.errorMessage || (locale === 'zh' ? '助手提案未完成' : 'Assistant proposal did not complete'),
        );
      } else if (mode === 'directions' && turn.creationId) {
        setSelectedIdeaCreationId(turn.creationId);
        setOutputMode('records');
        setSelectedAlbumId(null);
        panes.setOutputCollapsed(false);
        panes.setCompactPanel('output');
        const nextLocation: CreatorLocation = { surface: 'idea-creation', creationId: turn.creationId };
        if (appliedLocationKeyRef.current !== navigationLocationKey(nextLocation)) {
          commitCreatorLocation(nextLocation, 'push');
        }
      }
    } catch (reason) {
      if (minimalAssistantRequestRevision.current !== requestRevision) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setMinimalAssistantError(
        message.includes('Configure and enable the DeepSeek API extension') ||
          message.includes('DeepSeek V4 Flash is unavailable')
          ? messages.creator.starter.deepSeekConfigurationRequired
          : message,
      );
    } finally {
      if (minimalAssistantRequestRevision.current === requestRevision) {
        setMinimalAssistantBusy(false);
        setMinimalAssistantMode(null);
      }
    }
  }

  async function requestSeriesRename(item: PromptSeriesDto) {
    if (!(await chooseSeries(item.id))) return;
    setRenameOpen(true);
  }

  async function handleRenameAlbum(album: AlbumDto, title: string) {
    await window.desktopApi.albumsRename({ albumId: album.id, title, locale });
    await refreshAlbums();
    notify(messages.creator.album.albumRenamed);
  }

  async function handleRenameDocument(documentId: string, title: string) {
    const updated = await window.desktopApi.videoDocumentRename({ documentId, title });
    onDocumentsChange(updated, false);
  }

  async function handleRenameArticle(article: ArticleDto, title: string) {
    await window.desktopApi.articleRename({ id: article.id, title });
    await refresh();
    notify(locale === 'zh' ? '文章标题已更新' : 'Article title updated');
  }

  async function createAlbum(
    parent: AlbumDto | null,
    title: string,
    destination: 'LIBRARY' | 'NEW_CREATION' = 'LIBRARY',
  ) {
    if (lifecycleActionBusy) return;
    setLifecycleBusy(true);
    try {
      const created = await window.desktopApi.albumsCreate({
        title,
        titleLocale: locale,
        parentAlbumId: parent?.id ?? null,
      });
      await refreshAlbums();
      if (destination === 'NEW_CREATION') await changeNewCreationAlbum(created.id);
      else await chooseAlbum(created.id);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function toggleAlbumPin(album: AlbumDto) {
    setLifecycleBusy(true);
    try {
      await window.desktopApi.albumsSetPinned({ albumId: album.id, pinned: !album.pinned });
      await refreshAlbums();
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function toggleCreationItemPin(creationItemId: string, pinned: boolean) {
    if (lifecycleActionBusy) return;
    setLifecycleBusy(true);
    try {
      await window.desktopApi.creationItemSetPinned({ creationItemId, pinned });
      await refresh();
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function dismissAssistantRun(run: AssistantRunDto) {
    setMinimalAssistantRun((current) => (current?.id === run.id ? null : current));
    setMinimalAssistantError('');
    if (run.status === 'RUNNING') return;
    try {
      if (run.proposal && run.proposal.status !== 'CLOSED') {
        await window.desktopApi.assistantProposalClose(run.id);
      } else {
        await window.desktopApi.assistantRunDismiss(run.id);
      }
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function moveAlbum(albumId: string, parentAlbumId: string | null) {
    if (lifecycleActionBusy) return;
    return albumMoveQueue.enqueue(async () => {
      try {
        await window.desktopApi.albumsMove({ albumId, parentAlbumId });
        await refreshAlbums();
        notify(messages.gallery.albums.moved);
      } catch (reason) {
        notify(
          `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
        throw reason;
      }
    });
  }

  async function moveCreationItemToAlbum(creationItemId: string, albumId: string | null) {
    if (lifecycleActionBusy) return;
    return albumMoveQueue.enqueue(async () => {
      try {
        await window.desktopApi.creationItemMove({ creationItemId, albumId });
        await refresh();
        notify(albumId ? messages.gallery.albums.added : messages.gallery.albums.removed);
      } catch (reason) {
        try {
          await refresh();
        } catch {
          // The original operation error is the actionable notification.
        }
        notify(
          `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
        throw reason;
      }
    });
  }

  function reviewDirectionExperiment(assistantRun: AssistantRunDto, directions: DirectionProposalDto[]) {
    if (!directions.length || !assistantRun.proposal) return;
    setPendingExperimentAssistantRun(assistantRun);
    setPendingExperimentDirections(directions);
    setExplorationError('');
    setExplorationDialogOpen(true);
  }

  async function startDirectionExperiment(delegation: DirectionExperimentDelegationInput) {
    const assistantRun = pendingExperimentAssistantRun;
    if (!assistantRun?.proposal || assistantRun.status !== 'SUCCEEDED' || !pendingExperimentDirections.length) return;
    if (!assistantRun.proposal || ['EXPIRED', 'CLOSED'].includes(assistantRun.proposal.status)) {
      setExplorationError(
        locale === 'zh'
          ? '此方向提案已过期或关闭，请重新获取方向。'
          : 'This direction proposal is expired or closed. Request fresh directions.',
      );
      return;
    }
    if (
      !assistantRun.input.sourceExperimentSlotId &&
      assistantRun.contextKey !== assistantContextKey &&
      assistantRun.proposal.adoptedContextKey !== assistantContextKey
    ) {
      setExplorationError(
        locale === 'zh'
          ? '当前创作输入已变化，请重新获取方向后再启动实验。'
          : 'The current creation input has changed. Request fresh directions before starting the experiment.',
      );
      return;
    }
    setExplorationStarting(true);
    setExplorationError('');
    try {
      const batch = await window.desktopApi.styleExplorationStart(
        buildStyleExplorationStartInput({
          assistantRun,
          directions: pendingExperimentDirections,
          locale,
          delegation,
        }),
      );
      await refresh();
      if (assistantRun.proposal) {
        setMinimalAssistantRun((current) =>
          current?.id === assistantRun.id
            ? {
                ...current,
                proposal: {
                  ...assistantRun.proposal!,
                  status: 'ADOPTED',
                  adoptedContextKey: assistantRun.input.sourceExperimentSlotId
                    ? assistantRun.contextKey
                    : assistantContextKey,
                  updatedAt: new Date().toISOString(),
                },
              }
            : current,
        );
      }
      setExplorationDialogOpen(false);
      setPendingExperimentDirections([]);
      setPendingExperimentAssistantRun(null);
      notify(
        locale === 'zh'
          ? `方向实验已委派 · ${batch.totalCount}`
          : `Direction experiment delegated · ${batch.totalCount}`,
      );
    } catch (reason) {
      setExplorationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExplorationStarting(false);
    }
  }

  async function stopDirectionExperiment(batchId: string) {
    if (stoppingExplorationIds.includes(batchId)) return;
    setStoppingExplorationIds((current) => [...current, batchId]);
    try {
      await window.desktopApi.styleExplorationCancel(batchId);
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStoppingExplorationIds((current) => current.filter((id) => id !== batchId));
    }
  }

  async function retryDirectionSlot(slotId: string) {
    if (retryingExplorationSlotIds.includes(slotId)) return;
    setRetryingExplorationSlotIds((current) => [...current, slotId]);
    try {
      await window.desktopApi.styleExplorationRetrySlot(slotId);
      await refresh();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRetryingExplorationSlotIds((current) => current.filter((id) => id !== slotId));
    }
  }

  async function proposeAdjacentDirection(slot: StyleExplorationSlotDto) {
    if (proposingAdjacentSlotIds.includes(slot.id)) return;
    setProposingAdjacentSlotIds((current) => [...current, slot.id]);
    try {
      const run = await window.desktopApi.styleExplorationProposeAdjacent(slot.id);
      await refresh().catch(() => undefined);
      setMinimalAssistantRun(run);
      const directions = run.proposal?.result.directions ?? [];
      if (run.status === 'SUCCEEDED' && directions.length) {
        reviewDirectionExperiment(run, directions);
      } else {
        const message =
          run.errorMessage || (locale === 'zh' ? '相邻方向提案未完成' : 'Adjacent direction proposal did not complete');
        setMinimalAssistantError(message);
        notify(message);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setMinimalAssistantError(message);
      notify(message);
    } finally {
      setProposingAdjacentSlotIds((current) => current.filter((id) => id !== slot.id));
    }
  }

  async function continueDirection(slot: StyleExplorationSlotDto) {
    if (!(await chooseSeries(slot.seriesId, undefined, 'push', slot.versionId))) return;
    notify(locale === 'zh' ? `继续方向 · ${slot.label}` : `Continuing direction · ${slot.label}`);
  }

  function openExplorationAsset(assetId: string) {
    const owner = data.series.find((item) => allAssets(item).some((asset) => asset.id === assetId));
    if (!owner) return;
    setOutputSeriesId(owner.id);
    setRequestedAssetId(assetId);
    setOutputGalleryOpen(false);
    panes.setOutputCollapsed(false);
    panes.setCompactPanel('output');
  }

  async function openKnowledgeDistillation(assetId: string) {
    if (distillingAssetId) return;
    setDistillationAssetId(assetId);
    setDistillingAssetId(assetId);
    setDistillationError('');
    try {
      let proposals = await window.desktopApi.knowledgeDistillationList(assetId);
      if (!proposals.length) {
        proposals = [await window.desktopApi.knowledgeDistillationCreate({ sourceAssetId: assetId, locale })];
      }
      setDistillationProposals(proposals);
      setDistillationDialogOpen(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setDistillationError(message);
      notify(message);
    } finally {
      setDistillingAssetId(null);
    }
  }

  async function createKnowledgeDistillation() {
    if (!distillationAssetId || distillingAssetId) return;
    setDistillingAssetId(distillationAssetId);
    setDistillationError('');
    try {
      const proposal = await window.desktopApi.knowledgeDistillationCreate({
        sourceAssetId: distillationAssetId,
        locale,
      });
      setDistillationProposals((current) => [proposal, ...current.filter((item) => item.id !== proposal.id)]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setDistillationError(message);
      notify(message);
    } finally {
      setDistillingAssetId(null);
    }
  }

  async function acceptKnowledgeDistillation(proposalId: string, matchedTermIds: string[], candidateIds: string[]) {
    if (acceptingDistillationProposalId) return;
    setAcceptingDistillationProposalId(proposalId);
    setDistillationError('');
    try {
      const result = await window.desktopApi.knowledgeDistillationAccept({
        proposalId,
        locale,
        matchedTermIds,
        candidateIds,
      });
      setDistillationProposals((current) =>
        current.map((proposal) => (proposal.id === result.proposal.id ? result.proposal : proposal)),
      );
      setWordPalettes((current) => [result.palette, ...current.filter((palette) => palette.id !== result.palette.id)]);
      await refresh().catch(() => undefined);
      setDistillationDialogOpen(false);
      setDistilledPaletteToEdit(result.palette);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setDistillationError(message);
      notify(message);
    } finally {
      setAcceptingDistillationProposalId(null);
    }
  }

  async function generate() {
    if (!readiness.ready || starting || versionCreating) return;
    const keepEditorOpen = Boolean(editorDerivedVisual);
    const visibleRefinement = annotationRefinementState;
    if (visibleRefinement) {
      setStarting(true);
      try {
        const result = await window.desktopApi.imageEditStartBatch({
          seriesId: visibleRefinement.sourceSeriesId,
          sourceAssetId: visibleRefinement.sourceAssetId,
          annotationIds: visibleRefinement.annotations.map((annotation) => annotation.id),
          targets: generationTargets.map((target) => ({ ...target })),
          mode: 'SEMANTIC',
          locale,
        });
        await refresh();
        setOutputSeriesId(result.seriesId);
        panes.setCompactPanel('output');
        notify(`${c.generationStarted} · ${result.runIds.length}`);
      } catch (reason) {
        notify(`${c.generationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        setStarting(false);
      }
      return;
    }
    let capturedPrompt: CapturedCreatorPrompt;
    try {
      capturedPrompt = captureVisiblePrompt();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const capturedResolution = resolveCreatorPrompt({
      manualPrompt: capturedPrompt.manualPrompt,
      promptNodes: capturedPrompt.nodes,
      selectedTerms: capturedPrompt.selectedTerms,
      appliedPalettes: capturedPrompt.appliedPalettes,
      termPromptLocale,
      promptProfileId,
    });
    if (!capturedResolution.livePrompt.trim()) return;
    synchronizeCapturedPrompt(capturedPrompt);
    const creating = creationMode === 'new';
    const typedTitle = newTitle.trim();
    const initialTitle = creating ? typedTitle || '新创作' : series?.title || '新创作';
    invalidatePendingCreationDraftAutosaves();
    setStarting(true);
    try {
      const draftIdForGeneration = creating ? (await saveCreationDraftNow(undefined, capturedPrompt)).id : null;
      const result = await window.desktopApi.generationStartBatch({
        input: {
          seriesId: creating ? null : seriesId,
          creationDraftId: draftIdForGeneration,
          inspirationStashId: selectedInspirationStashId,
          baseVersionId: creating ? null : (version?.id ?? null),
          title: initialTitle,
          titleLocale: locale,
          manualPrompt: capturedPrompt.manualPrompt,
          promptNodes: capturedPrompt.nodes,
          prompt: capturedResolution.livePrompt,
          resolvedPrompt: capturedResolution.composition,
          changeSummary: automaticChangeSummary,
          referenceAssetIds: referenceAssets.map((item) => item.id),
          termPromptLocale,
          termIds: capturedPrompt.selectedTerms.map((term) => term.id),
          wordPaletteReferences: capturedPrompt.appliedPalettes.map((reference) => ({
            paletteId: reference.palette.id,
            paletteRevisionId: reference.revision.id,
            parameterValues: reference.parameterValues,
            promptLocale: reference.promptLocale,
          })),
          canvasPresetKey: canvasPreset?.stableKey ?? null,
          width: canvasPreset?.width ?? null,
          height: canvasPreset?.height ?? null,
          quality,
        },
        targets: generationTargets,
      });
      await refresh();
      setCreationMode('existing');
      setTargetAlbumId(null);
      setSelectedInspirationStashId(null);
      setSavedInspirationContentKey(null);
      creationDraftIdRef.current = null;
      setCreationDraftId(null);
      if (creating) savedDraftRef.current = null;
      setSelectedIdeaCreationId(null);
      setOutputMode('results');
      setSeriesId(result.seriesId);
      setOutputSeriesId(result.seriesId);
      setVersionId(result.versionId);
      panes.setOutputCollapsed(false);
      panes.setCompactPanel('output');
      commitGeneratedImageLocation(keepEditorOpen, result.seriesId, result.versionId, commitCreatorLocation);
      notify(`${c.generationStarted} · ${result.runIds.length}`);
      if (creating && !typedTitle) {
        setPendingAutoTitle({
          runId: result.runIds[0],
          seriesId: result.seriesId,
          prompt: capturedResolution.livePrompt,
          initialTitle,
        });
      }
    } catch (reason) {
      notify(`${c.generationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setStarting(false);
    }
  }

  const generateRef = useRef(generate);
  generateRef.current = generate;

  useEffect(() => {
    if (!active) return;
    function submitOnShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key !== 'Enter') return;
      if (!(event.target instanceof Element) || !event.target.closest('[data-generation-prompt="true"]')) return;
      event.preventDefault();
      void generateRef.current();
    }
    window.addEventListener('keydown', submitOnShortcut);
    return () => window.removeEventListener('keydown', submitOnShortcut);
  }, [active]);

  async function cancelGeneration(runId: string) {
    await window.desktopApi.generationCancel(runId);
    await refresh();
  }

  async function retryGeneration(runId: string) {
    const result = await window.desktopApi.generationRetry(runId);
    await refresh();
    notify(`${c.generationStarted} · ${result.runId.slice(-6)}`);
  }

  async function reEditGeneration(runId: string) {
    const next = generationReEditLocation(data, runId, Date.now());
    if (!next || next.surface !== 'existing-creation') return;
    if (!(await chooseSeries(next.seriesId, next.assetId ?? undefined, null, next.versionId))) return;
    commitCreatorLocation(next);
  }

  async function refineImage(input: Omit<ImageEditBatchStartInput, 'locale'>) {
    const result = await window.desktopApi.imageEditStartBatch({
      ...input,
      locale,
    });
    await refresh();
    setOutputSeriesId(result.seriesId);
    panes.setCompactPanel('output');
  }

  async function cropImage(input: ImageCropInput): Promise<ImageTransformOutputDto> {
    const output = await window.desktopApi.imageCrop(input);
    await refresh();
    setOutputSeriesId(output.seriesId);
    panes.setCompactPanel('output');
    return output;
  }

  async function reframeImage(input: Omit<ImageReframeStartInput, 'locale' | 'quality'>) {
    const quality = generationTargets.find((target) => target.modelKey === input.modelKey)?.quality ?? 'medium';
    const result = await window.desktopApi.imageReframeStart({
      ...input,
      locale,
      quality,
    });
    await refresh();
    setOutputSeriesId(result.seriesId);
    panes.setCompactPanel('output');
  }

  async function generateVersion(input: GenerationVersionInput) {
    const result = await window.desktopApi.generationStartVersion(input);
    await refresh();
    notify(`${c.generationStarted} · ${result.runId.slice(-6)}`);
  }

  async function reusePromptInput(
    targetSeriesId: string,
    targetVersionId: string,
    annotationHistoryVersionId: string | null,
  ) {
    const targetSeries = data.series.find((item) => item.id === targetSeriesId);
    const targetVersion = targetSeries?.versions.find((item) => item.id === targetVersionId);
    if (!targetSeries || !targetVersion) return null;
    if (creationMode === 'existing' && seriesId === targetSeriesId && selectedAlbumId === null) {
      setVersionId(targetVersion.id);
      restoreVersion(targetVersion);
    } else if (!(await chooseSeries(targetSeries.id, undefined, null, targetVersion.id))) {
      return null;
    }
    const reusedAnnotations = annotationHistoryVersionId
      ? await window.desktopApi.annotationsReuseHistory({ promptVersionId: annotationHistoryVersionId })
      : null;
    const annotationAssetId = reusedAnnotations?.imageAssetId ?? null;
    if (annotationAssetId) {
      setRequestedAssetId(annotationAssetId);
      setOutputGalleryOpen(false);
      panes.setOutputCollapsed(false);
      panes.setCompactPanel('output');
      commitCreatorLocation({
        surface: 'existing-creation',
        seriesId: targetSeries.id,
        assetId: annotationAssetId,
        versionId: targetVersion.id,
        workspace: 'annotations',
        requestId: Date.now(),
      });
    } else {
      panes.setCompactPanel('creator');
    }
    return { annotationsReused: Boolean(reusedAnnotations) };
  }

  async function generateImportedPrompt(input: GenerationInput) {
    const result = await window.desktopApi.generationStart(input);
    await refresh();
    notify(`${c.generationStarted} · ${result.runId.slice(-6)}`);
  }

  const relevantStyleExplorations = data.styleExplorationBatches
    .filter(
      (batch) =>
        (creationMode === 'existing' &&
          seriesId &&
          ((batch.scope.kind === 'SERIES' && batch.scope.id === seriesId) ||
            batch.slots.some((slot) => slot.seriesId === seriesId))) ||
        (creationMode === 'new' &&
          creationDraftId &&
          batch.scope.kind === 'DRAFT' &&
          batch.scope.id === creationDraftId),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, 6);
  const pendingExperimentInput = pendingExperimentAssistantRun?.input ?? null;
  const pendingExperimentTargets = pendingExperimentInput?.generationTargets ?? generationTargets;
  const pendingExperimentCanvas = pendingExperimentInput
    ? data.canvasPresets.find((preset) => preset.stableKey === pendingExperimentInput.canvasPresetKey)
    : canvasPreset;
  const pendingExperimentWidth = pendingExperimentInput
    ? pendingExperimentInput.canvasWidth
    : (canvasPreset?.width ?? null);
  const pendingExperimentHeight = pendingExperimentInput
    ? pendingExperimentInput.canvasHeight
    : (canvasPreset?.height ?? null);
  const pendingExperimentCanvasLabel =
    pendingExperimentWidth && pendingExperimentHeight
      ? `${pendingExperimentCanvas?.ratio || pendingExperimentInput?.canvasPresetKey || (locale === 'zh' ? '自定义' : 'Custom')} · ${pendingExperimentWidth}×${pendingExperimentHeight}`
      : null;
  const pendingExperimentReferenceCount = pendingExperimentInput?.referenceAssets.length ?? referenceAssets.length;
  const pendingExperimentObjective = (
    pendingExperimentInput?.prompt.trim() ||
    pendingExperimentAssistantRun?.proposal?.result.promptEdit?.summary.trim() ||
    pendingExperimentDirections.map((direction) => direction.label).join(' / ') ||
    (locale === 'zh' ? '方向实验' : 'Direction experiment')
  ).slice(0, 2_000);

  const explorationPanel = (
    <StyleExplorationPanel
      className="mt-4"
      batches={relevantStyleExplorations}
      series={data.series}
      stoppingBatchIds={stoppingExplorationIds}
      retryingSlotIds={retryingExplorationSlotIds}
      proposingAdjacentSlotIds={proposingAdjacentSlotIds}
      onStop={stopDirectionExperiment}
      onRetrySlot={(_batchId, slotId) => retryDirectionSlot(slotId)}
      onProposeAdjacent={proposeAdjacentDirection}
      onContinueDirection={continueDirection}
      onOpenAsset={openExplorationAsset}
      notify={notify}
    />
  );

  const materialPickerControl = (
    <CreationMaterialPicker
      libraryKey={data.spaceName}
      dataRevision={dataRevision}
      terms={data.terms}
      facets={data.facets}
      selectedAssets={referenceAssets}
      disabled={referenceImporting}
      onBeforeOpen={onTermDetailsRequest}
      onApply={applyReferenceAssets}
      onImport={attachReferences}
    />
  );
  const videoPickerControl = (
    <>
      <VideoFileInput
        inputRef={newCreationVideoInputRef}
        onSelect={(file) => {
          selectCreationStartMode('video-document');
          setVideoCreationRequest({ file, source: 'UPLOAD' });
        }}
      />
      <Button
        data-action="creation-video-picker"
        type="button"
        variant="outline"
        size="icon"
        className="rounded-full"
        title={locale === 'zh' ? '视频转文稿' : 'Video to document'}
        aria-label={locale === 'zh' ? '视频转文稿' : 'Video to document'}
        onClick={() => newCreationVideoInputRef.current?.click()}
      >
        <VideoIcon className="size-4" />
      </Button>
    </>
  );
  const dictionaryPickerProps: Omit<ComponentProps<typeof DictionaryPicker>, 'layout' | 'onClose'> = {
    locale,
    query: termQuery,
    terms: termResults,
    facets: data.facets,
    palettes: scopedWordPalettes,
    selectedTerms,
    focusTarget: dictionaryFocusTarget,
    scopeMode: dictionaryScope.mode,
    albumScopeAvailable: Boolean(targetAlbum?.creationDefaults?.dictionaryScope.mode === 'SELECTED'),
    draggableMaterials: true,
    recommendationRuns: historicalTermRecommendationRuns,
    recommendationSelectedTermIds: effectiveTerms.map((item) => item.term.id),
    recommendationBusy: historicalTermRecommendationBusy,
    recommendationAvailable: Boolean(manualPrompt.trim() || effectiveTerms.length),
    onRecommendFromHistory: recommendTermsFromHistory,
    onAddRecommendation: addHistoricalTermRecommendation,
    onScopeModeChange: (mode) => setDictionaryScope((current) => ({ ...current, mode })),
    onQueryChange: setTermQuery,
    onToggle: toggleTerm,
    onClear: clearDictionaryMaterials,
    onPaletteApply: (palette) => requestWordPalette(palette),
    onPaletteView: (palette) => setPaletteInspector({ mode: 'view', palette }),
    onPaletteCreated: createdWordPalette,
    notify,
  };
  function changePromptFullWindow(open: boolean) {
    onPromptFullWindowChange(open);
    if (!open) return;
    setDictionaryOpen(false);
    setDictionaryFocusTarget(null);
  }
  const dictionaryPickerControl = (
    <Popover
      open={dictionaryOpen}
      onOpenChange={(open) => {
        if (!open && (paletteToApply || paletteInspector)) return;
        setDictionaryOpen(open);
        if (!open) setDictionaryFocusTarget(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          data-action="dictionary-picker"
          variant={dictionaryOpen || dictionarySelectionCount > 0 ? 'secondary' : 'outline'}
          size="icon"
          className="rounded-full shadow-none"
          title={c.dictionary}
          aria-label={c.dictionary}
        >
          <DictionaryIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[760px] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (paletteToApply || paletteInspector) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DictionaryPicker
          {...dictionaryPickerProps}
          onClose={() => {
            setDictionaryOpen(false);
            setDictionaryFocusTarget(null);
          }}
        />
      </PopoverContent>
    </Popover>
  );
  const dictionarySidebarControl = <DictionaryPicker {...dictionaryPickerProps} layout="sidebar" />;
  const canvasPickerControl = (
    <CanvasPresetPicker
      locale={locale}
      presets={data.canvasPresets}
      value={canvasPreset}
      compact
      toolbar
      disabled={Boolean(activeDerivedVisual)}
      onChange={(preset) => setCanvasPresetKey(preset?.stableKey ?? '')}
    />
  );
  const referenceStripControl = (
    <CreationReferenceStrip
      assets={referenceAssets}
      promptResolution={promptResolution}
      hidePromptMaterials
      removeLabel={c.delete}
      onOpenPalette={openPaletteInDictionary}
      onOpenTerm={openTermInDictionary}
      onRemoveAsset={removeReferenceAsset}
      onRemovePalette={removeAppliedPalette}
      onRemoveTerm={toggleTerm}
      notify={notify}
      revealContext={series ? { kind: 'CREATION', seriesId: series.id } : undefined}
    />
  );
  const outputHeaderNavigation = (
    <CreationOutputTabs value={outputMode} locale={locale} onValueChange={(value) => void changeOutputMode(value)} />
  );
  const outputEmptyState = (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-4">
        <span className="text-sm font-semibold">{locale === 'zh' ? '新建成果' : 'New result'}</span>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" onClick={() => panes.setCompactPanel('creator')}>
            {locale === 'zh' ? '图片' : 'Image'}
          </Button>
          <Button type="button" variant="outline" disabled title={locale === 'zh' ? '尚未接入' : 'Not available yet'}>
            {locale === 'zh' ? '文章' : 'Article'}
          </Button>
          <Button type="button" variant="outline" disabled title={locale === 'zh' ? '尚未接入' : 'Not available yet'}>
            {locale === 'zh' ? '视频' : 'Video'}
          </Button>
          <Button type="button" variant="outline" disabled title={locale === 'zh' ? '尚未接入' : 'Not available yet'}>
            {locale === 'zh' ? '音频' : 'Audio'}
          </Button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <nav
        className={
          comparisonFullWindow || promptFullWindow
            ? 'hidden'
            : 'flex h-11 shrink-0 items-center justify-center border-b bg-muted/40 px-3 min-[840px]:hidden'
        }
        aria-label={messages.app.navigation.creator}
      >
        <Segmented
          type="single"
          value={panes.compactPanel}
          onValueChange={(value) => value && panes.setCompactPanel(value as 'library' | 'creator' | 'output')}
        >
          <SegmentedItem value="library" className="px-4">
            {messages.creator.results.library}
          </SegmentedItem>
          <SegmentedItem value="creator" className="px-4">
            {documentWorkspaceActive ? messages.videoDocuments.title : messages.app.navigation.creator}
          </SegmentedItem>
          {showOutputPane && (
            <SegmentedItem value="output" className="px-4">
              {editorDerivedVisual
                ? locale === 'zh'
                  ? editorDerivedVisual.role === 'ARTICLE_HEADER'
                    ? '题图'
                    : editorDerivedVisual.role === 'ARTICLE_INLINE'
                      ? '配图'
                      : '封面'
                  : editorDerivedVisual.role === 'ARTICLE_HEADER'
                    ? 'Hero'
                    : editorDerivedVisual.role === 'ARTICLE_INLINE'
                      ? 'Illustration'
                      : 'Cover'
                : outputMode === 'results'
                  ? locale === 'zh'
                    ? '成果'
                    : 'Results'
                  : outputMode === 'inputs'
                    ? locale === 'zh'
                      ? '输入'
                      : 'Inputs'
                    : locale === 'zh'
                      ? '记录'
                      : 'Records'}
            </SegmentedItem>
          )}
        </Segmented>
      </nav>
      <div
        ref={panes.workspaceRef}
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden"
        style={panes.workspaceGridStyle}
      >
        <div
          className={
            comparisonFullWindow || promptFullWindow
              ? 'hidden'
              : cn(
                  panes.compactPanel === 'library' ? 'block' : 'hidden',
                  'min-h-0 min-w-0 overflow-hidden min-[840px]:block [&>*]:size-full',
                )
          }
        >
          <ResultLibrary
            active={creationLibraryActive}
            data={data}
            locale={locale}
            activeContent={documentWorkspaceActive ? 'documents' : 'images'}
            filter={creationLibraryFilter}
            selectedSeriesId={seriesId}
            selectedCreationId={selectedIdeaCreationId}
            selectedInspirationStashId={selectedInspirationStashId}
            selectedSocialPostId={selectedSocialPostId}
            selectedArticleId={selectedArticleId}
            selectedAlbumId={selectedAlbumId}
            selectedDocumentId={selectedDocumentId}
            selectedDocumentAlbumId={selectedDocumentAlbumId}
            documentNavigationRevision={documentNavigationRevision}
            surface={creatorSurface}
            mode={panes.multiPane ? panes.resultLibraryMode : 'full'}
            canExpand={panes.canExpandResultLibrary}
            resizeValue={panes.resultWidth}
            resizeMin={panes.resultResizeMin}
            resizeMax={panes.resultResizeMax}
            showModeToggle={panes.multiPane}
            lifecycleBusy={lifecycleActionBusy}
            onModeChange={panes.setResultLibraryMode}
            onResizeStart={panes.beginResultResize}
            onResizeValueChange={panes.setResultWidth}
            onFilterChange={setCreationLibraryFilter}
            onSelectInspirationStash={chooseInspirationStash}
            onSelectSocialPost={chooseSocialPost}
            onSelectArticle={chooseArticle}
            onRenameArticle={setRenameArticle}
            onContentLifecycleAction={(request) => void contentLifecycleActions.request(request)}
            onSelect={chooseSeries}
            onOpenDerivedVisual={(visualId) => void resumeDerivedVisual(visualId)}
            onSelectDocument={onSelectDocument}
            onRenameDocument={setRenameDocument}
            onSelectAlbum={chooseAlbum}
            onMore={showMoreResults}
            onNew={() => void startNewCreation(null, 'push', true)}
            onNewInAlbum={(albumId) => void startNewCreation(albumId, 'push', true)}
            onRenameSeries={requestSeriesRename}
            onRenameAlbum={setRenameAlbum}
            onToggleAlbumPin={toggleAlbumPin}
            onCreateAlbum={(parent) => setCreateAlbumRequest({ parent, destination: 'LIBRARY' })}
            onMoveAlbum={moveAlbum}
            onMoveCreationItem={moveCreationItemToAlbum}
            onToggleCreationItemPin={toggleCreationItemPin}
            notify={notify}
          />
        </div>

        {documentWorkspace && (
          <div
            className={cn(
              documentWorkspaceActive && panes.compactPanel === 'creator' ? 'flex' : 'hidden',
              'min-h-0 min-w-0 overflow-hidden bg-background',
              documentWorkspaceActive && 'min-[840px]:flex [&>*]:size-full',
            )}
          >
            {documentWorkspace}
          </div>
        )}

        {!documentWorkspaceActive &&
          selectedSocialPost &&
          !comparisonFullWindow &&
          !promptFullWindow &&
          (panes.multiPane || panes.compactPanel === 'creator') && (
            <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
              <SocialPostEditor
                key={selectedSocialPost.id}
                post={selectedSocialPost}
                locale={locale}
                canvasPresets={data.canvasPresets}
                coverWorkspaceExists={socialCoverWorkspaceExists}
                onSave={(content) => saveSocialPost(selectedSocialPost, content)}
                onCreateArticle={(content, mediaAssets) =>
                  createArticleFromSocialPost(selectedSocialPost, content, mediaAssets)
                }
                onGenerateCover={(content, preset) => openSocialCoverWorkspace(selectedSocialPost, content, preset)}
                notify={notify}
              />
            </div>
          )}

        {!documentWorkspaceActive &&
          selectedArticle &&
          !comparisonFullWindow &&
          !promptFullWindow &&
          (panes.multiPane || panes.compactPanel === 'creator') && (
            <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
              <ArticleEditor
                key={selectedArticle.id}
                article={selectedArticle}
                locale={locale}
                canvasPresets={data.canvasPresets}
                headerWorkspaceExists={articleHeaderWorkspaceExists}
                onSave={(content) => saveArticle(selectedArticle, content)}
                onCopyForWechat={() => copyArticleForWechat(selectedArticle.id)}
                onExport={() => exportArticleMarkdown(selectedArticle.id)}
                onCreateSocialPost={(content) => createSocialPostFromArticle(selectedArticle, content)}
                onGenerateHeader={(content) => openArticleHeaderWorkspace(selectedArticle, content)}
                onGenerateIllustration={(content, selectedText, preset) =>
                  openArticleIllustrationWorkspace(selectedArticle, content, selectedText, preset)
                }
                notify={notify}
              />
            </div>
          )}

        {!documentWorkspaceActive &&
          selectedAlbum &&
          !comparisonFullWindow &&
          !promptFullWindow &&
          (panes.multiPane || panes.compactPanel === 'creator') && (
            <CreatorAlbumDetail
              key={selectedAlbum.id}
              album={selectedAlbum}
              albums={data.albums}
              creationSessions={creationSessions}
              creationItems={data.creationItems}
              filter={creationLibraryFilter}
              documentNavigationRevision={documentNavigationRevision}
              busy={lifecycleActionBusy}
              onSelectAlbum={chooseAlbum}
              onSelectSeries={chooseSeries}
              onSelectDocument={onSelectDocument}
              onOpenMaterial={onOpenMaterial}
              onArchiveMaterial={(item) => {
                const fallbackTitle =
                  item.kind === 'TEXT'
                    ? messages.gallery.card.textMaterial
                    : item.image.asset.kind === 'GENERATED'
                      ? messages.gallery.card.generated
                      : messages.gallery.card.reference;
                void contentLifecycleActions.request({
                  action: 'ARCHIVE',
                  target: creatorMaterialLifecycleTarget(item),
                  title: materialTitle(item, fallbackTitle),
                });
              }}
              onDeleteMaterial={(item) => {
                const fallbackTitle =
                  item.kind === 'TEXT'
                    ? messages.gallery.card.textMaterial
                    : item.image.asset.kind === 'GENERATED'
                      ? messages.gallery.card.generated
                      : messages.gallery.card.reference;
                void contentLifecycleActions.request({
                  action: 'DELETE',
                  target: creatorMaterialLifecycleTarget(item),
                  title: materialTitle(item, fallbackTitle),
                });
              }}
              onRename={handleRenameAlbum}
              onDelete={(album) =>
                contentLifecycleActions.request({
                  action: 'DELETE',
                  target: { entityType: 'ALBUM', entityId: album.id },
                  title: album.title,
                })
              }
              onTogglePin={toggleAlbumPin}
              onArchive={(album) =>
                contentLifecycleActions.request({
                  action: 'ARCHIVE',
                  target: { entityType: 'ALBUM', entityId: album.id },
                  title: album.title,
                })
              }
              onCreateCreation={() => void startNewCreation(selectedAlbum.id, 'push', true)}
              onSettings={() => setSettingsAlbum(selectedAlbum)}
              notify={notify}
            />
          )}

        <PasteDropSurface
          disabled={referenceImporting}
          onImages={(files, source, sourceUrl) => {
            if (newCreationSurface) selectCreationStartMode('image');
            void importReferenceFiles(files, source, sourceUrl);
          }}
          onVideo={(file, source) => {
            if (!newCreationSurface) return;
            selectCreationStartMode('video-document');
            setVideoCreationRequest({ file, source });
          }}
          onText={appendPromptText}
          overlay={
            newCreationSurface ? (
              <div className="flex items-center gap-3 text-muted-foreground">
                <ImageIcon className="size-8" />
                <FileTextIcon className="size-8" />
              </div>
            ) : (
              <ImageIcon className="size-8 text-muted-foreground" />
            )
          }
          className={
            documentWorkspaceActive || comparisonFullWindow || selectedAlbum || selectedSocialPost || selectedArticle
              ? 'hidden'
              : cn(
                  promptFullWindow || panes.compactPanel === 'creator' ? 'flex' : 'hidden',
                  'relative min-h-0 min-w-0 flex-col overflow-hidden bg-background min-[840px]:flex',
                  showOutputPane && !promptFullWindow && 'border-r',
                )
          }
        >
          <header
            className={
              promptFullWindow ? 'hidden' : 'flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4'
            }
          >
            {creationMode === 'new' ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">
                  {creationStartMode === 'video-document'
                    ? messages.videoDocuments.start.title
                    : selectedInspirationStash
                      ? locale === 'zh'
                        ? '灵感暂存'
                        : 'Inspiration stash'
                      : c.newPrompt}
                </span>
                {newCreationSurface && creationStartMode === 'video-document' && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => selectCreationStartMode('image')}>
                    <FileTextIcon className="size-3.5" />
                    {locale === 'zh' ? '返回输入' : 'Back to input'}
                  </Button>
                )}
                {creationStartMode === 'image' && (
                  <SearchableAlbumSelect
                    albums={data.albums}
                    value={targetAlbumId}
                    className="h-8 w-48 max-w-[35vw] text-xs"
                    disabled={starting || versionCreating || lifecycleActionBusy}
                    labels={{
                      ariaLabel: locale === 'zh' ? '选择新创作图集' : 'Choose album for new creation',
                      unfiled: locale === 'zh' ? '不归入图集' : 'Unfiled',
                      searchPlaceholder: locale === 'zh' ? '搜索图集' : 'Search albums',
                      empty: locale === 'zh' ? '没有匹配的图集' : 'No matching albums',
                      create: locale === 'zh' ? '新建图集' : 'New album',
                      createChild: locale === 'zh' ? '新建子图集' : 'New child album',
                    }}
                    onValueChange={(albumId) => void changeNewCreationAlbum(albumId)}
                    onRequestCreate={(parent) => setCreateAlbumRequest({ parent, destination: 'NEW_CREATION' })}
                  />
                )}
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="max-w-36 truncate font-semibold">{sessionHostSeries?.title}</span>
                {viewingExperimentBranch && (
                  <>
                    <span className="text-muted-foreground">/</span>
                    <span className="max-w-32 truncate text-sm text-foreground-secondary">{series?.title}</span>
                  </>
                )}
                {series && (
                  <Button
                    data-action="rename-series"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={c.rename}
                    aria-label={c.rename}
                    onClick={() => setRenameOpen(true)}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                )}
                {series && series.versions.length > 0 && (
                  <Combobox
                    value={version?.id ?? ''}
                    options={series.versions.map((item) => {
                      const experimentVersion =
                        seriesExperimentContext?.slot.versionId === item.id
                          ? seriesExperimentContext.versionLabel
                          : `V${String(item.versionNo).padStart(2, '0')}`;
                      const rawSummary =
                        seriesExperimentContext?.slot.versionId === item.id
                          ? seriesExperimentContext.slot.label
                          : item.changeSummary;
                      const summary =
                        rawSummary === 'MANUAL_PROMPT'
                          ? locale === 'zh'
                            ? '初始 Prompt'
                            : 'Initial Prompt'
                          : rawSummary === 'EXTERNAL_IMPORT'
                            ? messages.creator.comparison.importedPrompt
                            : rawSummary;
                      return {
                        value: item.id,
                        label: `${experimentVersion} · ${summary}`,
                        keywords: `${item.versionNo} ${experimentVersion} ${summary}`,
                      };
                    })}
                    onValueChange={chooseVersion}
                    ariaLabel={c.version}
                    placeholder={c.version}
                    searchPlaceholder={c.searchVersions}
                    emptyText={c.noMatchingVersions}
                    className="h-8 w-52 max-w-[30vw] text-xs"
                    contentClassName="w-80"
                  />
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={locale === 'zh' ? '输入暂存与版本' : 'Input stashes & versions'}
                aria-label={locale === 'zh' ? '输入暂存与版本' : 'Input stashes & versions'}
                disabled={inputStashBusy}
                onClick={() => void openInputStashDialog()}
              >
                <HistoryIcon className="size-3.5" />
              </Button>
              {creationMode === 'new' && creationStartMode === 'image' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setNewExternalCreationDialog({ albumId: targetAlbumId })}
                >
                  <ImportIcon className="size-3.5" />
                  {locale === 'zh' ? '导入外部创作' : 'Import external'}
                </Button>
              )}
            </div>
          </header>
          {newCreationSurface && creationStartMode === 'video-document' ? (
            <VideoDocumentCreationStarter
              locale={locale}
              albums={data.albums}
              defaultAlbumId={targetAlbumId}
              request={videoCreationRequest}
              onRequestChange={setVideoCreationRequest}
              onLibraryChange={refreshAlbums}
              onCreated={(documentId, albumId) => onSelectDocument(documentId, albumId)}
              notify={notify}
            />
          ) : (
            <MinimalCreationStarter
              key={`creation-input-${inputSessionRevision}`}
              locale={locale}
              termPromptLocale={defaultPromptLocale ?? termPromptLocale}
              promptProfileId={promptProfileId}
              prompt={manualPrompt}
              promptNodes={promptNodes}
              terms={data.terms}
              palettes={data.wordPalettes}
              appliedPalettes={appliedPalettes}
              composerRef={promptComposerRef}
              assistantBusy={minimalAssistantBusy}
              assistantMode={minimalAssistantMode}
              canRequestIdeas
              canBuildPrompt={promptNodes.some((node) => node.kind !== 'TEXT' || Boolean(node.text.trim()))}
              routes={imageGenerationRoutes}
              generationTargets={generationTargets}
              generationCount={generationCount}
              readiness={readiness}
              stashReady={promptNodes.some((node) => node.kind !== 'TEXT' || Boolean(node.text.trim()))}
              stashing={inspirationStashBusy}
              stashed={
                Boolean(selectedInspirationStashId) && savedInspirationContentKey === currentInspirationContentKey
              }
              starting={starting || versionCreating}
              planning={creationMode === 'new'}
              startReady={Boolean(livePrompt.trim())}
              fullWindow={promptFullWindow}
              annotationRefinement={annotationRefinementState}
              materialPicker={materialPickerControl}
              dictionaryPicker={dictionaryPickerControl}
              dictionarySidebar={dictionarySidebarControl}
              canvasPicker={canvasPickerControl}
              videoPicker={videoPickerControl}
              references={referenceStripControl}
              experiments={explorationPanel}
              onPromptNodesChange={updatePromptDocument}
              onOpenTerm={openTermInDictionary}
              onOpenRecipe={openPaletteInDictionary}
              onConfigureRecipe={(palette) => requestWordPalette(palette)}
              onRecipePromptLocaleChange={changeWordPalettePromptLocale}
              onRequestRecipeInsert={(palette, position) => requestWordPalette(palette, position)}
              onRequestIdeas={requestProjectIdeas}
              onBuildPrompt={requestProjectWriting}
              onGenerationTargetsChange={setGenerationTargets}
              onConfigureExtension={onConfigureExtension}
              onGenerate={() => void generate()}
              onStashInspiration={() => void stashInspiration()}
              onStartCreation={startCreationFromPlan}
              onChooseVideoDocument={() => selectCreationStartMode('video-document')}
              onFullWindowChange={changePromptFullWindow}
            />
          )}
          {/* Queue, failures and retries stay visible below the single creation surface; a run must never disappear silently. */}
          {(!newCreationSurface || creationStartMode === 'image') && !promptFullWindow && (
            <GenerationTaskTray
              tasks={data.generationTasks}
              routes={imageGenerationRoutes}
              series={series}
              allSeries={data.series}
              onCancel={cancelGeneration}
              onRetry={retryGeneration}
              notify={notify}
            />
          )}
          <ApplyWordPaletteDialog
            locale={locale}
            defaultPromptLocale={defaultPromptLocale ?? locale}
            palette={paletteToApply}
            initialValues={
              appliedPalettes.find((reference) => reference.palette.id === paletteToApply?.id)?.parameterValues
            }
            initialPromptLocale={
              appliedPalettes.find((reference) => reference.palette.id === paletteToApply?.id)?.promptLocale
            }
            open={Boolean(paletteToApply)}
            onOpenChange={(open) => {
              if (!open) {
                pendingRecipeInsertPositionRef.current = null;
                setPaletteToApply(null);
              }
            }}
            onApply={(values, promptLocale) => {
              if (paletteToApply) applyWordPalette(paletteToApply, values, promptLocale);
            }}
          />
          <WordPaletteDetailsDialog
            palette={paletteInspector?.palette ?? null}
            open={paletteInspector?.mode === 'view'}
            onOpenChange={(open) => {
              if (!open && paletteInspector?.mode === 'view') setPaletteInspector(null);
            }}
            onEdit={(palette) => setPaletteInspector({ mode: 'edit', palette })}
            notify={notify}
          />
          <SaveWordPaletteDialog
            locale={locale}
            open={paletteInspector?.mode === 'edit'}
            palette={paletteInspector?.palette ?? null}
            terms={data.terms}
            facets={data.facets}
            onOpenChange={(open) => {
              if (!open && paletteInspector?.mode === 'edit') setPaletteInspector(null);
            }}
            onSaved={(palette) => createdWordPalette(palette)}
            onLifecycleChanged={() => {
              void refresh();
            }}
          />
          <StyleExplorationDialog
            open={explorationDialogOpen}
            directions={pendingExperimentDirections}
            targets={pendingExperimentTargets}
            routes={imageGenerationRoutes}
            commonConstraints={pendingExperimentAssistantRun?.proposal?.result.sharedConstraints ?? []}
            assumptions={pendingExperimentAssistantRun?.proposal?.result.assumptions ?? []}
            objective={pendingExperimentObjective}
            canvasLabel={pendingExperimentCanvasLabel}
            remoteScope={
              locale === 'zh'
                ? [
                    '方向 Prompt 与结构化词条、配方',
                    ...(pendingExperimentReferenceCount ? [`${pendingExperimentReferenceCount} 个参考图片文件`] : []),
                    '模型、质量与画幅设置',
                  ]
                : [
                    'Direction prompts, structured terms and recipes',
                    ...(pendingExperimentReferenceCount
                      ? [`${pendingExperimentReferenceCount} reference image files`]
                      : []),
                    'Model, quality and canvas settings',
                  ]
            }
            busy={explorationStarting}
            error={explorationError}
            onOpenChange={(open) => {
              setExplorationDialogOpen(open);
              if (!open) {
                setExplorationError('');
                setPendingExperimentAssistantRun(null);
                setPendingExperimentDirections([]);
              }
            }}
            onConfirm={startDirectionExperiment}
          />
          <KnowledgeDistillationDialog
            open={distillationDialogOpen}
            locale={locale}
            proposals={distillationProposals}
            busy={Boolean(distillingAssetId)}
            error={distillationError}
            acceptingProposalId={acceptingDistillationProposalId}
            onOpenChange={(open) => {
              setDistillationDialogOpen(open);
              if (!open) setDistillationError('');
            }}
            onCreate={createKnowledgeDistillation}
            onAccept={acceptKnowledgeDistillation}
          />
          <SaveWordPaletteDialog
            locale={locale}
            open={Boolean(distilledPaletteToEdit)}
            palette={distilledPaletteToEdit}
            terms={data.terms}
            facets={data.facets}
            onOpenChange={(open) => {
              if (!open) setDistilledPaletteToEdit(null);
            }}
            onSaved={(palette) => {
              setWordPalettes((current) =>
                palette.status === 'ACTIVE'
                  ? [palette, ...current.filter((item) => item.id !== palette.id)]
                  : current.filter((item) => item.id !== palette.id),
              );
              void refresh();
              notify(c.recipeSaved);
            }}
            onLifecycleChanged={() => {
              void refresh();
            }}
          />
          <ImageImportPreviewDialog
            open={Boolean(outputImport.preview)}
            rows={outputImport.preview?.rows ?? null}
            versions={creationMode === 'existing' ? (series?.versions ?? []) : []}
            defaultVersionId={outputImport.preview?.defaultVersionId ?? null}
            busy={outputImport.busy}
            staging={outputImport.staging}
            onOpenChange={(open) => {
              if (!open) outputImport.dismiss();
            }}
            onAddFiles={() => void outputImport.chooseFiles()}
            onAddImages={(files, source, sourceUrl) => void outputImport.previewFiles(files, source, sourceUrl)}
            onDefaultVersionChange={outputImport.setDefaultVersionId}
            onRowChange={outputImport.updateRow}
            onAssignVersion={outputImport.assignVersion}
            onMoveRow={outputImport.moveRow}
            onRemoveRow={outputImport.removeRow}
            onConfirm={() => void outputImport.commit()}
          />
          <NewExternalCreationDialog
            open={Boolean(newExternalCreationDialog)}
            albums={data.albums}
            defaultAlbumId={newExternalCreationDialog?.albumId}
            onOpenChange={(open) => {
              if (!open) setNewExternalCreationDialog(null);
            }}
            onCreate={createExternalCreation}
          />
          <CreationInputStashDialog
            open={inputStashDialogOpen}
            locale={locale}
            current={currentInputSnapshot}
            stashes={inputStashes}
            series={creationMode === 'existing' ? sessionHostSeries : undefined}
            terms={data.terms}
            wordPalettes={data.wordPalettes}
            canvasPresets={data.canvasPresets}
            imageGenerationRoutes={imageGenerationRoutes}
            busy={inputStashBusy}
            onOpenChange={setInputStashDialogOpen}
            onCreate={stashCurrentInput}
            onRestore={restoreInputStash}
          />
          <AlbumCreationDefaultsDialog
            album={settingsAlbum}
            palettes={data.wordPalettes}
            locale={locale}
            onOpenChange={(open) => {
              if (!open) setSettingsAlbum(null);
            }}
            onSaved={refreshAlbums}
            notify={notify}
          />
          <RenameSeriesDialog
            series={series}
            prompt={version?.finalPrompt ?? livePrompt}
            open={renameOpen}
            onOpenChange={setRenameOpen}
            onSaved={refresh}
            notify={notify}
          />
          <CreateAlbumDialog
            open={createAlbumRequest !== null}
            parentTitle={createAlbumRequest?.parent?.title}
            busy={lifecycleActionBusy}
            labels={{
              title: messages.gallery.albums.createTitle,
              childTitle: messages.gallery.albums.createChild,
              name: messages.gallery.albums.name,
              placeholder: messages.gallery.albums.namePlaceholder,
              cancel: messages.gallery.albums.cancel,
              create: messages.gallery.albums.create,
              operationFailed: messages.gallery.albums.operationFailed,
            }}
            onOpenChange={(open) => {
              if (!open) setCreateAlbumRequest(null);
            }}
            onCreate={async (title) => {
              if (!createAlbumRequest) return;
              await createAlbum(createAlbumRequest.parent, title, createAlbumRequest.destination);
            }}
          />
          <RenameAlbumDialog
            album={renameAlbum}
            open={Boolean(renameAlbum)}
            onOpenChange={(open) => {
              if (!open) setRenameAlbum(null);
            }}
            onSave={handleRenameAlbum}
          />
          <RenameArticleDialog
            article={renameArticle}
            open={Boolean(renameArticle)}
            onOpenChange={(open) => {
              if (!open) setRenameArticle(null);
            }}
            onSave={handleRenameArticle}
          />
          <VideoDocumentRenameDialog
            open={Boolean(renameDocument)}
            title={renameDocument?.title ?? ''}
            onOpenChange={(open) => {
              if (!open) setRenameDocument(null);
            }}
            onSave={async (title) => {
              if (renameDocument) await handleRenameDocument(renameDocument.id, title);
            }}
          />
          {contentLifecycleActions.confirmationDialog}
        </PasteDropSurface>

        {showOutputPane && !promptFullWindow && (
          <div
            className={
              comparisonFullWindow
                ? 'block min-h-0 min-w-0 overflow-hidden [&>*]:size-full'
                : cn(
                    panes.compactPanel === 'output' ? 'block' : 'hidden',
                    'min-h-0 min-w-0 overflow-hidden min-[840px]:block [&>*]:size-full',
                  )
            }
          >
            {editorDerivedVisual ? (
              <DerivedVisualWorkbench
                visual={editorDerivedVisual}
                locale={locale}
                prompt={manualPrompt}
                canvasPreset={canvasPreset}
                canvasPresets={data.canvasPresets}
                series={outputSeries}
                routes={imageGenerationRoutes}
                generationTargets={generationTargets}
                generationCount={generationCount}
                generationTasks={data.generationTasks}
                readiness={readiness}
                starting={starting || versionCreating}
                resizeValue={panes.outputWidth}
                resizeMin={panes.outputResizeMin}
                resizeMax={panes.outputResizeMax}
                onResizeStart={panes.beginOutputResize}
                onResizeValueChange={panes.setOutputWidth}
                onPromptChange={changeDerivedVisualPrompt}
                onCanvasPresetChange={changeDerivedVisualCanvas}
                onGenerationTargetsChange={setGenerationTargets}
                onConfigureExtension={onConfigureExtension}
                onGenerate={() => void generate()}
                onAdopt={adoptDerivedVisual}
                onClose={() => {
                  setDismissedDerivedVisualId(editorDerivedVisual.id);
                  panes.setCompactPanel('creator');
                }}
                notify={notify}
              />
            ) : outputMode === 'results' ? (
              <OutputInspector
                headerNavigation={outputHeaderNavigation}
                emptyState={outputEmptyState}
                series={outputSeries}
                primarySeries={outputPrimarySeries}
                outputProjection={outputProjection}
                locale={locale}
                terms={data.terms}
                wordPalettes={data.wordPalettes}
                imageGenerationRoutes={imageGenerationRoutes}
                generationTargets={generationTargets}
                generationTasks={data.generationTasks}
                requestedAssetId={requestedAssetId}
                annotationWorkspaceRequest={
                  location.surface === 'existing-creation' && location.workspace === 'annotations' && location.assetId
                    ? { assetId: location.assetId, requestId: location.requestId ?? 0 }
                    : null
                }
                onAnnotationRefinementStateChange={setAnnotationRefinementState}
                onRequestedAssetIdChange={selectOutputAsset}
                galleryOpen={outputGalleryOpen}
                collapsed={panes.outputCollapsed}
                comparisonFullWindow={comparisonFullWindow}
                onCollapsedChange={panes.setOutputCollapsed}
                onResizeStart={panes.beginOutputResize}
                resizeValue={panes.outputWidth}
                resizeMin={panes.outputResizeMin}
                resizeMax={panes.outputResizeMax}
                onResizeValueChange={panes.setOutputWidth}
                onComparisonFullWindowChange={onComparisonFullWindowChange}
                onGalleryOpenChange={setOutputGalleryOpen}
                onGenerateVersion={generateVersion}
                onGeneratePrompt={generateImportedPrompt}
                onReusePrompt={reusePromptInput}
                onRefineImage={refineImage}
                onCropImage={cropImage}
                onReframeImage={reframeImage}
                onRetryGeneration={retryGeneration}
                onReEditGeneration={(runId) => void reEditGeneration(runId)}
                distilling={Boolean(distillingAssetId)}
                onDistillKnowledge={openKnowledgeDistillation}
                importing={outputImport.busy}
                onImportFiles={(files, source, sourceUrl) => void outputImport.previewFiles(files, source, sourceUrl)}
                onChooseImport={() => void outputImport.chooseFiles()}
                onPasteText={pasteTextFromOutput}
                onCreatePromptVersion={createNextPromptVersion}
                onImportedOutputUpdated={refresh}
                onImportedOutputSaved={onImportedOutputSaved}
                derivedVisual={outputDerivedVisual}
                onAdoptDerivedVisual={adoptDerivedVisual}
                notify={notify}
              />
            ) : outputMode === 'inputs' ? (
              <CreatorInputPanel
                headerNavigation={outputHeaderNavigation}
                locale={locale}
                prompt={manualPrompt}
                referenceAssets={referenceAssets}
                collapsed={panes.outputCollapsed}
                resizeValue={panes.outputWidth}
                resizeMin={panes.outputResizeMin}
                resizeMax={panes.outputResizeMax}
                onCollapsedChange={panes.setOutputCollapsed}
                onResizeStart={panes.beginOutputResize}
                onResizeValueChange={panes.setOutputWidth}
              />
            ) : (
              <CreatorRecordPanel
                headerNavigation={outputHeaderNavigation}
                locale={locale}
                scope={activeIdeaCreation?.sourceScope ?? assistantScope}
                runs={recordAssistantRuns}
                progressEvents={activeIdeaCreation?.activityEvents ?? minimalAssistantProgressEvents}
                prompt={manualPrompt}
                promptNodes={promptNodes}
                currentContextKey={assistantContextKey}
                busy={minimalAssistantBusy}
                activeMode={minimalAssistantMode}
                error={minimalAssistantError || activeIdeaCreation?.failureMessage || ''}
                collapsed={panes.outputCollapsed}
                resizeValue={panes.outputWidth}
                resizeMin={panes.outputResizeMin}
                resizeMax={panes.outputResizeMax}
                onCollapsedChange={panes.setOutputCollapsed}
                onResizeStart={panes.beginOutputResize}
                onResizeValueChange={panes.setOutputWidth}
                onRequestIdeas={requestProjectIdeas}
                onBuildPrompt={requestProjectWriting}
                onApply={adoptAssistantPrompt}
                onDismiss={dismissAssistantRun}
                onDismissTransient={() => setMinimalAssistantError('')}
                onStartExperiment={reviewDirectionExperiment}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
