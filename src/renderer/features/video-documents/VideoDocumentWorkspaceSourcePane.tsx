import type { VideoDocumentBranchRole, VideoDocumentDto } from '@/shared/contracts';
import { VideoDocumentSourcePane } from '@/renderer/features/video-documents/VideoDocumentSourcePane';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  document: VideoDocumentDto;
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
  onCollapse(): void;
}

export function VideoDocumentWorkspaceSourcePane({
  document,
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
  onCollapse,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  return (
    <VideoDocumentSourcePane
      document={document}
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
      onCollapse={onCollapse}
    />
  );
}
