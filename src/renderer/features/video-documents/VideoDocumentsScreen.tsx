import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type SetStateAction,
} from 'react';
import type {
  AlbumDto,
  VideoDocumentDto,
  VideoDocumentExportResult,
  VideoDocumentGenerationRunDto,
} from '@/shared/contracts';
import type { NavigationMode, VideoDocumentsLocation } from '@/renderer/components/app/app-navigation';
import type { AlbumMoveTarget } from '@/renderer/components/albums/AlbumMoveDialog';
import { VideoDocumentLibraryPane } from '@/renderer/features/video-documents/VideoDocumentLibraryPane';
import { VideoDocumentFileInputs } from '@/renderer/features/video-documents/VideoDocumentFileInputs';
import type { VideoDocumentEmptyCreationSelection } from '@/renderer/features/video-documents/VideoDocumentEmptyCreation';
import { VideoDocumentTranscriptRecognitionDialog } from '@/renderer/features/video-documents/VideoDocumentTranscriptRecognitionDialog';
import { VideoDocumentTranscriptTranslationDialog } from '@/renderer/features/video-documents/VideoDocumentTranscriptTranslationDialog';
import { VideoDocumentWorkspacePane } from '@/renderer/features/video-documents/VideoDocumentWorkspacePane';
import {
  VideoDocumentWorkspaceDialogs,
  type VideoDocumentRenameRequest,
  type VideoDocumentStartRequest,
} from '@/renderer/features/video-documents/VideoDocumentWorkspaceDialogs';
import { useVideoDocumentContentActions } from '@/renderer/features/video-documents/useVideoDocumentContentActions';
import { useVideoDocumentLibraryActions } from '@/renderer/features/video-documents/useVideoDocumentLibraryActions';
import { useVideoDocumentList } from '@/renderer/features/video-documents/useVideoDocumentList';
import { useVideoDocumentNavigation } from '@/renderer/features/video-documents/useVideoDocumentNavigation';
import { useVideoDocumentSession } from '@/renderer/features/video-documents/useVideoDocumentSession';
import { useVideoDocumentTranscriptRecognition } from '@/renderer/features/video-documents/useVideoDocumentTranscriptRecognition';
import { useVideoDocumentTranscriptTranslation } from '@/renderer/features/video-documents/useVideoDocumentTranscriptTranslation';
import { useI18n } from '@/renderer/i18n/useI18n';

interface ExternalDocumentUpdate {
  revision: number;
  document: VideoDocumentDto;
}

interface Props {
  active: boolean;
  libraryVisible?: boolean;
  externalDocumentUpdate: ExternalDocumentUpdate | null;
  albums: AlbumDto[];
  location: VideoDocumentsLocation;
  onNavigate(location: VideoDocumentsLocation, mode?: NavigationMode): void;
  onAlbumsChange(): void | Promise<void>;
  onLibraryChange(): void;
  onOpenSourceMaterial(materialId: string): void;
  notify(message: string): void;
}

type VideoDocumentLabels = ReturnType<typeof useI18n>['messages']['videoDocuments'];

function generationErrorLabel(run: VideoDocumentGenerationRunDto, labels: VideoDocumentLabels) {
  switch (run.errorCode) {
    case 'VIDEO_DOCUMENT_TRANSCRIPT_REQUIRED':
      return labels.generation.transcriptRequired;
    case 'VIDEO_DOCUMENT_GENERATION_BUSY':
      return labels.generation.busy;
    case 'VIDEO_DOCUMENT_MODEL_UNAVAILABLE':
    case 'VIDEO_DOCUMENT_REASONING_UNAVAILABLE':
      return labels.generation.modelUnavailable;
    case 'VIDEO_DOCUMENT_CODEX_NOT_LOGGED_IN':
      return labels.generation.notLoggedIn;
    case 'VIDEO_DOCUMENT_RATE_LIMITED':
      return labels.generation.rateLimited(
        run.errorDetails?.resetAt ? new Date(run.errorDetails.resetAt).toLocaleString() : null,
      );
    case 'VIDEO_DOCUMENT_CREDITS_DEPLETED':
      return labels.generation.creditsDepleted;
    case 'VIDEO_DOCUMENT_WORKSPACE_USAGE_LIMIT':
      return labels.generation.workspaceUsageLimit;
    case 'EMPTY_RESPONSE':
      return labels.generation.emptyResponse;
    case 'VIDEO_DOCUMENT_MODEL_OUTPUT_INVALID':
      return labels.generation.invalidOutput;
    case 'INTERRUPTED':
    case 'CANCELLED':
      return labels.generation.interrupted;
    default:
      return labels.generation.failed;
  }
}

function exportErrorLabel(
  result: Extract<VideoDocumentExportResult, { status: 'failed' }>,
  labels: VideoDocumentLabels,
) {
  return labels.export.errors[result.code];
}

function useExternalDocumentUpdate(
  update: ExternalDocumentUpdate | null,
  selectedDocumentId: string | null,
  setDocument: Dispatch<SetStateAction<VideoDocumentDto | null>>,
  setTitle: Dispatch<SetStateAction<string>>,
) {
  const appliedRevision = useRef(0);
  useEffect(() => {
    if (!update || update.revision <= appliedRevision.current) return;
    appliedRevision.current = update.revision;
    if (update.document.id !== selectedDocumentId) return;
    setDocument(update.document);
    setTitle(update.document.title);
  }, [selectedDocumentId, setDocument, setTitle, update]);
}

function useTranscriptRecognition(
  session: ReturnType<typeof useVideoDocumentSession>,
  documentList: Pick<ReturnType<typeof useVideoDocumentList>, 'updateSummary'>,
  refreshNavigation: () => void,
  contentActions: Pick<ReturnType<typeof useVideoDocumentContentActions>, 'importTranscript' | 'generateArticle'>,
  startTranslation: (targetLocales: string[]) => boolean,
) {
  const recognition = useVideoDocumentTranscriptRecognition({
    document: session.document,
    selectedDocumentIdRef: session.selectedDocumentIdRef,
    setDocument: session.setDocument,
    setTitle: session.setTitle,
    updateSummary: documentList.updateSummary,
    refreshNavigation,
  });
  const documentId = session.document?.id ?? null;
  return {
    ...recognition,
    workspaceProps: {
      ...recognition.workspaceProps,
      onStartCreation: (selection: VideoDocumentEmptyCreationSelection) =>
        continueEmptyCreation(
          documentId,
          selection,
          recognition.start,
          startTranslation,
          contentActions.generateArticle,
        ),
      onImportCreation: (selection: VideoDocumentEmptyCreationSelection) =>
        continueEmptyCreation(
          documentId,
          selection,
          contentActions.importTranscript,
          startTranslation,
          contentActions.generateArticle,
        ),
    },
  };
}

function useCombinedNavigationRefresh(refresh: () => void, onLibraryChange: () => void) {
  return useCallback(() => {
    refresh();
    onLibraryChange();
  }, [onLibraryChange, refresh]);
}

function useScreenContentActions({
  session,
  documentList,
  labels,
  notify,
  formatGenerationError,
  refreshNavigation,
  refreshAlbumPreviews,
}: {
  session: ReturnType<typeof useVideoDocumentSession>;
  documentList: Pick<ReturnType<typeof useVideoDocumentList>, 'updateSummary'>;
  labels: VideoDocumentLabels;
  notify(message: string): void;
  formatGenerationError(run: VideoDocumentGenerationRunDto): string;
  refreshNavigation(): void;
  refreshAlbumPreviews(): void | Promise<void>;
}) {
  return useVideoDocumentContentActions({
    document: session.document,
    selectedBranch: session.selectedBranch,
    activeRevision: session.activeRevision,
    selectedDocumentIdRef: session.selectedDocumentIdRef,
    labels: {
      transcriptRequired: labels.generation.transcriptRequired,
      generationBusy: labels.generation.busy,
      modelUnavailable: labels.generation.modelUnavailable,
      generationFailed: labels.generation.failed,
      exportFailed: labels.export.failed,
      audioProbeFailed: labels.player.audioProbeFailed,
      videoUnsupported: labels.start.unsupported,
      videoTooLarge: labels.start.tooLarge,
      videoUnreadable: labels.start.unreadable,
      videoReplaceFailed: labels.player.replaceVideoFailed,
      videoReplaceIncompatible: labels.player.replaceVideoIncompatible,
      videoReplaceAlreadyUsed: labels.player.replaceVideoAlreadyUsed,
      videoReplaceSucceeded: labels.player.replaceVideoSucceeded,
      exportSaved: labels.export.saved,
    },
    notify,
    formatGenerationError,
    formatExportError: (result) => exportErrorLabel(result, labels),
    setDocument: session.setDocument,
    setTitle: session.setTitle,
    setActiveBranch: session.setActiveBranch,
    updateSummary: documentList.updateSummary,
    refreshNavigation,
    refreshAlbumPreviews,
  });
}

export async function continueEmptyCreation(
  documentId: string | null,
  selection: VideoDocumentEmptyCreationSelection,
  createTranscript: () => Promise<boolean>,
  startTranslation: (targetLocales: string[]) => boolean,
  generateArticle: (options: { documentId: string; transcriptReady: boolean }) => Promise<boolean>,
) {
  if (!documentId || !(await createTranscript())) return;
  if (selection.article) await generateArticle({ documentId, transcriptReady: true });
  if (selection.translationLocales.length) startTranslation(selection.translationLocales);
}

export function VideoDocumentsScreen({
  active,
  libraryVisible = true,
  externalDocumentUpdate,
  albums,
  location,
  onNavigate,
  onAlbumsChange,
  onLibraryChange,
  onOpenSourceMaterial,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const labels = messages.videoDocuments;
  const [query, setQuery] = useState('');
  const [moveTarget, setMoveTarget] = useState<AlbumMoveTarget | null>(null);
  const [createAlbumParentId, setCreateAlbumParentId] = useState<string | null | undefined>(undefined);
  const [renameAlbumId, setRenameAlbumId] = useState<string | null>(null);
  const [renameDocument, setRenameDocument] = useState<VideoDocumentRenameRequest | null>(null);
  const [startRequest, setStartRequest] = useState<VideoDocumentStartRequest | null>(null);
  const [externalDragActive, setExternalDragActive] = useState(false);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const replacementVideoFileInputRef = useRef<HTMLInputElement>(null);
  const searchActive = active && libraryVisible && Boolean(query.trim());
  const documentList = useVideoDocumentList({ active: searchActive, query, albumId: null, unfiledOnly: false, notify });
  const navigation = useVideoDocumentNavigation({ active: active && libraryVisible && !searchActive, notify });
  const refreshNavigation = useCombinedNavigationRefresh(navigation.refresh, onLibraryChange);
  const session = useVideoDocumentSession({
    active,
    documentId: location.documentId,
    revisionLoadFailedLabel: labels.revisionLoadFailed,
    keyChangeErrorLabels: labels.keyChanges,
    notify,
  });
  useExternalDocumentUpdate(externalDocumentUpdate, location.documentId, session.setDocument, session.setTitle);
  const formatGenerationError = (run: VideoDocumentGenerationRunDto) => generationErrorLabel(run, labels);
  const libraryActions = useVideoDocumentLibraryActions({
    locale,
    location,
    document: session.document,
    title: session.title,
    selectedDocumentIdRef: session.selectedDocumentIdRef,
    importFailedLabel: labels.start.failed,
    transcriptRequiredLabel: labels.generation.transcriptRequired,
    onNavigate,
    onAlbumsChange,
    notify,
    formatGenerationError,
    setDocument: session.setDocument,
    setTitle: session.setTitle,
    updateSummary: documentList.updateSummary,
    refreshDocumentList: documentList.refresh,
    refreshNavigation,
  });
  const contentActions = useScreenContentActions({
    session,
    documentList,
    labels,
    notify,
    formatGenerationError,
    refreshNavigation,
    refreshAlbumPreviews: onAlbumsChange,
  });
  const activeTranscriptContent =
    session.activeRevision.revision?.content.format === 'TIMED_TRANSCRIPT'
      ? session.activeRevision.revision.content
      : null;
  const transcriptTranslation = useVideoDocumentTranscriptTranslation({
    document: session.document,
    content: activeTranscriptContent,
    selectedDocumentIdRef: session.selectedDocumentIdRef,
    setDocument: session.setDocument,
    setTitle: session.setTitle,
    updateSummary: documentList.updateSummary,
    refreshNavigation,
    notify,
  });
  const transcriptRecognition = useTranscriptRecognition(
    session,
    documentList,
    navigation.refresh,
    contentActions,
    transcriptTranslation.start,
  );

  useEffect(() => {
    if (!active || !libraryVisible || location.documentId) return;
    const firstDocument = navigation.root.items.find((entry) => entry.kind === 'DOCUMENT');
    if (firstDocument?.kind === 'DOCUMENT') {
      onNavigate({ collection: { kind: 'unfiled' }, documentId: firstDocument.documentId }, 'replace');
    }
  }, [active, libraryVisible, location.documentId, navigation.root.items, onNavigate]);

  function chooseVideoFile() {
    videoFileInputRef.current?.click();
  }

  function handleExternalDrag(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setExternalDragActive(true);
  }

  function handleExternalDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setExternalDragActive(false);
    const file = [...event.dataTransfer.files][0];
    if (file) setStartRequest({ file, source: 'DROP' });
  }

  return (
    <div
      className="relative flex size-full min-h-0 bg-background"
      data-slot="video-documents-screen"
      onDragEnter={handleExternalDrag}
      onDragOver={handleExternalDrag}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExternalDragActive(false);
      }}
      onDrop={handleExternalDrop}
    >
      <VideoDocumentFileInputs
        createInputRef={videoFileInputRef}
        replacementInputRef={replacementVideoFileInputRef}
        onCreate={(file) => setStartRequest({ file, source: 'UPLOAD' })}
        onReplace={(file) => void contentActions.replaceVideo(file)}
      />
      {externalDragActive && (
        <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-xl border-2 border-dashed border-selected-foreground/60 bg-background/95 text-sm font-medium text-selected-foreground shadow-overlay backdrop-blur-sm">
          {labels.start.dropOverlay}
        </div>
      )}
      {libraryVisible && (
        <VideoDocumentLibraryPane
          albums={albums}
          location={location}
          query={query}
          root={navigation.root}
          children={navigation.children}
          searchItems={documentList.items}
          searchLoading={documentList.loading}
          searchLoadingMore={documentList.loadingMore}
          searchHasMore={documentList.hasMore}
          onQueryChange={setQuery}
          onExpandAlbum={navigation.ensureChildren}
          onSelectDocument={(documentId, parentAlbumId) =>
            onNavigate({
              collection: parentAlbumId ? { kind: 'album', albumId: parentAlbumId } : { kind: 'unfiled' },
              documentId,
            })
          }
          onLoadRootMore={navigation.loadRootMore}
          onLoadChildrenMore={navigation.loadChildrenMore}
          onLoadSearchMore={() => void documentList.loadMore()}
          onMoveDocument={libraryActions.moveDocument}
          onMoveAlbum={libraryActions.moveAlbum}
          onStartVideoDocument={chooseVideoFile}
          onCreateAlbum={setCreateAlbumParentId}
          onRenameAlbum={setRenameAlbumId}
          onRenameDocument={(documentId, title) => setRenameDocument({ id: documentId, title })}
          onRequestMove={setMoveTarget}
          onReorder={(parentAlbumId, targets) => navigation.reorder({ parentAlbumId, targets })}
        />
      )}
      <section className="flex min-w-0 flex-1">
        <VideoDocumentWorkspacePane
          documentLoading={session.documentLoading}
          document={session.document}
          title={session.title}
          savingTitle={libraryActions.savingTitle}
          sourcePaneOpen={session.sourcePaneOpen}
          activeBranch={session.activeBranch}
          selectedBranchId={session.selectedBranch?.id ?? null}
          activeNoteId={session.activeNoteId}
          revision={session.activeRevision.revision}
          articleTranscriptRevision={session.articleTranscriptRevision}
          revisionLoading={session.activeRevision.loading}
          keyChangeResult={session.keyChanges.result}
          keyChangesLoading={session.keyChanges.loading}
          keyChangesExtracting={session.keyChanges.extracting}
          seekRequest={session.keyChanges.seekRequest}
          currentTimeMs={session.playbackTimeMs}
          timelineSegments={session.timelineSegments}
          sourcePaneWidth={session.sourcePaneWidth}
          generating={contentActions.generating}
          exportingFormat={contentActions.exportingFormat}
          generationError={contentActions.generationError}
          generationHistoryRefreshKey={contentActions.generationHistoryRefreshKey}
          lastExport={contentActions.lastExport}
          importingTranscript={contentActions.importingTranscript}
          {...transcriptRecognition.workspaceProps}
          {...transcriptTranslation.workspaceProps}
          replacingVideo={contentActions.replacingVideo}
          onTitleChange={session.setTitle}
          onSaveTitle={() => void libraryActions.saveTitle()}
          onMove={() => {
            const current = session.document;
            if (current)
              setMoveTarget({
                kind: 'DOCUMENT',
                id: current.id,
                title: current.title,
                currentAlbumId: current.albumId,
              });
          }}
          onOpenSourcePane={() => session.setSourcePaneOpen(true)}
          onCollapseSourcePane={() => session.setSourcePaneOpen(false)}
          onSourcePaneWidthChange={session.setSourcePaneWidth}
          onPlaybackTimeChange={session.setPlaybackTimeMs}
          onPlaybackError={() => notify(labels.player.playbackFailed)}
          onReplaceVideo={() => replacementVideoFileInputRef.current?.click()}
          onRecheckAudio={contentActions.recheckAudio}
          notify={notify}
          onBranchChange={session.setActiveBranch}
          onActiveNoteChange={session.setActiveNoteId}
          onExtractKeyChanges={() => void session.keyChanges.extract()}
          onGenerate={(noteId) => void contentActions.generateArticle({ noteId })}
          onExport={(format, noteId) => void contentActions.exportDocument(format, noteId)}
          onRevealExport={contentActions.revealExport}
          onImportTranscript={() => void contentActions.importTranscript()}
          onSaveRevision={contentActions.saveRevision}
          onSeek={session.keyChanges.seek}
          onOpenSourceMaterial={onOpenSourceMaterial}
          onStartVideoDocument={chooseVideoFile}
          onCreateAlbum={() => setCreateAlbumParentId(null)}
        />
      </section>
      <VideoDocumentTranscriptRecognitionDialog {...transcriptRecognition.dialogProps} />
      <VideoDocumentTranscriptTranslationDialog {...transcriptTranslation.dialogProps} />
      <VideoDocumentWorkspaceDialogs
        albums={albums}
        location={location}
        document={session.document}
        moveTarget={moveTarget}
        createAlbumParentId={createAlbumParentId}
        renameAlbumId={renameAlbumId}
        renameDocument={renameDocument}
        startRequest={startRequest}
        onMoveTargetChange={setMoveTarget}
        onCreateAlbumParentChange={setCreateAlbumParentId}
        onRenameAlbumIdChange={setRenameAlbumId}
        onRenameDocumentChange={setRenameDocument}
        onStartRequestChange={setStartRequest}
        onMoveAlbum={libraryActions.moveAlbum}
        onMoveDocument={libraryActions.moveDocument}
        onCreateAlbum={libraryActions.createAlbum}
        onRenameAlbum={libraryActions.renameAlbum}
        onRenameDocument={libraryActions.renameDocument}
        onCreateDocument={libraryActions.createDocument}
      />
    </div>
  );
}
