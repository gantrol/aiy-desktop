import {
  AudioLinesIcon,
  DownloadIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import type {
  VideoDocumentBranchDto,
  VideoDocumentBranchRole,
  VideoDocumentDto,
  VideoDocumentExportFormat,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentTimelineSegment,
  VideoDocumentTranscriptBackgroundTaskStatus,
  VideoDocumentTranscriptRecognitionProgress,
  VideoKeyChangeResultDto,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { VideoDocumentArticle } from '@/renderer/features/video-documents/VideoDocumentArticle';
import type { VideoDocumentQuickInsertNoteRequest } from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import { selectVideoDocumentArticle } from '@/renderer/features/video-documents/videoDocumentArticleContent';
import { VideoDocumentExportMenu } from '@/renderer/features/video-documents/VideoDocumentExportMenu';
import { VideoDocumentHeader } from '@/renderer/features/video-documents/VideoDocumentHeader';
import type { VideoDocumentEmptyCreationSelection } from '@/renderer/features/video-documents/VideoDocumentEmptyCreation';
import { VideoDocumentEmptyWorkspace } from '@/renderer/features/video-documents/VideoDocumentEmptyWorkspace';
import { VideoDocumentGenerationHistory } from '@/renderer/features/video-documents/VideoDocumentGenerationHistory';
import {
  VideoDocumentToolbar,
  VideoDocumentToolbarAction,
} from '@/renderer/features/video-documents/VideoDocumentToolbar';
import { VideoDocumentTranscript } from '@/renderer/features/video-documents/VideoDocumentTranscript';
import type { VideoDocumentTranscriptTranslationProgress } from '@/renderer/features/video-documents/useVideoDocumentTranscriptTranslation';
import { VideoDocumentWorkspaceStart } from '@/renderer/features/video-documents/VideoDocumentWorkspaceStart';
import { VideoDocumentWorkspaceSourcePane } from '@/renderer/features/video-documents/VideoDocumentWorkspaceSourcePane';
import { VideoKeyChangePanel } from '@/renderer/features/video-documents/VideoKeyChangePanel';
import { useI18n } from '@/renderer/i18n/useI18n';

const exportableBranchRoles = new Set<VideoDocumentBranchRole>(['CLEAN_TRANSCRIPT', 'ARTICLE']);

type TranscriptRecognitionLabels = ReturnType<
  typeof useI18n
>['messages']['videoDocuments']['transcript']['recognition'];

function transcriptRecognitionActionLabel(
  labels: TranscriptRecognitionLabels,
  recognizing: boolean,
  status: VideoDocumentTranscriptBackgroundTaskStatus | null,
  progress: VideoDocumentTranscriptRecognitionProgress | null,
  hasTranscript: boolean,
) {
  if (!recognizing) return hasTranscript ? labels.recognizeAgain : labels.recognize;
  if (status === 'CANCELLING') return labels.cancelling;
  if (status === 'STARTING') return labels.starting;
  if (!progress) return labels.running;
  const percent = Math.min(100, Math.round((progress.completedChunks / progress.totalChunks) * 100));
  return labels.runningProgress(percent);
}

function transcriptRecognitionActionDisabled(input: {
  translating: boolean;
  generating: boolean;
  canRecognize: boolean;
  recognizing: boolean;
  importingTranscript: boolean;
}) {
  return (
    input.translating || input.generating || (!input.canRecognize && !input.recognizing) || input.importingTranscript
  );
}

function transcriptImportActionDisabled(input: {
  recognizing: boolean;
  translating: boolean;
  generating: boolean;
  importingTranscript: boolean;
}) {
  return input.recognizing || input.translating || input.generating || input.importingTranscript;
}

function articleGenerationActionDisabled(
  generating: boolean,
  recognizing: boolean,
  translating: boolean,
  revisionLoading = false,
) {
  return generating || recognizing || translating || revisionLoading;
}

function availableTranslationAction(recognizing: boolean, generating: boolean, onTranslate: (() => void) | undefined) {
  return recognizing || generating ? undefined : onTranslate;
}

interface BranchContentProps {
  documentId: string;
  documentTitle: string;
  sourceVideoUrl: string;
  branch: VideoDocumentBranchDto;
  revision: VideoDocumentRevisionDto | null;
  transcriptRevision: VideoDocumentRevisionDto | null;
  revisionLoading: boolean;
  revisionUnavailableLabel: string;
  noRevisionLabel: string;
  keyChangeResult: VideoKeyChangeResultDto | null;
  keyChangesLoading: boolean;
  keyChangesExtracting: boolean;
  generating: boolean;
  recognizing: boolean;
  translating: boolean;
  translationProgress: VideoDocumentTranscriptTranslationProgress | null;
  translationCancelling: boolean;
  currentTimeMs: number;
  durationMs: number;
  activeNoteId: string | null;
  timelineSegments: VideoDocumentTimelineSegment[];
  quickInsertNoteRequest?: VideoDocumentQuickInsertNoteRequest | null;
  toolbarActions: ReactNode;
  toolbarTarget: HTMLElement | null;
  onExtractKeyChanges(): void;
  onSaveRevision(content: VideoDocumentRevisionContent): Promise<void>;
  onOpenTranscript(timestampMs: number): void;
  onActiveNoteChange(noteId: string): void;
  onArticleEditingChange?(editing: boolean): void;
  onQuickInsertNoteBusyChange?(busy: boolean): void;
  onSeek(timestampMs: number): void;
  onGenerate?(noteId?: string | null): void;
  onTranslate?(): void;
  onCancelTranslation?(): void;
}

function DocumentBranchContent({
  documentId,
  documentTitle,
  sourceVideoUrl,
  branch,
  revision,
  transcriptRevision,
  revisionLoading,
  revisionUnavailableLabel,
  noRevisionLabel,
  keyChangeResult,
  keyChangesLoading,
  keyChangesExtracting,
  generating,
  recognizing,
  translating,
  translationProgress,
  translationCancelling,
  currentTimeMs,
  durationMs,
  activeNoteId,
  timelineSegments,
  quickInsertNoteRequest,
  toolbarActions,
  toolbarTarget,
  onExtractKeyChanges,
  onSaveRevision,
  onOpenTranscript,
  onActiveNoteChange,
  onArticleEditingChange,
  onQuickInsertNoteBusyChange,
  onSeek,
  onGenerate,
  onTranslate,
  onCancelTranslation,
}: BranchContentProps) {
  const { messages } = useI18n();
  if (branch.latestDraftRevisionId && revisionLoading) {
    return (
      <div className="grid h-28 place-items-center text-muted-foreground">
        <LoaderCircleIcon className="size-5 animate-spin" />
      </div>
    );
  }
  if (
    revision &&
    branch.role === 'ARTICLE' &&
    (revision.content.format === 'MARKDOWN' || revision.content.format === 'NOTE_COLLECTION')
  ) {
    return (
      <VideoDocumentArticle
        documentId={documentId}
        documentTitle={documentTitle}
        sourceVideoUrl={sourceVideoUrl}
        revision={revision}
        transcriptRevision={transcriptRevision}
        toolbarActions={toolbarActions}
        toolbarTarget={toolbarTarget}
        onSave={onSaveRevision}
        generating={generating}
        generationDisabled={articleGenerationActionDisabled(generating, recognizing, translating, revisionLoading)}
        onGenerate={onGenerate}
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        quickInsertNoteRequest={quickInsertNoteRequest}
        activeNoteId={activeNoteId}
        onEditingChange={onArticleEditingChange}
        onQuickInsertNoteBusyChange={onQuickInsertNoteBusyChange}
        onActiveNoteChange={onActiveNoteChange}
        onOpenTranscript={onOpenTranscript}
        onSeek={onSeek}
      />
    );
  }
  if (revision && branch.role === 'CLEAN_TRANSCRIPT' && revision.content.format === 'TIMED_TRANSCRIPT') {
    return (
      <VideoDocumentTranscript
        revision={revision}
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        segments={timelineSegments}
        labels={{ timeline: messages.videoDocuments.transcript.timeline }}
        toolbarActions={toolbarActions}
        toolbarTarget={toolbarTarget}
        onSave={recognizing || translating ? undefined : onSaveRevision}
        translating={translating}
        translationProgress={translationProgress}
        translationCancelling={translationCancelling}
        onTranslate={onTranslate}
        onCancelTranslation={onCancelTranslation}
        onSeek={onSeek}
      />
    );
  }
  if (branch.latestDraftRevisionId) {
    return <p className="py-8 text-sm text-muted-foreground">{revisionUnavailableLabel}</p>;
  }
  if (branch.role === 'ARTICLE') {
    return (
      <VideoKeyChangePanel
        result={keyChangeResult}
        loading={keyChangesLoading}
        extracting={keyChangesExtracting}
        onExtract={onExtractKeyChanges}
        onSeek={onSeek}
      />
    );
  }
  return <p className="py-8 text-sm text-muted-foreground">{noRevisionLabel}</p>;
}

interface BranchPanelProps extends Omit<BranchContentProps, 'toolbarActions'> {
  documentId: string;
  canRecognize: boolean;
  recognitionProgress: VideoDocumentTranscriptRecognitionProgress | null;
  recognitionTaskStatus: VideoDocumentTranscriptBackgroundTaskStatus | null;
  exportingFormat: VideoDocumentExportFormat | null;
  generationError: string | null;
  importingTranscript: boolean;
  generationHistoryRefreshKey: number;
  lastExportPath: string | null;
  notify(message: string): void;
  onGenerate(noteId?: string | null): void;
  onExport(format: VideoDocumentExportFormat, noteId?: string | null): void;
  onRevealExport(outputPath: string): void;
  onImportTranscript(): void;
  onRecognize(): void;
}

function DocumentBranchPanel({
  documentId,
  documentTitle,
  sourceVideoUrl,
  canRecognize,
  recognitionProgress,
  recognitionTaskStatus,
  branch,
  revision,
  transcriptRevision,
  revisionLoading,
  revisionUnavailableLabel,
  noRevisionLabel,
  keyChangeResult,
  keyChangesLoading,
  keyChangesExtracting,
  generating,
  exportingFormat,
  generationError,
  importingTranscript,
  recognizing,
  translating,
  translationProgress,
  translationCancelling,
  currentTimeMs,
  durationMs,
  activeNoteId,
  timelineSegments,
  quickInsertNoteRequest,
  toolbarTarget,
  generationHistoryRefreshKey,
  lastExportPath,
  notify,
  onExtractKeyChanges,
  onGenerate,
  onExport,
  onRevealExport,
  onImportTranscript,
  onRecognize,
  onTranslate,
  onCancelTranslation,
  onSaveRevision,
  onOpenTranscript,
  onActiveNoteChange,
  onArticleEditingChange,
  onQuickInsertNoteBusyChange,
  onSeek,
}: BranchPanelProps) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  const integratedToolbar = Boolean(
    revision &&
    ((branch.role === 'ARTICLE' &&
      (revision.content.format === 'MARKDOWN' || revision.content.format === 'NOTE_COLLECTION')) ||
      (branch.role === 'CLEAN_TRANSCRIPT' && revision.content.format === 'TIMED_TRANSCRIPT')),
  );
  const recognitionLabel = transcriptRecognitionActionLabel(
    labels.transcript.recognition,
    recognizing,
    recognitionTaskStatus,
    recognitionProgress,
    Boolean(branch.latestDraftRevisionId),
  );
  const hasToolbarActions = branch.role === 'CLEAN_TRANSCRIPT' || branch.role === 'ARTICLE';
  const selectedArticle = selectVideoDocumentArticle(revision?.content, activeNoteId);
  const toolbarActions = (
    <>
      {branch.role === 'CLEAN_TRANSCRIPT' && (
        <>
          <VideoDocumentToolbarAction
            type="button"
            disabled={transcriptRecognitionActionDisabled({
              translating,
              generating,
              canRecognize,
              recognizing,
              importingTranscript,
            })}
            expanded={recognizing}
            icon={
              recognizing ? <LoaderCircleIcon className="size-4 animate-spin" /> : <AudioLinesIcon className="size-4" />
            }
            label={recognitionLabel}
            onClick={onRecognize}
          />
          <VideoDocumentToolbarAction
            type="button"
            disabled={transcriptImportActionDisabled({
              recognizing,
              translating,
              generating,
              importingTranscript,
            })}
            icon={
              importingTranscript ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : branch.latestDraftRevisionId ? (
                <RefreshCwIcon className="size-4" />
              ) : (
                <DownloadIcon className="size-4" />
              )
            }
            label={branch.latestDraftRevisionId ? labels.transcript.replace : labels.transcript.import}
            onClick={onImportTranscript}
          />
        </>
      )}
      {branch.role === 'ARTICLE' && (
        <>
          {!integratedToolbar && (
            <VideoDocumentToolbarAction
              type="button"
              disabled={articleGenerationActionDisabled(generating, recognizing, translating, revisionLoading)}
              icon={
                generating ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />
              }
              label={generating ? labels.generation.generating : labels.generation.generate}
              onClick={() => onGenerate(selectedArticle?.noteId ?? null)}
            />
          )}
          <VideoDocumentGenerationHistory
            documentId={documentId}
            refreshKey={generationHistoryRefreshKey}
            notify={notify}
          />
        </>
      )}
      {exportableBranchRoles.has(branch.role) && (
        <>
          <VideoDocumentExportMenu
            disabled={!revision || revisionLoading}
            exportingFormat={exportingFormat}
            labels={labels.export}
            onExport={(format) => onExport(format, selectedArticle?.noteId ?? null)}
          />
          {lastExportPath && (
            <VideoDocumentToolbarAction
              type="button"
              icon={<FolderOpenIcon className="size-4" />}
              label={labels.export.openLocation}
              onClick={() => onRevealExport(lastExportPath)}
            />
          )}
        </>
      )}
    </>
  );
  return (
    <div className="mx-auto w-full max-w-3xl">
      {!integratedToolbar && hasToolbarActions && (
        <VideoDocumentToolbar target={toolbarTarget}>{toolbarActions}</VideoDocumentToolbar>
      )}
      {generationError && branch.role === 'ARTICLE' && (
        <p className="border-b py-3 text-sm text-destructive">{generationError}</p>
      )}
      <DocumentBranchContent
        documentId={documentId}
        documentTitle={documentTitle}
        sourceVideoUrl={sourceVideoUrl}
        branch={branch}
        revision={revision}
        transcriptRevision={transcriptRevision}
        revisionLoading={revisionLoading}
        revisionUnavailableLabel={revisionUnavailableLabel}
        noRevisionLabel={noRevisionLabel}
        keyChangeResult={keyChangeResult}
        keyChangesLoading={keyChangesLoading}
        keyChangesExtracting={keyChangesExtracting}
        generating={generating}
        recognizing={recognizing}
        translating={translating}
        translationProgress={translationProgress}
        translationCancelling={translationCancelling}
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        activeNoteId={activeNoteId}
        timelineSegments={timelineSegments}
        quickInsertNoteRequest={quickInsertNoteRequest}
        toolbarActions={toolbarActions}
        toolbarTarget={toolbarTarget}
        onExtractKeyChanges={onExtractKeyChanges}
        onSaveRevision={onSaveRevision}
        onOpenTranscript={onOpenTranscript}
        onActiveNoteChange={onActiveNoteChange}
        onArticleEditingChange={onArticleEditingChange}
        onQuickInsertNoteBusyChange={onQuickInsertNoteBusyChange}
        onSeek={onSeek}
        onGenerate={onGenerate}
        onTranslate={availableTranslationAction(recognizing, generating, onTranslate)}
        onCancelTranslation={onCancelTranslation}
      />
    </div>
  );
}

export interface VideoDocumentWorkspacePaneProps {
  documentLoading: boolean;
  document: VideoDocumentDto | null;
  title: string;
  savingTitle: boolean;
  sourcePaneOpen: boolean;
  activeBranch: VideoDocumentBranchRole;
  selectedBranchId: string | null;
  activeNoteId: string | null;
  revision: VideoDocumentRevisionDto | null;
  articleTranscriptRevision: VideoDocumentRevisionDto | null;
  revisionLoading: boolean;
  keyChangeResult: VideoKeyChangeResultDto | null;
  keyChangesLoading: boolean;
  keyChangesExtracting: boolean;
  seekRequest: { timestampMs: number; revision: number } | null;
  currentTimeMs: number;
  timelineSegments: VideoDocumentTimelineSegment[];
  sourcePaneWidth: number;
  generationHistoryRefreshKey: number;
  lastExport: { branchId: string; outputPath: string } | null;
  generating: boolean;
  exportingFormat: VideoDocumentExportFormat | null;
  generationError: string | null;
  importingTranscript: boolean;
  recognizing: boolean;
  translating: boolean;
  translationProgress: VideoDocumentTranscriptTranslationProgress | null;
  translationCancelling: boolean;
  canRecognize: boolean;
  recognitionProgress: VideoDocumentTranscriptRecognitionProgress | null;
  recognitionTaskStatus: VideoDocumentTranscriptBackgroundTaskStatus | null;
  replacingVideo: boolean;
  onTitleChange(title: string): void;
  onSaveTitle(): void;
  onMove(): void;
  onOpenSourcePane(): void;
  onCollapseSourcePane(): void;
  onSourcePaneWidthChange(width: number): void;
  onPlaybackTimeChange(timestampMs: number): void;
  onPlaybackError(error: unknown): void;
  onReplaceVideo(): void;
  onRecheckAudio(): void;
  notify(message: string): void;
  onBranchChange(role: VideoDocumentBranchRole): void;
  onActiveNoteChange(noteId: string): void;
  onExtractKeyChanges(): void;
  onGenerate(noteId?: string | null): void;
  onExport(format: VideoDocumentExportFormat, noteId?: string | null): void;
  onRevealExport(outputPath: string): void;
  onImportTranscript(): void;
  onRecognize(): void;
  onTranslate(): void;
  onCancelTranslation(): void;
  onStartCreation(selection: VideoDocumentEmptyCreationSelection): Promise<void>;
  onImportCreation(selection: VideoDocumentEmptyCreationSelection): Promise<void>;
  onSaveRevision(content: VideoDocumentRevisionContent): Promise<void>;
  onSeek(timestampMs: number): void;
  onOpenSourceMaterial(materialId: string): void;
  onStartVideoDocument(): void;
  onCreateAlbum(): void;
}

function hasNoCreatedContent(document: VideoDocumentDto) {
  return document.branches
    .filter((branch) => branch.role === 'CLEAN_TRANSCRIPT' || branch.role === 'ARTICLE')
    .every((branch) => !branch.latestDraftRevisionId);
}

function useOpenTranscript(
  onSeek: (timestampMs: number) => void,
  onBranchChange: (role: VideoDocumentBranchRole) => void,
) {
  return useCallback(
    (timestampMs: number) => {
      onSeek(timestampMs);
      onBranchChange('CLEAN_TRANSCRIPT');
    },
    [onBranchChange, onSeek],
  );
}

function useQuickInsertNoteAction(currentTimeMs: number) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<VideoDocumentQuickInsertNoteRequest | null>(null);
  const onEditingChange = useCallback((nextEditing: boolean) => {
    setEditing(nextEditing);
    if (nextEditing) return;
    setBusy(false);
    setRequest(null);
  }, []);
  const requestInsert = useCallback(() => {
    setBusy(true);
    setRequest((current) => ({
      revision: (current?.revision ?? 0) + 1,
      timestampMs: currentTimeMs,
    }));
  }, [currentTimeMs]);
  return { editing, busy, request, setBusy, onEditingChange, requestInsert };
}

function VideoDocumentWorkspaceLoading() {
  return (
    <div className="grid size-full place-items-center text-muted-foreground">
      <LoaderCircleIcon className="size-5 animate-spin" />
    </div>
  );
}

export function VideoDocumentWorkspacePane({
  documentLoading,
  document,
  title,
  savingTitle,
  sourcePaneOpen,
  activeBranch,
  selectedBranchId,
  activeNoteId,
  revision,
  articleTranscriptRevision,
  revisionLoading,
  keyChangeResult,
  keyChangesLoading,
  keyChangesExtracting,
  seekRequest,
  currentTimeMs,
  timelineSegments,
  sourcePaneWidth,
  generationHistoryRefreshKey,
  lastExport,
  generating,
  exportingFormat,
  generationError,
  importingTranscript,
  recognizing,
  translating,
  translationProgress,
  translationCancelling,
  canRecognize,
  recognitionProgress,
  recognitionTaskStatus,
  replacingVideo,
  onTitleChange,
  onSaveTitle,
  onMove,
  onOpenSourcePane,
  onCollapseSourcePane,
  onSourcePaneWidthChange,
  onPlaybackTimeChange,
  onPlaybackError,
  onReplaceVideo,
  onRecheckAudio,
  notify,
  onBranchChange,
  onActiveNoteChange,
  onExtractKeyChanges,
  onGenerate,
  onExport,
  onRevealExport,
  onImportTranscript,
  onRecognize,
  onTranslate,
  onCancelTranslation,
  onStartCreation,
  onImportCreation,
  onSaveRevision,
  onSeek,
  onOpenSourceMaterial,
  onStartVideoDocument,
  onCreateAlbum,
}: VideoDocumentWorkspacePaneProps) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const openTranscript = useOpenTranscript(onSeek, onBranchChange);
  const quickInsertNote = useQuickInsertNoteAction(currentTimeMs);
  const visibleBranches = document?.branches.filter(
    (branch) => branch.role === 'CLEAN_TRANSCRIPT' || branch.role === 'ARTICLE',
  );
  if (documentLoading && !document) return <VideoDocumentWorkspaceLoading />;
  if (!document) {
    return (
      <VideoDocumentWorkspaceStart
        labels={labels}
        onStartVideoDocument={onStartVideoDocument}
        onCreateAlbum={onCreateAlbum}
      />
    );
  }
  if (hasNoCreatedContent(document)) {
    return (
      <VideoDocumentEmptyWorkspace
        {...{
          document,
          labels,
          activeBranch,
          revision,
          revisionLoading,
          currentTimeMs,
          timelineSegments,
          title,
          savingTitle,
          sourcePaneOpen,
          seekRequest,
          sourcePaneWidth,
          replacingVideo,
          canRecognize,
          recognizing,
          importingTranscript,
          recognitionProgress,
          recognitionTaskStatus,
          onTitleChange,
          onSaveTitle,
          onMove,
          onOpenSourcePane,
          onCollapseSourcePane,
          onSourcePaneWidthChange,
          onPlaybackTimeChange,
          onPlaybackError,
          onReplaceVideo,
          onRecheckAudio,
          onOpenSourceMaterial,
          onRecognize,
          onBranchChange,
          onSaveRevision,
          onSeek,
          onStartCreation,
          onImportCreation,
        }}
      />
    );
  }
  return (
    <>
      <main className="relative flex min-w-0 flex-1 flex-col">
        <VideoDocumentHeader
          title={title}
          savedTitle={document.title}
          titleLabel={labels.documentTitle}
          albumTitle={document.albumTitle || labels.unfiled}
          saving={savingTitle}
          onTitleChange={onTitleChange}
          onSaveTitle={onSaveTitle}
          onMove={onMove}
        />
        <Tabs
          value={activeBranch}
          onValueChange={(value) => onBranchChange(value as VideoDocumentBranchRole)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="flex h-12 shrink-0 items-end border-b px-6">
            <TabsList className="min-w-0 flex-1 border-b-0">
              {visibleBranches?.map((branch) => (
                <TabsTrigger key={branch.id} value={branch.role}>
                  {labels.branches[branch.role] ?? branch.role}
                </TabsTrigger>
              ))}
            </TabsList>
            <div
              ref={setToolbarTarget}
              data-slot="video-document-toolbar-target"
              className="ml-auto flex h-full min-w-0 shrink-0 items-center justify-end pl-3"
            />
          </div>
          {visibleBranches?.map((branch) => (
            <TabsContent key={branch.id} value={branch.role} className="min-h-0 flex-1 overflow-auto p-8">
              <DocumentBranchPanel
                documentId={document.id}
                documentTitle={document.title}
                sourceVideoUrl={document.source.asset.mediaUrl}
                branch={branch}
                noRevisionLabel={labels.noRevision}
                revisionUnavailableLabel={labels.revisionUnavailable}
                revision={branch.id === selectedBranchId ? revision : null}
                transcriptRevision={branch.role === 'ARTICLE' ? articleTranscriptRevision : null}
                revisionLoading={branch.id === selectedBranchId && revisionLoading}
                keyChangeResult={keyChangeResult}
                keyChangesLoading={keyChangesLoading}
                keyChangesExtracting={keyChangesExtracting}
                generating={generating}
                exportingFormat={branch.id === selectedBranchId ? exportingFormat : null}
                generationError={generationError}
                importingTranscript={importingTranscript && branch.role === 'CLEAN_TRANSCRIPT'}
                recognizing={recognizing}
                translating={translating}
                translationProgress={branch.role === 'CLEAN_TRANSCRIPT' ? translationProgress : null}
                translationCancelling={translationCancelling}
                canRecognize={canRecognize}
                recognitionProgress={branch.role === 'CLEAN_TRANSCRIPT' ? recognitionProgress : null}
                recognitionTaskStatus={branch.role === 'CLEAN_TRANSCRIPT' ? recognitionTaskStatus : null}
                currentTimeMs={currentTimeMs}
                durationMs={document.source.asset.durationMs}
                activeNoteId={activeNoteId}
                timelineSegments={timelineSegments}
                quickInsertNoteRequest={quickInsertNote.request}
                toolbarTarget={toolbarTarget}
                generationHistoryRefreshKey={generationHistoryRefreshKey}
                lastExportPath={lastExport?.branchId === branch.id ? lastExport.outputPath : null}
                notify={notify}
                onExtractKeyChanges={onExtractKeyChanges}
                onGenerate={onGenerate}
                onExport={onExport}
                onRevealExport={onRevealExport}
                onImportTranscript={onImportTranscript}
                onRecognize={onRecognize}
                onTranslate={onTranslate}
                onCancelTranslation={onCancelTranslation}
                onSaveRevision={onSaveRevision}
                onOpenTranscript={openTranscript}
                onActiveNoteChange={onActiveNoteChange}
                onArticleEditingChange={quickInsertNote.onEditingChange}
                onQuickInsertNoteBusyChange={quickInsertNote.setBusy}
                onSeek={onSeek}
              />
            </TabsContent>
          ))}
        </Tabs>
        {!sourcePaneOpen && (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute bottom-2 right-2 z-30 shadow-overlay"
            title={labels.player.expand}
            aria-label={labels.player.expand}
            onClick={onOpenSourcePane}
          >
            <PanelRightOpenIcon className="size-4" />
          </Button>
        )}
      </main>
      {sourcePaneOpen && (
        <VideoDocumentWorkspaceSourcePane
          document={document}
          activeBranch={activeBranch}
          articleEditing={quickInsertNote.editing}
          quickInsertNoteBusy={quickInsertNote.busy}
          seekRequest={seekRequest}
          width={sourcePaneWidth}
          replacingVideo={replacingVideo}
          onWidthChange={onSourcePaneWidthChange}
          onReplaceVideo={onReplaceVideo}
          onRecheckAudio={onRecheckAudio}
          onPlaybackTimeChange={onPlaybackTimeChange}
          onPlaybackError={onPlaybackError}
          onQuickInsertNote={quickInsertNote.requestInsert}
          onOpenMaterial={onOpenSourceMaterial}
          onCollapse={onCollapseSourcePane}
        />
      )}
    </>
  );
}
