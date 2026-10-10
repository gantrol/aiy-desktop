import { lazy, useState, type ComponentProps } from 'react';
import type { ContentSource } from '@/shared/contracts/content-source';
import { inspirationArticleIds } from '@/shared/article-summary';
import { CreatorScreen } from '@/renderer/features/creator/lazyCreatorScreen';
import { WorkspaceDetailLoadingBoundary } from '@/renderer/components/app/WorkspaceDetailLoadingBoundary';
import { contentSearchLocation } from '@/renderer/features/content-search/content-search-navigation';
import { useWorkbenchScopeKey, WorkbenchScopeProvider } from '@/renderer/components/workbench/WorkbenchScope';
import { useI18n } from '@/renderer/i18n/useI18n';

const VideoDocumentsScreen = lazy(() =>
  import('@/renderer/features/video-documents/VideoDocumentsScreen').then((module) => ({
    default: module.VideoDocumentsScreen,
  })),
);

type CreatorProps = ComponentProps<typeof CreatorScreen>;
type VideoProps = ComponentProps<typeof VideoDocumentsScreen>;

export type ContentSearchEditorHost = Pick<
  CreatorProps,
  | 'data'
  | 'dataRevision'
  | 'locale'
  | 'defaultPromptLocale'
  | 'refresh'
  | 'refreshAlbums'
  | 'notify'
  | 'onArticleSaved'
  | 'onSocialPostSaved'
  | 'onImportedOutputSaved'
  | 'onTermDetailsRequest'
  | 'onConfigureExtension'
> & {
  onCreatorNavigate: CreatorProps['onNavigate'];
  onCreatorOpenInNewTab: CreatorProps['onOpenInNewTab'];
  onOpenCreatorMaterial: CreatorProps['onOpenMaterial'];
  onVideoDocumentsNavigate: VideoProps['onNavigate'];
  onVideoDocumentsChange(): void;
};

export function AppContentSearchEditor({
  source,
  active,
  host,
}: {
  source: ContentSource;
  active: boolean;
  host: ContentSearchEditorHost;
}) {
  const scope = useWorkbenchScopeKey('search-editor');
  const location = contentSearchLocation(source);
  const [comparisonFullWindow, setComparisonFullWindow] = useState(false);
  const [promptFullWindow, setPromptFullWindow] = useState(false);
  const { messages } = useI18n();
  const available =
    source.kind === 'VIDEO_DOCUMENT' ||
    (source.kind === 'ARTICLE' && host.data.articles?.some((article) => article.id === source.id)) ||
    (source.kind === 'SOCIAL_POST' && host.data.socialPosts?.some((post) => post.id === source.id)) ||
    (source.kind === 'INSPIRATION_STASH' && inspirationArticleIds(host.data).includes(source.id));
  if (!available)
    return (
      <div role="alert" className="p-4 text-sm">
        {messages.referenceOutline.lookup.notAvailable}
      </div>
    );
  return (
    <WorkbenchScopeProvider scope={scope}>
      <WorkspaceDetailLoadingBoundary className="flex min-h-0 flex-1 overflow-hidden">
        {source.kind === 'VIDEO_DOCUMENT' ? (
          <VideoDocumentsScreen
            active={active}
            libraryVisible={false}
            initialBranchId={source.branchId}
            externalDocumentUpdate={null}
            albums={host.data.albums}
            location={location.documents}
            onNavigate={host.onVideoDocumentsNavigate}
            onAlbumsChange={host.refreshAlbums}
            onLibraryChange={host.onVideoDocumentsChange}
            onOpenSourceMaterial={host.onOpenCreatorMaterial}
            notify={host.notify}
          />
        ) : (
          <CreatorScreen
            {...host}
            active={active}
            creationLibraryActive={false}
            libraryVisible={false}
            location={location.creator}
            comparisonFullWindow={comparisonFullWindow}
            promptFullWindow={promptFullWindow}
            documentWorkspace={null}
            documentWorkspaceActive={false}
            selectedDocumentId={null}
            selectedDocumentAlbumId={null}
            documentNavigationRevision={0}
            onNavigate={host.onCreatorNavigate}
            onOpenInNewTab={host.onCreatorOpenInNewTab}
            onSelectDocument={(documentId, albumId) =>
              host.onVideoDocumentsNavigate({
                documentId,
                collection: albumId ? { kind: 'album', albumId } : { kind: 'unfiled' },
              })
            }
            onDocumentsChange={host.onVideoDocumentsChange}
            onComparisonFullWindowChange={setComparisonFullWindow}
            onPromptFullWindowChange={setPromptFullWindow}
            onOpenMaterial={host.onOpenCreatorMaterial}
            // Inspecting a search result must not change the default creation album.
            onActiveAlbumChange={() => undefined}
          />
        )}
      </WorkspaceDetailLoadingBoundary>
    </WorkbenchScopeProvider>
  );
}
