import { appMaterialsReturnSummary } from '@/renderer/appPresentation';
import { GifWorkspaceScope } from '@/renderer/features/gif-making/GifMakerProvider';
import { AppWorkspaceViews } from '@/renderer/components/app/AppWorkspaceViews';
import { PopoverNavigationScope } from '@/renderer/components/ui/popover-navigation-scope';
import type {
  AppLocation,
  CreatorOpenTabTarget,
  HistoryNavigationGuard,
  NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { createWorkspaceLoadingBoundaries } from '@/renderer/components/app/appWorkspaceLoadingBoundaries';
import { WorkspaceArticleEditorStateProvider } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import { activeNavigationEntry, type WorkspaceRuntimeTab } from '@/renderer/components/workspace/workspace-state';
import { appLocationToWorkspaceTarget } from '@/renderer/components/workspace/workspace-location';
import type { AiActivityRecord } from '@/renderer/features/ai-center/AiCenterScreen';
import { aiActivityNavigationTarget } from '@/renderer/features/ai-center/aiActivityNavigation';
import { generationReEditLocation } from '@/renderer/features/ai-center/generationReEditNavigation';
import { ContentManagementScreen } from '@/renderer/features/content-management/ContentManagementScreen';
import { contentSearchLocation } from '@/renderer/features/content-search/content-search-navigation';
import { CreationOutlineWorkspace } from '@/renderer/features/creation-outline/CreationOutlineWorkspace';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';
import type { TransitionShowcaseNavigationState } from '@/renderer/features/extensions/transitionShowcaseNavigation';
import { LibraryStartScreen } from '@/renderer/features/intake/lazyLibraryStartScreen';
import type {
  ArticleEditorLocationDto,
  BootstrapDto,
  ImportedCreationOutputDto,
  IntakeCommitResult,
  Locale,
  TransitionPreviewDto,
  WorkspaceArticleEditOwnerDto,
  WorkspaceArticleEditorStateDto,
} from '@/shared/contracts';
import { useCallback, useEffect, useMemo, useRef, type ComponentProps } from 'react';

type WorkspaceViewProps = ComponentProps<typeof AppWorkspaceViews>;

export interface WorkspaceTabSurfaceProps {
  visible?: boolean;
  tab: WorkspaceRuntimeTab;
  active: boolean;
  data: BootstrapDto;
  dataRevision: number;
  locale: Locale;
  defaultPromptLocale: Locale | null;
  comparisonFullWindow: boolean;
  creationPromptFullWindow: boolean;
  loadingPreviews: readonly TransitionPreviewDto[];
  codexImagesNavigation: CodexImagesNavigationState;
  transitionShowcaseNavigation: TransitionShowcaseNavigationState;
  documentNavigationRevision: number;
  articleEditorStates: readonly WorkspaceArticleEditorStateDto[];
  articleEditOwners: readonly WorkspaceArticleEditOwnerDto[];
  onArticleEditorStateChange(
    articleId: string,
    operation: (current: WorkspaceArticleEditorStateDto | null) => WorkspaceArticleEditorStateDto | null,
  ): void;
  onArticleLocationChange(tabId: string, articleId: string, location: ArticleEditorLocationDto): void;
  onArticleLocationNavigate(tabId: string, articleId: string, location: ArticleEditorLocationDto): void;
  onRequestEditOwnership(articleId: string, tabId: string): void;
  onLocationFlushChange(tabId: string, flush: (() => void) | null): void;
  onNewTab(sourceTabId: string, destination: AppLocation['view'] | AppLocation): void;
  onOpenBeside(sourceTabId: string, destination: AppLocation['view'] | AppLocation): void;
  onCommitLocation(
    tabId: string,
    destination: AppLocation | ((current: AppLocation) => AppLocation),
    mode?: NavigationMode,
  ): void;
  onGoBack(tabId: string): void;
  onHistoryNavigationGuardChange(tabId: string, guard: HistoryNavigationGuard | null): void;
  onComparisonFullWindowChange(open: boolean): void;
  onCreationPromptFullWindowChange(open: boolean): void;
  onCreatorActiveAlbumChange(tabId: string, albumId: string | null): void;
  onGalleryActiveAlbumChange(tabId: string, albumId: string | null): void;
  refresh: WorkspaceViewProps['refresh'];
  refreshAlbums: WorkspaceViewProps['refreshAlbums'];
  onTermDetailsRequest: WorkspaceViewProps['onTermDetailsRequest'];
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  onArticleSaved: WorkspaceViewProps['onArticleSaved'];
  onSocialPostSaved: WorkspaceViewProps['onSocialPostSaved'];
  onApplyIntakeResult(result: IntakeCommitResult): void;
  onVideoDocumentsChange(): void;
  onRetryGeneration(runId: string): Promise<void>;
  notify(message: string): void;
}

function intakeLocation(current: AppLocation, result: IntakeCommitResult, requestId: number): AppLocation {
  if (result.intent === 'IMPORT' && current.view === 'gallery') return current;
  const creator =
    result.intent === 'START_CREATION'
      ? result.draft
        ? ({ surface: 'creation-draft', draftId: result.draft.id, requestId } as const)
        : ({ surface: 'new-creation', albumId: null, requestId } as const)
      : null;
  return {
    ...current,
    view: result.intent === 'START_CREATION' ? 'creator' : 'gallery',
    creator: creator ?? current.creator,
    gallery:
      result.intent === 'IMPORT'
        ? {
            collection: { kind: 'all' },
            selectedMaterialKey: null,
            requestedMaterialId: result.imageMaterialIds[0] ?? result.materialIds[0] ?? null,
          }
        : current.gallery,
  };
}

function creatorOpenTabLocation(current: AppLocation, target: CreatorOpenTabTarget): AppLocation {
  return target.view === 'creator'
    ? { ...current, view: 'creator', creator: target.location, materialsReturnContext: null }
    : { ...current, view: 'documents', documents: target.location, materialsReturnContext: null };
}

function returnToMaterials(
  tab: WorkspaceRuntimeTab,
  onGoBack: WorkspaceTabSurfaceProps['onGoBack'],
  onCommitLocation: WorkspaceTabSurfaceProps['onCommitLocation'],
) {
  if (tab.history.index > 0) onGoBack(tab.id);
  else onCommitLocation(tab.id, (current) => ({ ...current, view: 'gallery', materialsReturnContext: null }));
}

function useCloseInactiveCreatorFullWindow(
  active: boolean,
  view: AppLocation['view'],
  onComparisonFullWindowChange: (open: boolean) => void,
  onCreationPromptFullWindowChange: (open: boolean) => void,
) {
  useEffect(() => {
    if (!active || view === 'creator') return;
    onComparisonFullWindowChange(false);
    onCreationPromptFullWindowChange(false);
  }, [active, onComparisonFullWindowChange, onCreationPromptFullWindowChange, view]);
}

function useArticleEditorBindings(
  tabId: string,
  {
    onArticleLocationChange,
    onArticleLocationNavigate,
    onRequestEditOwnership,
    onLocationFlushChange,
  }: Pick<
    WorkspaceTabSurfaceProps,
    'onArticleLocationChange' | 'onArticleLocationNavigate' | 'onRequestEditOwnership' | 'onLocationFlushChange'
  >,
) {
  const changeLocation = useCallback(
    (articleId: string, location: ArticleEditorLocationDto) => onArticleLocationChange(tabId, articleId, location),
    [onArticleLocationChange, tabId],
  );
  const navigateLocation = useCallback(
    (articleId: string, location: ArticleEditorLocationDto) => onArticleLocationNavigate(tabId, articleId, location),
    [onArticleLocationNavigate, tabId],
  );
  const requestOwnership = useCallback(
    (articleId: string) => onRequestEditOwnership(articleId, tabId),
    [onRequestEditOwnership, tabId],
  );
  const changeLocationFlusher = useCallback(
    (flush: (() => void) | null) => onLocationFlushChange(tabId, flush),
    [onLocationFlushChange, tabId],
  );
  return { changeLocation, navigateLocation, requestOwnership, changeLocationFlusher };
}

function WorkspaceOutlineSurface({ location, ...props }: WorkspaceTabSurfaceProps & { location: AppLocation }) {
  if (location.creator.surface !== 'outline') return null;
  return (
    <CreationOutlineWorkspace
      data={props.data}
      visible={props.visible ?? props.active}
      albumId={location.creator.albumId}
      refresh={props.refresh}
      notify={props.notify}
      documentNavigationRevision={props.documentNavigationRevision}
      onOpenBeside={(target) => props.onOpenBeside(props.tab.id, creatorOpenTabLocation(location, target))}
    />
  );
}

export function WorkspaceTabSurface(props: WorkspaceTabSurfaceProps) {
  const entry = activeNavigationEntry(props.tab);
  return (
    <PopoverNavigationScope
      active={props.active && (props.visible ?? true)}
      navigationKey={`${entry.id}:${JSON.stringify(appLocationToWorkspaceTarget(entry.location))}`}
    >
      <WorkspaceTabContent {...props} />
    </PopoverNavigationScope>
  );
}

function WorkspaceTabContent(props: WorkspaceTabSurfaceProps) {
  const {
    tab,
    active,
    visible = active,
    data,
    dataRevision,
    locale,
    defaultPromptLocale,
    comparisonFullWindow,
    creationPromptFullWindow,
    loadingPreviews,
    codexImagesNavigation,
    transitionShowcaseNavigation,
    documentNavigationRevision,
    articleEditorStates,
    articleEditOwners,
    onArticleEditorStateChange,
    onNewTab,
    onCommitLocation,
    onGoBack,
    onHistoryNavigationGuardChange,
    onComparisonFullWindowChange,
    onCreationPromptFullWindowChange,
    onCreatorActiveAlbumChange,
    onGalleryActiveAlbumChange,
    refresh,
    refreshAlbums,
    onTermDetailsRequest,
    onImportedOutputSaved,
    onArticleSaved,
    onSocialPostSaved,
    onApplyIntakeResult,
    onVideoDocumentsChange,
    onRetryGeneration,
    notify,
  } = props;
  const creatorStartRevision = useRef(0);
  const navigationEntry = activeNavigationEntry(tab);
  const location = navigationEntry.location;
  const view = location.view;
  const visitedViews = useMemo(() => new Set(tab.visitedViews), [tab.visitedViews]);
  const loadingBoundaries = createWorkspaceLoadingBoundaries(loadingPreviews, view);
  const returnSummary = appMaterialsReturnSummary(location.materialsReturnContext, data, locale);
  const articleId = view === 'creator' && location.creator.surface === 'article' ? location.creator.articleId : null;
  const editOwner = articleId ? (articleEditOwners.find((owner) => owner.articleId === articleId) ?? null) : null;

  const articleEditorBindings = useArticleEditorBindings(tab.id, props);

  useCloseInactiveCreatorFullWindow(active, view, onComparisonFullWindowChange, onCreationPromptFullWindowChange);

  function commit(destination: AppLocation | ((current: AppLocation) => AppLocation), mode: NavigationMode = 'push') {
    onCommitLocation(tab.id, destination, mode);
  }

  function navigateCreator(creator: AppLocation['creator'], mode: NavigationMode = 'push') {
    commit((current) => ({ ...current, view: 'creator', creator, materialsReturnContext: null }), mode);
  }

  function navigateDocuments(documents: AppLocation['documents'], mode: NavigationMode = 'push') {
    onComparisonFullWindowChange(false);
    onCreationPromptFullWindowChange(false);
    commit(
      (current) => ({
        ...current,
        view: 'documents',
        documents,
        materialsReturnContext:
          current.materialsReturnContext?.destination === 'documents' &&
          documents.documentId === current.materialsReturnContext.documentId
            ? current.materialsReturnContext
            : null,
      }),
      mode,
    );
  }

  function navigateDictionary(dictionary: AppLocation['dictionary'], mode: NavigationMode = 'push') {
    commit((current) => ({ ...current, view: 'dictionary', dictionary, materialsReturnContext: null }), mode);
  }

  function navigateGallery(gallery: AppLocation['gallery'], mode: NavigationMode = 'push') {
    commit((current) => ({ ...current, view: 'gallery', gallery, materialsReturnContext: null }), mode);
  }

  function navigateExtensions(extensions: AppLocation['extensions'], mode: NavigationMode = 'push') {
    commit((current) => ({ ...current, view: 'packs', extensions, materialsReturnContext: null }), mode);
  }

  function navigateAiCenter(aiCenter: AppLocation['aiCenter'], mode: NavigationMode = 'push') {
    commit((current) => ({ ...current, view: 'aiCenter', aiCenter, materialsReturnContext: null }), mode);
  }

  async function openImportedCreation(seriesId: string, assetId: string | null) {
    await refresh();
    navigateCreator({ surface: 'existing-creation', seriesId, assetId });
  }

  function locateAiActivity(record: AiActivityRecord) {
    onComparisonFullWindowChange(false);
    const target = aiActivityNavigationTarget(record, data);
    if (target?.view === 'documents') navigateDocuments(target.location);
    if (target?.view === 'creator') navigateCreator(target.location);
  }

  function reEditGeneration(runId: string) {
    const next = generationReEditLocation(data, runId, Date.now());
    if (!next) {
      notify(locale === 'zh' ? '找不到该生成任务所属的创作' : 'The creation for this generation is unavailable');
      return;
    }
    onComparisonFullWindowChange(false);
    navigateCreator(next);
  }

  function openGalleryResult(seriesId: string, assetId: string) {
    onComparisonFullWindowChange(false);
    commit((current) => ({
      ...current,
      view: 'creator',
      creator: { surface: 'existing-creation', seriesId, assetId },
      materialsReturnContext: { destination: 'creator', seriesId },
    }));
  }

  function openGalleryTerm(termId: string) {
    onComparisonFullWindowChange(false);
    commit((current) => ({
      ...current,
      view: 'dictionary',
      dictionary: { surface: 'detail', termId, browseContext: null },
      materialsReturnContext: { destination: 'dictionary', termId },
    }));
  }

  function openCreatorMaterial(materialId: string) {
    onComparisonFullWindowChange(false);
    commit((current) => ({
      ...current,
      view: 'gallery',
      materialsReturnContext: null,
      gallery: { collection: { kind: 'all' }, selectedMaterialKey: null, requestedMaterialId: materialId },
    }));
  }

  async function finishIntake(result: IntakeCommitResult) {
    onComparisonFullWindowChange(false);
    const requestId = ++creatorStartRevision.current;
    commit((current) => intakeLocation(current, result, requestId));
    onApplyIntakeResult(result);
  }
  if (view === 'creator' && location.creator.surface === 'outline') {
    return <WorkspaceOutlineSurface {...props} location={location} />;
  }
  return (
    <div className="size-full min-h-0 min-w-0 overflow-hidden">
      <GifWorkspaceScope
        data={data}
        onOpenWork={(target) => commit(creatorOpenTabLocation(location, target))}
        active={visible}
        focused={active}
        navigationKey={`${navigationEntry.id}:${JSON.stringify(appLocationToWorkspaceTarget(location))}`}
        route={view === 'creator' && location.creator.surface === 'animation' ? location.creator : null}
        onNavigate={navigateCreator}
        onClose={() => (tab.history.index > 0 ? onGoBack(tab.id) : navigateCreator({ surface: 'default' }, 'replace'))}
      >
        <WorkspaceArticleEditorStateProvider
          activeArticleId={articleId}
          tabId={tab.id}
          navigationEntryId={navigationEntry.id}
          articleLocation={navigationEntry.articleLocation}
          editable={!articleId || editOwner?.tabId === tab.id}
          states={articleEditorStates}
          onChange={onArticleEditorStateChange}
          onArticleLocationChange={articleEditorBindings.changeLocation}
          onArticleLocationNavigate={articleEditorBindings.navigateLocation}
          onRequestEditOwnership={articleEditorBindings.requestOwnership}
          onLocationFlushChange={articleEditorBindings.changeLocationFlusher}
        >
          {data.libraryEmpty &&
            view === 'creator' &&
            location.creator.surface === 'default' &&
            loadingBoundaries.creator(
              <LibraryStartScreen
                onCommitted={(result) => void finishIntake(result)}
                onContentPackImported={refresh}
                notify={notify}
              />,
            )}
          <AppWorkspaceViews
            groupActive={active}
            view={view}
            visitedViews={visitedViews}
            data={data}
            dataRevision={dataRevision}
            locale={locale}
            defaultPromptLocale={defaultPromptLocale}
            location={location}
            comparisonFullWindow={comparisonFullWindow}
            creationPromptFullWindow={creationPromptFullWindow}
            materialsReturnContext={location.materialsReturnContext}
            returnSummary={returnSummary}
            codexImagesNavigation={codexImagesNavigation}
            transitionShowcaseNavigation={transitionShowcaseNavigation}
            loadingBoundaries={loadingBoundaries}
            documentNavigationRevision={documentNavigationRevision}
            onReturnToMaterials={() => returnToMaterials(tab, onGoBack, onCommitLocation)}
            onVideoDocumentsChange={onVideoDocumentsChange}
            onCreatorNavigate={navigateCreator}
            onCreatorOpenInNewTab={(target) => onNewTab(tab.id, creatorOpenTabLocation(location, target))}
            onComparisonFullWindowChange={onComparisonFullWindowChange}
            onCreationPromptFullWindowChange={onCreationPromptFullWindowChange}
            onOpenCreatorMaterial={openCreatorMaterial}
            onConfigureExtension={(pluginId) =>
              navigateExtensions({ tab: 'plugins', pluginId: pluginId ?? null, packId: null })
            }
            onCreatorActiveAlbumChange={(albumId) => onCreatorActiveAlbumChange(tab.id, albumId)}
            refresh={refresh}
            refreshAlbums={refreshAlbums}
            onTermDetailsRequest={onTermDetailsRequest}
            onImportedOutputSaved={onImportedOutputSaved}
            onArticleSaved={onArticleSaved}
            onSocialPostSaved={onSocialPostSaved}
            notify={notify}
            onVideoDocumentsNavigate={navigateDocuments}
            onDictionaryNavigate={navigateDictionary}
            onNavigateBack={() => onGoBack(tab.id)}
            onHistoryNavigationGuardChange={(guard) => onHistoryNavigationGuardChange(tab.id, guard)}
            onOpenDictionaryCreation={(seriesId, assetId, versionId) =>
              navigateCreator({
                surface: 'existing-creation',
                seriesId,
                assetId,
                ...(versionId ? { versionId } : {}),
              })
            }
            onGalleryNavigate={navigateGallery}
            onSearchNavigate={(search) => commit((current) => ({ ...current, search }), 'replace')}
            onSearchResultOpen={(source) => onNewTab(tab.id, contentSearchLocation(source))}
            onCalendarOpenLocation={(location) => onNewTab(tab.id, location)}
            onOpenGalleryResult={openGalleryResult}
            onOpenGalleryTerm={openGalleryTerm}
            onGalleryIntakeCommitted={finishIntake}
            onGalleryActiveAlbumChange={(albumId) => onGalleryActiveAlbumChange(tab.id, albumId)}
            onExtensionsNavigate={navigateExtensions}
            onOpenImportedCreation={openImportedCreation}
            onAiCenterNavigate={navigateAiCenter}
            onLocateAiActivity={locateAiActivity}
            onReEditGeneration={reEditGeneration}
            onRetryGeneration={onRetryGeneration}
          />
          {view === 'contentManagement' && (
            <ContentManagementScreen
              active={active}
              canNavigateBack={tab.history.index > 0}
              onNavigateBack={() => onGoBack(tab.id)}
              onContentChange={refresh}
              notify={notify}
            />
          )}
        </WorkspaceArticleEditorStateProvider>
      </GifWorkspaceScope>
    </div>
  );
}
