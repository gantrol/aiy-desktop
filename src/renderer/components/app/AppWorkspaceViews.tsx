import { ReturnToMaterialsBar } from '@/renderer/components/app/ReturnToMaterialsBar';
import type { AppLocation, AppView, MaterialsReturnContext } from '@/renderer/components/app/app-navigation';
import { CreatorScreen } from '@/renderer/features/creator/lazyCreatorScreen';
import { useI18n } from '@/renderer/i18n/useI18n';
import type {
  BootstrapDto,
  ImportedCreationOutputDto,
  IntakeCommitResult,
  Locale,
  VideoDocumentDto,
} from '@/shared/contracts';
import { Activity, lazy, useState, type ComponentProps, type ReactNode } from 'react';

const DictionaryScreen = lazy(() =>
  import('@/renderer/components/DictionaryScreen').then((module) => ({ default: module.DictionaryScreen })),
);
const GalleryScreen = lazy(() =>
  import('@/renderer/components/GalleryScreen').then((module) => ({ default: module.GalleryScreen })),
);
const ExtensionCenterScreen = lazy(() => import('@/renderer/features/extensions/ExtensionCenterScreen'));
const ContentSearchScreen = lazy(() => import('@/renderer/features/content-search/ContentSearchScreen'));
const CalendarScreen = lazy(() => import('@/renderer/features/calendar/CalendarScreen'));
const TransitionShowcaseScreen = lazy(() => import('@/renderer/features/extensions/TransitionShowcaseScreen'));
const AiCenterScreen = lazy(() =>
  import('@/renderer/features/ai-center/AiCenterScreen').then((module) => ({ default: module.AiCenterScreen })),
);
const VideoDocumentsScreen = lazy(() =>
  import('@/renderer/features/video-documents/VideoDocumentsScreen').then((module) => ({
    default: module.VideoDocumentsScreen,
  })),
);
const CompanionHistoryScreen = lazy(() =>
  import('@/renderer/features/browser-companion/CompanionHistoryScreen').then((module) => ({
    default: module.CompanionHistoryScreen,
  })),
);

export interface AppWorkspaceLoadingBoundaries {
  creator(children: ReactNode): ReactNode;
  documents(children: ReactNode): ReactNode;
  dictionary(children: ReactNode): ReactNode;
  gallery(children: ReactNode): ReactNode;
  search(children: ReactNode): ReactNode;
  calendar(children: ReactNode): ReactNode;
  companion(children: ReactNode): ReactNode;
  extensions(children: ReactNode): ReactNode;
  aiCenter(children: ReactNode): ReactNode;
}

interface Props {
  groupActive: boolean;
  view: AppView;
  visitedViews: ReadonlySet<AppView>;
  data: BootstrapDto;
  dataRevision: number;
  locale: Locale;
  defaultPromptLocale: Locale | null;
  location: AppLocation;
  comparisonFullWindow: boolean;
  creationPromptFullWindow: boolean;
  materialsReturnContext: MaterialsReturnContext | null;
  returnSummary: string;
  codexImagesNavigation: ComponentProps<typeof ExtensionCenterScreen>['codexImagesNavigation'];
  transitionShowcaseNavigation: ComponentProps<typeof ExtensionCenterScreen>['transitionShowcaseNavigation'];
  loadingBoundaries: AppWorkspaceLoadingBoundaries;
  documentNavigationRevision: number;
  onReturnToMaterials(): void;
  onVideoDocumentsChange(): void;
  onCreatorNavigate: ComponentProps<typeof CreatorScreen>['onNavigate'];
  onCreatorOpenInNewTab: ComponentProps<typeof CreatorScreen>['onOpenInNewTab'];
  onComparisonFullWindowChange: ComponentProps<typeof CreatorScreen>['onComparisonFullWindowChange'];
  onCreationPromptFullWindowChange: ComponentProps<typeof CreatorScreen>['onPromptFullWindowChange'];
  onOpenCreatorMaterial: ComponentProps<typeof CreatorScreen>['onOpenMaterial'];
  onConfigureExtension(extensionId?: string | null): void;
  onCreatorActiveAlbumChange: ComponentProps<typeof CreatorScreen>['onActiveAlbumChange'];
  refresh: ComponentProps<typeof CreatorScreen>['refresh'];
  refreshAlbums: ComponentProps<typeof CreatorScreen>['refreshAlbums'];
  onTermDetailsRequest?: ComponentProps<typeof CreatorScreen>['onTermDetailsRequest'];
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  onArticleSaved: ComponentProps<typeof CreatorScreen>['onArticleSaved'];
  onSocialPostSaved: ComponentProps<typeof CreatorScreen>['onSocialPostSaved'];
  notify(message: string): void;
  onVideoDocumentsNavigate: ComponentProps<typeof VideoDocumentsScreen>['onNavigate'];
  onDictionaryNavigate: ComponentProps<typeof DictionaryScreen>['onNavigate'];
  onNavigateBack: ComponentProps<typeof DictionaryScreen>['onNavigateBack'];
  onHistoryNavigationGuardChange: ComponentProps<typeof DictionaryScreen>['onHistoryNavigationGuardChange'];
  onOpenDictionaryCreation: ComponentProps<typeof DictionaryScreen>['onOpenCreation'];
  onGalleryNavigate: ComponentProps<typeof GalleryScreen>['onNavigate'];
  onSearchNavigate(search: AppLocation['search']): void;
  onCalendarOpenLocation(location: AppLocation): void;
  onSearchResultOpen: ComponentProps<typeof ContentSearchScreen>['onOpen'];
  onOpenGalleryResult: ComponentProps<typeof GalleryScreen>['onOpenResult'];
  onOpenGalleryTerm: ComponentProps<typeof GalleryScreen>['onOpenTerm'];
  onGalleryIntakeCommitted(result: IntakeCommitResult): void | Promise<void>;
  onGalleryActiveAlbumChange: ComponentProps<typeof GalleryScreen>['onActiveAlbumChange'];
  onExtensionsNavigate: ComponentProps<typeof ExtensionCenterScreen>['onNavigate'];
  onOpenImportedCreation: ComponentProps<typeof ExtensionCenterScreen>['onOpenCreation'];
  onAiCenterNavigate: ComponentProps<typeof AiCenterScreen>['onNavigate'];
  onLocateAiActivity: ComponentProps<typeof AiCenterScreen>['onLocate'];
  onReEditGeneration: ComponentProps<typeof AiCenterScreen>['onReEditGeneration'];
  onRetryGeneration: ComponentProps<typeof AiCenterScreen>['onRetryGeneration'];
}

function selectedDocumentAlbumId(location: AppLocation['documents']) {
  return location.collection.kind === 'album' ? location.collection.albumId : null;
}

function selectedVideoDocumentLocation(documentId: string, albumId: string | null): AppLocation['documents'] {
  return {
    collection: albumId ? { kind: 'album', albumId } : { kind: 'unfiled' },
    documentId,
  };
}

interface CreatorDocumentUpdate {
  revision: number;
  document: VideoDocumentDto;
}

const creatorViews: readonly AppView[] = ['creator'];
const creationLibraryViews: readonly AppView[] = ['creator', 'documents'];
const documentViews: readonly AppView[] = ['documents'];
const dictionaryViews: readonly AppView[] = ['dictionary'];
const galleryViews: readonly AppView[] = ['gallery'];
const companionViews: readonly AppView[] = ['companion'];
const transitionShowcaseViews: readonly AppView[] = ['transitionShowcase'];
const aiCenterViews: readonly AppView[] = ['aiCenter'];

function groupOwnsView(groupActive: boolean, view: AppView, expected: readonly AppView[]) {
  return groupActive && expected.includes(view);
}

function activeExtensionSurface(groupActive: boolean, view: AppView) {
  if (!groupActive) return null;
  if (view === 'codexImages') return 'discovery' as const;
  return view === 'packs' ? ('center' as const) : null;
}

function shouldMountCreationWorkspace(
  data: BootstrapDto,
  view: AppView,
  visitedViews: ReadonlySet<AppView>,
  location: AppLocation,
) {
  const libraryStartVisible = data.libraryEmpty && view === 'creator' && location.creator.surface === 'default';
  return (
    !libraryStartVisible &&
    (view === 'creator' || view === 'documents' || !data.libraryEmpty) &&
    (visitedViews.has('creator') || visitedViews.has('documents'))
  );
}

function useCreatorDocumentUpdate({
  location,
  onVideoDocumentsChange,
  onVideoDocumentsNavigate,
}: Pick<Props, 'location' | 'onVideoDocumentsChange' | 'onVideoDocumentsNavigate'>) {
  const [update, setUpdate] = useState<CreatorDocumentUpdate | null>(null);
  const handleChange = (document: VideoDocumentDto, collectionChanged: boolean) => {
    setUpdate((current) => ({ revision: (current?.revision ?? 0) + 1, document }));
    onVideoDocumentsChange();
    if (collectionChanged && location.documents.documentId === document.id) {
      onVideoDocumentsNavigate(
        {
          collection: document.albumId ? { kind: 'album', albumId: document.albumId } : { kind: 'unfiled' },
          documentId: document.id,
        },
        'replace',
      );
    }
  };
  return [update, handleChange] as const;
}

function SearchWorkspaceView({
  groupActive,
  view,
  visitedViews,
  location,
  loadingBoundaries,
  onSearchNavigate,
  onSearchResultOpen,
}: Pick<
  Props,
  'groupActive' | 'view' | 'visitedViews' | 'location' | 'loadingBoundaries' | 'onSearchNavigate' | 'onSearchResultOpen'
>) {
  if (!visitedViews.has('search')) return null;
  return (
    <Activity mode={view === 'search' ? 'visible' : 'hidden'}>
      {loadingBoundaries.search(
        <ContentSearchScreen
          active={groupActive && view === 'search'}
          location={location.search}
          onNavigate={onSearchNavigate}
          onOpen={onSearchResultOpen}
        />,
      )}
    </Activity>
  );
}

function CompanionWorkspaceView({
  groupActive,
  view,
  visitedViews,
  loadingBoundaries,
  locale,
  notify,
}: Pick<Props, 'groupActive' | 'view' | 'visitedViews' | 'loadingBoundaries' | 'locale' | 'notify'>) {
  if (!visitedViews.has('companion')) return null;
  return (
    <Activity mode={view === 'companion' ? 'visible' : 'hidden'}>
      <div className="size-full">
        {loadingBoundaries.companion(
          <CompanionHistoryScreen
            active={groupOwnsView(groupActive, view, companionViews)}
            locale={locale}
            notify={notify}
          />,
        )}
      </div>
    </Activity>
  );
}

function CalendarWorkspaceView(
  props: Pick<
    Props,
    | 'groupActive'
    | 'view'
    | 'visitedViews'
    | 'data'
    | 'dataRevision'
    | 'loadingBoundaries'
    | 'onCalendarOpenLocation'
    | 'notify'
  >,
) {
  const { groupActive, view, visitedViews, data, dataRevision, loadingBoundaries, notify } = props;
  return (
    <>
      {visitedViews.has('calendar') && (
        <Activity mode={view === 'calendar' ? 'visible' : 'hidden'}>
          {loadingBoundaries.calendar(
            <CalendarScreen
              spaceId={data.spaceId}
              data={data}
              dataRevision={dataRevision}
              active={groupActive && view === 'calendar'}
              onOpenLocation={props.onCalendarOpenLocation}
              notify={notify}
            />,
          )}
        </Activity>
      )}
    </>
  );
}

export function AppWorkspaceViews(props: Props) {
  const {
    groupActive,
    view,
    visitedViews,
    data,
    dataRevision,
    locale,
    defaultPromptLocale,
    location,
    comparisonFullWindow,
    creationPromptFullWindow,
    materialsReturnContext,
    returnSummary,
    codexImagesNavigation,
    transitionShowcaseNavigation,
    loadingBoundaries,
    documentNavigationRevision,
    onReturnToMaterials,
    onVideoDocumentsChange,
    onCreatorNavigate,
    onCreatorOpenInNewTab,
    onComparisonFullWindowChange,
    onCreationPromptFullWindowChange,
    onOpenCreatorMaterial,
    onConfigureExtension,
    onCreatorActiveAlbumChange,
    refresh,
    refreshAlbums,
    onTermDetailsRequest,
    onImportedOutputSaved,
    notify,
    onVideoDocumentsNavigate,
    onDictionaryNavigate,
    onNavigateBack,
    onHistoryNavigationGuardChange,
    onOpenDictionaryCreation,
    onGalleryNavigate,
    onOpenGalleryResult,
    onOpenGalleryTerm,
    onGalleryIntakeCommitted,
    onGalleryActiveAlbumChange,
    onExtensionsNavigate,
    onOpenImportedCreation,
    onAiCenterNavigate,
    onLocateAiActivity,
    onReEditGeneration,
    onRetryGeneration,
  } = props;
  const { messages } = useI18n();
  const [creatorDocumentUpdate, handleCreatorDocumentsChange] = useCreatorDocumentUpdate({
    location,
    onVideoDocumentsChange,
    onVideoDocumentsNavigate,
  });
  return (
    <>
      {shouldMountCreationWorkspace(data, view, visitedViews, location) && (
        <Activity mode={view === 'creator' || view === 'documents' ? 'visible' : 'hidden'}>
          <div className="flex size-full min-h-0 flex-col">
            {materialsReturnContext?.destination === view && !comparisonFullWindow && !creationPromptFullWindow && (
              <ReturnToMaterialsBar
                label={messages.gallery.screen.backToMaterials}
                summary={returnSummary}
                onReturn={onReturnToMaterials}
              />
            )}
            <div className="min-h-0 flex-1 overflow-hidden">
              {loadingBoundaries.creator(
                <CreatorScreen
                  data={data}
                  dataRevision={dataRevision}
                  locale={locale}
                  defaultPromptLocale={defaultPromptLocale}
                  active={groupOwnsView(groupActive, view, creatorViews)}
                  creationLibraryActive={creationLibraryViews.includes(view)}
                  location={location.creator}
                  comparisonFullWindow={comparisonFullWindow}
                  promptFullWindow={creationPromptFullWindow}
                  documentWorkspaceActive={view === 'documents'}
                  documentNavigationRevision={documentNavigationRevision}
                  selectedDocumentId={location.documents.documentId}
                  selectedDocumentAlbumId={selectedDocumentAlbumId(location.documents)}
                  documentWorkspace={
                    visitedViews.has('documents')
                      ? loadingBoundaries.documents(
                          <VideoDocumentsScreen
                            active={groupOwnsView(groupActive, view, documentViews)}
                            libraryVisible={false}
                            externalDocumentUpdate={creatorDocumentUpdate}
                            albums={data.albums}
                            location={location.documents}
                            onNavigate={onVideoDocumentsNavigate}
                            onAlbumsChange={refreshAlbums}
                            onLibraryChange={onVideoDocumentsChange}
                            onOpenSourceMaterial={onOpenCreatorMaterial}
                            notify={notify}
                          />,
                        )
                      : null
                  }
                  onSelectDocument={(documentId, albumId) =>
                    onVideoDocumentsNavigate(selectedVideoDocumentLocation(documentId, albumId))
                  }
                  onDocumentsChange={handleCreatorDocumentsChange}
                  onNavigate={onCreatorNavigate}
                  onOpenInNewTab={onCreatorOpenInNewTab}
                  onComparisonFullWindowChange={onComparisonFullWindowChange}
                  onPromptFullWindowChange={onCreationPromptFullWindowChange}
                  onOpenMaterial={onOpenCreatorMaterial}
                  onConfigureExtension={onConfigureExtension}
                  onActiveAlbumChange={onCreatorActiveAlbumChange}
                  refresh={refresh}
                  refreshAlbums={refreshAlbums}
                  onTermDetailsRequest={onTermDetailsRequest}
                  onImportedOutputSaved={onImportedOutputSaved}
                  onArticleSaved={props.onArticleSaved}
                  onSocialPostSaved={props.onSocialPostSaved}
                  notify={notify}
                />,
              )}
            </div>
          </div>
        </Activity>
      )}
      {visitedViews.has('dictionary') && (
        <Activity mode={view === 'dictionary' ? 'visible' : 'hidden'}>
          <div className="flex size-full min-h-0 flex-col">
            {materialsReturnContext?.destination === 'dictionary' && (
              <ReturnToMaterialsBar
                label={messages.gallery.screen.backToMaterials}
                summary={returnSummary}
                onReturn={onReturnToMaterials}
              />
            )}
            <div className="min-h-0 flex-1 overflow-hidden">
              {loadingBoundaries.dictionary(
                <DictionaryScreen
                  data={data}
                  active={groupOwnsView(groupActive, view, dictionaryViews)}
                  location={location.dictionary}
                  onNavigate={onDictionaryNavigate}
                  onNavigateBack={onNavigateBack}
                  onHistoryNavigationGuardChange={onHistoryNavigationGuardChange}
                  onOpenCreation={onOpenDictionaryCreation}
                  refresh={refresh}
                  notify={notify}
                />,
              )}
            </div>
          </div>
        </Activity>
      )}
      {visitedViews.has('gallery') && (
        <Activity mode={view === 'gallery' ? 'visible' : 'hidden'}>
          <div className="size-full">
            {loadingBoundaries.gallery(
              <GalleryScreen
                spaceId={data.spaceId}
                libraryKey={data.spaceName}
                dataRevision={dataRevision}
                active={groupOwnsView(groupActive, view, galleryViews)}
                location={location.gallery}
                onNavigate={onGalleryNavigate}
                onHistoryNavigationGuardChange={onHistoryNavigationGuardChange}
                terms={data.terms}
                facets={data.facets}
                series={data.series}
                creationItems={data.creationItems}
                onOpenResult={onOpenGalleryResult}
                onOpenTerm={onOpenGalleryTerm}
                onIntakeCommitted={onGalleryIntakeCommitted}
                onActiveAlbumChange={onGalleryActiveAlbumChange}
                refresh={refresh}
                notify={notify}
              />,
            )}
          </div>
        </Activity>
      )}
      <SearchWorkspaceView {...props} />
      <CalendarWorkspaceView {...props} />
      <CompanionWorkspaceView {...props} />
      {(visitedViews.has('packs') || visitedViews.has('codexImages')) && (
        <Activity mode={view === 'packs' || view === 'codexImages' ? 'visible' : 'hidden'}>
          <div className="size-full">
            {loadingBoundaries.extensions(
              <ExtensionCenterScreen
                activeSurface={activeExtensionSurface(groupActive, view)}
                data={data}
                dataRevision={dataRevision}
                extensions={data.extensions ?? []}
                location={location.extensions}
                onNavigate={onExtensionsNavigate}
                onExtensionsChange={refresh}
                codexImagesNavigation={codexImagesNavigation}
                transitionShowcaseNavigation={transitionShowcaseNavigation}
                onOpenCreation={onOpenImportedCreation}
                notify={notify}
              />,
            )}
          </div>
        </Activity>
      )}
      {visitedViews.has('transitionShowcase') && (
        <Activity mode={view === 'transitionShowcase' ? 'visible' : 'hidden'}>
          <div className="size-full">
            {loadingBoundaries.extensions(
              <TransitionShowcaseScreen
                active={groupOwnsView(groupActive, view, transitionShowcaseViews)}
                libraryKey={data.spaceName}
                dataRevision={dataRevision}
                terms={data.terms}
                facets={data.facets}
                notify={notify}
              />,
            )}
          </div>
        </Activity>
      )}
      {visitedViews.has('aiCenter') && (
        <Activity mode={view === 'aiCenter' ? 'visible' : 'hidden'}>
          <div className="size-full">
            {loadingBoundaries.aiCenter(
              <AiCenterScreen
                active={groupOwnsView(groupActive, view, aiCenterViews)}
                data={data}
                locale={locale}
                location={location.aiCenter}
                onNavigate={onAiCenterNavigate}
                onLocate={onLocateAiActivity}
                onReEditGeneration={onReEditGeneration}
                onManagePlugins={onConfigureExtension}
                onRetryGeneration={onRetryGeneration}
                refresh={refresh}
                notify={notify}
              />,
            )}
          </div>
        </Activity>
      )}
    </>
  );
}
