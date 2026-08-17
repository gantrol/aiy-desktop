import { lazy, useState, type ComponentProps, type ReactNode } from 'react';
import type {
  BootstrapDto,
  ImportedCreationOutputDto,
  IntakeCommitResult,
  Locale,
  TransitionPreviewDto,
  VideoDocumentDto,
} from '@/shared/contracts';
import { ReturnToMaterialsBar } from '@/renderer/components/app/ReturnToMaterialsBar';
import type { AppView } from '@/renderer/components/app/AppSidebar';
import type { AppLocation, MaterialsReturnContext } from '@/renderer/components/app/app-navigation';
import { CreatorScreen } from '@/renderer/features/creator/lazyCreatorScreen';
import { useI18n } from '@/renderer/i18n/useI18n';

const DictionaryScreen = lazy(() =>
  import('@/renderer/components/DictionaryScreen').then((module) => ({ default: module.DictionaryScreen })),
);
const GalleryScreen = lazy(() =>
  import('@/renderer/components/GalleryScreen').then((module) => ({ default: module.GalleryScreen })),
);
const ExtensionCenterScreen = lazy(() => import('@/renderer/features/extensions/ExtensionCenterScreen'));
const AiCenterScreen = lazy(() =>
  import('@/renderer/features/ai-center/AiCenterScreen').then((module) => ({ default: module.AiCenterScreen })),
);
const VideoDocumentsScreen = lazy(() =>
  import('@/renderer/features/video-documents/VideoDocumentsScreen').then((module) => ({
    default: module.VideoDocumentsScreen,
  })),
);

export interface AppWorkspaceLoadingBoundaries {
  creator(children: ReactNode): ReactNode;
  documents(children: ReactNode): ReactNode;
  dictionary(children: ReactNode): ReactNode;
  gallery(children: ReactNode): ReactNode;
  extensions(children: ReactNode): ReactNode;
  aiCenter(children: ReactNode): ReactNode;
}

interface Props {
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
  transitionPreviews: readonly TransitionPreviewDto[];
  loadingBoundaries: AppWorkspaceLoadingBoundaries;
  documentNavigationRevision: number;
  onReturnToMaterials(): void;
  onVideoDocumentsChange(): void;
  onCreatorNavigate: ComponentProps<typeof CreatorScreen>['onNavigate'];
  onComparisonFullWindowChange: ComponentProps<typeof CreatorScreen>['onComparisonFullWindowChange'];
  onCreationPromptFullWindowChange: ComponentProps<typeof CreatorScreen>['onPromptFullWindowChange'];
  onOpenCreatorMaterial: ComponentProps<typeof CreatorScreen>['onOpenMaterial'];
  onConfigureExtension(extensionId?: string | null): void;
  onCreatorActiveAlbumChange: ComponentProps<typeof CreatorScreen>['onActiveAlbumChange'];
  refresh: ComponentProps<typeof CreatorScreen>['refresh'];
  refreshAlbums: ComponentProps<typeof CreatorScreen>['refreshAlbums'];
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  notify(message: string): void;
  onVideoDocumentsNavigate: ComponentProps<typeof VideoDocumentsScreen>['onNavigate'];
  onDictionaryNavigate: ComponentProps<typeof DictionaryScreen>['onNavigate'];
  onNavigateBack: ComponentProps<typeof DictionaryScreen>['onNavigateBack'];
  onHistoryNavigationGuardChange: ComponentProps<typeof DictionaryScreen>['onHistoryNavigationGuardChange'];
  onOpenDictionaryCreation: ComponentProps<typeof DictionaryScreen>['onOpenCreation'];
  onGalleryNavigate: ComponentProps<typeof GalleryScreen>['onNavigate'];
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

export function AppWorkspaceViews({
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
  transitionPreviews,
  loadingBoundaries,
  documentNavigationRevision,
  onReturnToMaterials,
  onVideoDocumentsChange,
  onCreatorNavigate,
  onComparisonFullWindowChange,
  onCreationPromptFullWindowChange,
  onOpenCreatorMaterial,
  onConfigureExtension,
  onCreatorActiveAlbumChange,
  refresh,
  refreshAlbums,
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
}: Props) {
  const { messages } = useI18n();
  const [creatorDocumentUpdate, setCreatorDocumentUpdate] = useState<{
    revision: number;
    document: VideoDocumentDto;
  } | null>(null);
  const handleCreatorDocumentsChange = (document: VideoDocumentDto, collectionChanged: boolean) => {
    setCreatorDocumentUpdate((current) => ({ revision: (current?.revision ?? 0) + 1, document }));
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
  return (
    <>
      {(!data.libraryEmpty || view === 'documents') &&
        (visitedViews.has('creator') || visitedViews.has('documents')) && (
          <div className={view === 'creator' || view === 'documents' ? 'flex size-full min-h-0 flex-col' : 'hidden'}>
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
                  locale={locale}
                  defaultPromptLocale={defaultPromptLocale}
                  active={view === 'creator'}
                  creationLibraryActive={view === 'creator' || view === 'documents'}
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
                            active={view === 'documents'}
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
                    onVideoDocumentsNavigate({
                      collection: albumId ? { kind: 'album', albumId } : { kind: 'unfiled' },
                      documentId,
                    })
                  }
                  onDocumentsChange={handleCreatorDocumentsChange}
                  onNavigate={onCreatorNavigate}
                  onComparisonFullWindowChange={onComparisonFullWindowChange}
                  onPromptFullWindowChange={onCreationPromptFullWindowChange}
                  onOpenMaterial={onOpenCreatorMaterial}
                  onConfigureExtension={onConfigureExtension}
                  onActiveAlbumChange={onCreatorActiveAlbumChange}
                  refresh={refresh}
                  refreshAlbums={refreshAlbums}
                  onImportedOutputSaved={onImportedOutputSaved}
                  notify={notify}
                />,
              )}
            </div>
          </div>
        )}
      {visitedViews.has('dictionary') && (
        <div className={view === 'dictionary' ? 'flex size-full min-h-0 flex-col' : 'hidden'}>
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
                active={view === 'dictionary'}
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
      )}
      {visitedViews.has('gallery') && (
        <div className={view === 'gallery' ? 'size-full' : 'hidden'}>
          {loadingBoundaries.gallery(
            <GalleryScreen
              libraryKey={data.spaceName}
              dataRevision={dataRevision}
              active={view === 'gallery'}
              location={location.gallery}
              onNavigate={onGalleryNavigate}
              onNavigateBack={onNavigateBack}
              terms={data.terms}
              facets={data.facets}
              series={data.series}
              onOpenResult={onOpenGalleryResult}
              onOpenTerm={onOpenGalleryTerm}
              onIntakeCommitted={onGalleryIntakeCommitted}
              onActiveAlbumChange={onGalleryActiveAlbumChange}
              refresh={refresh}
              notify={notify}
            />,
          )}
        </div>
      )}
      {(visitedViews.has('packs') || visitedViews.has('codexImages')) && (
        <div className={view === 'packs' || view === 'codexImages' ? 'size-full' : 'hidden'}>
          {loadingBoundaries.extensions(
            <ExtensionCenterScreen
              activeSurface={view === 'codexImages' ? 'discovery' : view === 'packs' ? 'center' : null}
              extensions={data.extensions ?? []}
              location={location.extensions}
              onNavigate={onExtensionsNavigate}
              onExtensionsChange={refresh}
              codexImagesNavigation={codexImagesNavigation}
              transitionPreviews={transitionPreviews}
              onOpenCreation={onOpenImportedCreation}
              notify={notify}
            />,
          )}
        </div>
      )}
      {visitedViews.has('aiCenter') && (
        <div className={view === 'aiCenter' ? 'size-full' : 'hidden'}>
          {loadingBoundaries.aiCenter(
            <AiCenterScreen
              active={view === 'aiCenter'}
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
      )}
    </>
  );
}
