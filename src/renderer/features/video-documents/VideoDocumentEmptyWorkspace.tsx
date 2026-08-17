import { PanelRightOpenIcon } from 'lucide-react';
import type {
  VideoDocumentBranchRole,
  VideoDocumentDto,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentTimelineSegment,
  VideoDocumentTranscriptBackgroundTaskStatus,
  VideoDocumentTranscriptRecognitionProgress,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import {
  VideoDocumentEmptyCreation,
  type VideoDocumentEmptyCreationSelection,
} from '@/renderer/features/video-documents/VideoDocumentEmptyCreation';
import { VideoDocumentHeader } from '@/renderer/features/video-documents/VideoDocumentHeader';
import { VideoDocumentSourcePane } from '@/renderer/features/video-documents/VideoDocumentSourcePane';
import { useI18n } from '@/renderer/i18n/useI18n';

type VideoDocumentLabels = ReturnType<typeof useI18n>['messages']['videoDocuments'];

interface Props {
  document: VideoDocumentDto;
  labels: VideoDocumentLabels;
  activeBranch: VideoDocumentBranchRole;
  revision: VideoDocumentRevisionDto | null;
  revisionLoading: boolean;
  currentTimeMs: number;
  timelineSegments: VideoDocumentTimelineSegment[];
  title: string;
  savingTitle: boolean;
  sourcePaneOpen: boolean;
  seekRequest: { timestampMs: number; revision: number } | null;
  sourcePaneWidth: number;
  replacingVideo: boolean;
  canRecognize: boolean;
  recognizing: boolean;
  importingTranscript: boolean;
  recognitionProgress: VideoDocumentTranscriptRecognitionProgress | null;
  recognitionTaskStatus: VideoDocumentTranscriptBackgroundTaskStatus | null;
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
  onOpenSourceMaterial(materialId: string): void;
  onRecognize(): void;
  onBranchChange(role: VideoDocumentBranchRole): void;
  onSaveRevision(content: VideoDocumentRevisionContent): Promise<void>;
  onSeek(timestampMs: number): void;
  onStartCreation(selection: VideoDocumentEmptyCreationSelection): Promise<void>;
  onImportCreation(selection: VideoDocumentEmptyCreationSelection): Promise<void>;
}

export function VideoDocumentEmptyWorkspace({
  document,
  labels,
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
  onStartCreation,
  onImportCreation,
}: Props) {
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
        <Tabs value="CREATION" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex h-12 shrink-0 items-end border-b px-6">
            <TabsList className="min-w-0 flex-1 border-b-0">
              <TabsTrigger value="CREATION">{labels.creation.title}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="CREATION" className="min-h-0 flex-1 overflow-auto">
            <VideoDocumentEmptyCreation
              documentId={document.id}
              hasAudio={document.source.audio.status === 'HAS_AUDIO'}
              canRecognize={canRecognize}
              recognizing={recognizing}
              importingTranscript={importingTranscript}
              progress={recognitionProgress}
              taskStatus={recognitionTaskStatus}
              onStart={onStartCreation}
              onOpenProgress={onRecognize}
              onImportTranscript={onImportCreation}
            />
          </TabsContent>
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
        <VideoDocumentSourcePane
          document={document}
          seekRequest={seekRequest}
          width={sourcePaneWidth}
          labels={{
            resize: labels.player.resize,
            replaceVideo: labels.player.replaceVideo,
            replacingVideo: labels.player.replacingVideo,
            recheckAudio: labels.player.recheckAudio,
            audioStatus: labels.player.audioStatus,
            player: labels.player.controls,
          }}
          onWidthChange={onSourcePaneWidthChange}
          replacingVideo={replacingVideo}
          onReplaceVideo={onReplaceVideo}
          onRecheckAudio={onRecheckAudio}
          onPlaybackTimeChange={onPlaybackTimeChange}
          onPlaybackError={onPlaybackError}
          onOpenMaterial={onOpenSourceMaterial}
          onCollapse={onCollapseSourcePane}
        />
      )}
    </>
  );
}
