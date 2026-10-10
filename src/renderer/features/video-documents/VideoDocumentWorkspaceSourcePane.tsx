import type { VideoDocumentBranchRole, VideoDocumentDto } from '@/shared/contracts';
import type { Ref } from 'react';
import { VideoDocumentSourcePane } from '@/renderer/features/video-documents/VideoDocumentSourcePane';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  document: VideoDocumentDto;
  open: boolean;
  contentId: string;
  docked: boolean;
  toggleRef: Ref<HTMLButtonElement>;
  activeBranch: VideoDocumentBranchRole;
  articleEditing: boolean;
  quickInsertNoteBusy: boolean;
  seekRequest: { timestampMs: number; revision: number } | null;
  width: number;
  replacingVideo: boolean;
  onWidthChange(width: number): void;
  onReplaceVideo(): void;
  onRecheckAudio(): void;
  onPlaybackTimeChange(timestampMs: number): void;
  onPlaybackError(error: unknown): void;
  onQuickInsertNote(): void;
  onOpenMaterial(materialId: string): void;
  onOpenChange(open: boolean): void;
}

export function VideoDocumentWorkspaceSourcePane({
  document,
  open,
  contentId,
  docked,
  toggleRef,
  activeBranch,
  articleEditing,
  quickInsertNoteBusy,
  seekRequest,
  width,
  replacingVideo,
  onWidthChange,
  onReplaceVideo,
  onRecheckAudio,
  onPlaybackTimeChange,
  onPlaybackError,
  onQuickInsertNote,
  onOpenMaterial,
  onOpenChange,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  return (
    <VideoDocumentSourcePane
      document={document}
      open={open}
      contentId={contentId}
      docked={docked}
      toggleRef={toggleRef}
      seekRequest={seekRequest}
      width={width}
      labels={{
        resize: labels.player.resize,
        replaceVideo: labels.player.replaceVideo,
        replacingVideo: labels.player.replacingVideo,
        recheckAudio: labels.player.recheckAudio,
        quickInsertNote: labels.player.quickInsertNote,
        audioStatus: labels.player.audioStatus,
        player: labels.player.controls,
      }}
      replacingVideo={replacingVideo}
      quickInsertNoteBusy={quickInsertNoteBusy}
      onWidthChange={onWidthChange}
      onReplaceVideo={onReplaceVideo}
      onRecheckAudio={onRecheckAudio}
      onPlaybackTimeChange={onPlaybackTimeChange}
      onPlaybackError={onPlaybackError}
      onQuickInsertNote={articleEditing && activeBranch === 'ARTICLE' ? onQuickInsertNote : undefined}
      onOpenMaterial={onOpenMaterial}
      onOpenChange={onOpenChange}
    />
  );
}
