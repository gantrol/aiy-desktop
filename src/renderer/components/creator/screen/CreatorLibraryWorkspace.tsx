import { lazy, memo } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { ResultLibrary } from '@/renderer/components/creator/ResultLibrary';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { cn } from '@/renderer/lib/utils';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';

const CreatorWorkspaceRouter = lazy(() =>
  import('@/renderer/components/creator/screen/CreatorWorkspaceRouter').then((module) => ({
    default: module.CreatorWorkspaceRouter,
  })),
);
const MemoizedResultLibrary = memo(ResultLibrary);

interface Props {
  imageBreakdownSourceFormId: string | null;
  model: CreatorScreenViewModel;
}

export function CreatorLibraryWorkspace({ model }: Pick<Props, 'model'>) {
  const { app, library, navigation, projection, selection, workbench } = model;
  const selected = selection.contentSelection;
  const beginResize = useStableCallback(projection.panes.beginResultResize);
  const setResultWidth = useStableCallback(projection.panes.setResultWidth);
  const requestLifecycle = useStableCallback(
    (request: Parameters<typeof library.lifecycle.request>[0]) => void library.lifecycle.request(request),
  );
  const openDerivedVisual = useStableCallback(
    (visualId: string) => void model.workflow.content.derivedVisual.resumeDerivedVisual(visualId),
  );
  const selectDocument = useStableCallback(app.onSelectDocument);
  const openInNewTab = useStableCallback(app.onOpenInNewTab);
  const startNewCreation = useStableCallback(() => void navigation.creation.startNewCreation(null, 'push'));
  const startNewCreationInAlbum = useStableCallback(
    (albumId: string) => void navigation.creation.startNewCreation(albumId, 'push'),
  );
  const createAlbum = useStableCallback((parent: AlbumDto | null) =>
    library.setCreateAlbumRequest({ parent, destination: 'LIBRARY' }),
  );
  return (
    <div
      className={
        app.comparisonFullWindow || app.promptFullWindow
          ? 'hidden'
          : cn(
              projection.panes.compactPanel === 'library' ? 'block' : 'hidden',
              'min-h-0 min-w-0 overflow-hidden min-[840px]:block [&>*]:size-full',
            )
      }
    >
      <MemoizedResultLibrary
        active={app.creationLibraryActive}
        data={app.data}
        locale={app.locale}
        activeContent={app.documentWorkspaceActive ? 'documents' : 'images'}
        filter={selection.creationLibraryFilter}
        selectedSeriesId={selection.seriesId}
        selectedDerivedVisualId={workbench.editorSocialCoverVisual?.id ?? null}
        selectedCreationId={selected.selectedIdeaCreationId}
        selectedInspirationStashId={selected.selectedInspirationStashId}
        selectedImageBreakdownId={selected.selectedImageBreakdownId}
        selectedEvaluationSuiteId={selected.selectedEvaluationSuiteId}
        selectedSocialPostId={selected.selectedSocialPostId}
        selectedArticleId={selected.selectedArticleId}
        selectedAlbumId={selected.selectedAlbumId}
        selectedDocumentId={app.selectedDocumentId}
        selectedDocumentAlbumId={app.selectedDocumentAlbumId}
        documentNavigationRevision={app.documentNavigationRevision}
        surface={projection.creatorSurface}
        mode={projection.panes.multiPane ? projection.panes.resultLibraryMode : 'full'}
        canExpand={projection.panes.canExpandResultLibrary}
        resizeValue={projection.panes.resultWidth}
        resizeMin={projection.panes.resultResizeMin}
        resizeMax={projection.panes.resultResizeMax}
        showModeToggle={projection.panes.multiPane}
        lifecycleBusy={library.busy}
        onModeChange={projection.panes.setResultLibraryMode}
        onResizeStart={beginResize}
        onResizeValueChange={setResultWidth}
        onFilterChange={selection.setCreationLibraryFilter}
        onSelectInspirationStash={navigation.content.chooseInspirationStash}
        onSelectImageBreakdown={navigation.content.chooseImageBreakdown}
        onSelectEvaluationSuite={navigation.content.chooseEvaluationSuite}
        onSelectSocialPost={navigation.content.chooseSocialPost}
        onSelectArticle={navigation.content.chooseArticle}
        onRenameArticle={library.setRenameArticle}
        onContentLifecycleAction={requestLifecycle}
        onSelect={navigation.creation.chooseSeries}
        onOpenDerivedVisual={openDerivedVisual}
        onSelectDocument={selectDocument}
        onOpenInNewTab={openInNewTab}
        onRenameDocument={library.setRenameDocument}
        onSelectAlbum={navigation.content.chooseAlbum}
        onMore={navigation.output.showMoreResults}
        onNew={startNewCreation}
        onNewInAlbum={startNewCreationInAlbum}
        onRenameSeries={navigation.output.requestSeriesRename}
        onRenameAlbum={library.setRenameAlbum}
        onToggleAlbumPin={library.actions.toggleAlbumPin}
        onCreateAlbum={createAlbum}
        onMoveAlbum={library.actions.moveAlbum}
        onMoveCreationItem={library.actions.moveCreationItem}
        onToggleCreationItemPin={library.actions.toggleCreationItemPin}
        notify={app.notify}
      />
    </div>
  );
}

export function CreatorSpecializedWorkspace({ imageBreakdownSourceFormId, model }: Props) {
  const { app, library, navigation, projection, selection, workbench, workflow } = model;
  const { messages } = useI18n();
  const selected = selection.contentSelection;
  return (
    <CreatorWorkspaceRouter
      article={selected.selectedArticle}
      articleActions={{
        copy: workflow.content.article.copyForWechat,
        createArticle: workflow.content.article.createArticleFromArticle,
        createSocialPost: workflow.content.article.createSocialPostFromArticle,
        export: workflow.content.article.exportMarkdown,
        generateHeader: workflow.content.derivedVisual.openArticleHeaderWorkspace,
        generateIllustration: workflow.content.derivedVisual.openArticleIllustrationWorkspace,
        onSaved: app.onArticleSaved,
        save: workflow.content.article.saveArticleRevision,
      }}
      articleRelations={selected.articleRelations}
      album={selected.selectedAlbum}
      albumActions={{
        archive: (album) =>
          library.lifecycle.request({
            action: 'ARCHIVE',
            target: { entityType: 'ALBUM', entityId: album.id },
            title: album.title,
          }),
        createCreation: (albumId) => void navigation.creation.startNewCreation(albumId, 'push'),
        delete: (album) =>
          library.lifecycle.request({
            action: 'DELETE',
            target: { entityType: 'ALBUM', entityId: album.id },
            title: album.title,
          }),
        openMaterial: app.onOpenMaterial,
        rename: library.actions.renameAlbum,
        selectAlbum: navigation.content.chooseAlbum,
        selectDocument: app.onSelectDocument,
        selectSeries: navigation.creation.chooseSeries,
        settings: () => library.setSettingsAlbum(selected.selectedAlbum),
        togglePin: library.actions.toggleAlbumPin,
      }}
      comparisonFullWindow={app.comparisonFullWindow}
      compactPanel={projection.panes.compactPanel}
      creationLibraryFilter={selection.creationLibraryFilter}
      creationSessions={selection.creationSessions}
      data={app.data}
      documentNavigationRevision={app.documentNavigationRevision}
      documentWorkspace={app.documentWorkspace}
      documentWorkspaceActive={app.documentWorkspaceActive}
      evaluationActions={{ save: navigation.content.saveEvaluationSuite }}
      evaluationSuite={selected.selectedEvaluationSuite}
      imageBreakdown={selected.selectedImageBreakdown}
      imageBreakdownSourceFormId={imageBreakdownSourceFormId}
      lifecycleBusy={library.busy}
      locale={app.locale}
      messages={{
        generated: messages.gallery.card.generated,
        reference: messages.gallery.card.reference,
        textMaterial: messages.gallery.card.textMaterial,
      }}
      multiPane={projection.panes.multiPane}
      notify={app.notify}
      onContentLifecycleAction={(request) => void library.lifecycle.request(request)}
      onConfigureExtension={app.onConfigureExtension}
      onNavigateSeries={(id) => app.onNavigate({ surface: 'existing-creation', seriesId: id, assetId: null }, 'push')}
      onOpenRelation={(relation) => void navigation.content.openCreationRelation(relation)}
      promptFullWindow={app.promptFullWindow}
      refresh={app.refresh}
      socialPost={workbench.editorSocialCoverVisual ? null : selected.selectedSocialPost}
      socialPostActions={{
        createArticle: workflow.content.socialPost.createArticleFromSocialPost,
        createSocialPost: workflow.content.socialPost.createSocialPostFromSocialPost,
        generateCover: workflow.content.derivedVisual.openSocialCoverWorkspace,
        save: workflow.content.socialPost.saveSocialPost,
      }}
      socialPostRelations={selected.socialPostRelations}
    />
  );
}
