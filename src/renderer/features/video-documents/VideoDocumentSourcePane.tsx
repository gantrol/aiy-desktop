import {
  ExternalLinkIcon,
  FileUpIcon,
  LoaderCircleIcon,
  NotebookPenIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { VideoDocumentDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
  VideoDocumentPlayerControls,
  formatVideoDocumentTime,
  type VideoDocumentPlayerLabels,
} from '@/renderer/features/video-documents/VideoDocumentPlayerControls';
import { useVideoDocumentPlayer } from '@/renderer/features/video-documents/useVideoDocumentPlayer';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export type VideoDocumentAudioStatus = 'HAS_AUDIO' | 'NO_AUDIO' | 'DETECTION_FAILED';

export interface VideoDocumentAudioInfo {
  status: VideoDocumentAudioStatus;
  trackCount?: number;
  primaryCodec?: string | null;
}

export interface VideoDocumentSourcePaneLabels {
  sourceVideo?: string;
  sourceUnavailable?: string;
  openSourceMaterial?: string;
  collapse?: string;
  resize?: string;
  replaceVideo?: string;
  replacingVideo?: string;
  recheckAudio?: string;
  quickInsertNote?: string;
  audioStatus?: Partial<Record<VideoDocumentAudioStatus, string>>;
  player?: Partial<VideoDocumentPlayerLabels>;
}

interface Props {
  document: VideoDocumentDto;
  seekRequest: { timestampMs: number; revision: number } | null;
  labels?: VideoDocumentSourcePaneLabels;
  audioInfo?: VideoDocumentAudioInfo;
  width?: number;
  replacingVideo?: boolean;
  quickInsertNoteBusy?: boolean;
  onWidthChange?(width: number): void;
  onReplaceVideo?(): void;
  onRecheckAudio?(): void;
  onQuickInsertNote?(): void;
  onPlaybackTimeChange?(timestampMs: number): void;
  onPlaybackStateChange?(playing: boolean): void;
  onPlaybackError?(error: unknown): void;
  onOpenMaterial(materialId: string): void;
  onCollapse(): void;
}

interface LegacySourcePaneLabels {
  sourceVideo: string;
  sourceUnavailable: string;
  openSourceMaterial: string;
  player: Pick<VideoDocumentPlayerLabels, 'backTen' | 'forwardTen' | 'speed'> & {
    collapse: string;
    replaceVideo?: string;
    replacingVideo?: string;
    quickInsertNote?: string;
    controls?: Partial<VideoDocumentPlayerLabels>;
  };
}

interface ResolvedSourcePaneLabels {
  sourceVideo: string;
  sourceUnavailable: string;
  openSourceMaterial: string;
  collapse: string;
  resize?: string;
  replaceVideo?: string;
  replacingVideo?: string;
  recheckAudio?: string;
  quickInsertNote: string;
  audioStatus?: Partial<Record<VideoDocumentAudioStatus, string>>;
  player: VideoDocumentPlayerLabels;
}

const MINIMUM_WIDTH = 320;
const MAXIMUM_WIDTH = 720;
const DEFAULT_WIDTH = 420;

function clampPaneWidth(width: number) {
  return Math.min(MAXIMUM_WIDTH, Math.max(MINIMUM_WIDTH, Math.round(width)));
}

function firstDefinedLabel(...values: Array<string | undefined>) {
  return values.find((value): value is string => value !== undefined) ?? '';
}

function resolvePlayerLabels(
  supplied: Partial<VideoDocumentPlayerLabels> | undefined,
  fallback: LegacySourcePaneLabels['player'],
): VideoDocumentPlayerLabels {
  const controls = fallback.controls;
  return {
    play: firstDefinedLabel(supplied?.play, controls?.play),
    pause: firstDefinedLabel(supplied?.pause, controls?.pause),
    seek: firstDefinedLabel(supplied?.seek, controls?.seek),
    backTen: firstDefinedLabel(supplied?.backTen, controls?.backTen, fallback.backTen),
    forwardTen: firstDefinedLabel(supplied?.forwardTen, controls?.forwardTen, fallback.forwardTen),
    mute: firstDefinedLabel(supplied?.mute, controls?.mute),
    unmute: firstDefinedLabel(supplied?.unmute, controls?.unmute),
    volume: firstDefinedLabel(supplied?.volume, controls?.volume),
    speed: firstDefinedLabel(supplied?.speed, controls?.speed, fallback.speed),
    pictureInPicture: firstDefinedLabel(supplied?.pictureInPicture, controls?.pictureInPicture),
    enterFullscreen: firstDefinedLabel(supplied?.enterFullscreen, controls?.enterFullscreen),
    exitFullscreen: firstDefinedLabel(supplied?.exitFullscreen, controls?.exitFullscreen),
  };
}

function resolveLabels(
  supplied: VideoDocumentSourcePaneLabels | undefined,
  fallback: LegacySourcePaneLabels,
): ResolvedSourcePaneLabels {
  return {
    sourceVideo: supplied?.sourceVideo ?? fallback.sourceVideo,
    sourceUnavailable: supplied?.sourceUnavailable ?? fallback.sourceUnavailable,
    openSourceMaterial: supplied?.openSourceMaterial ?? fallback.openSourceMaterial,
    collapse: supplied?.collapse ?? fallback.player.collapse,
    resize: supplied?.resize,
    replaceVideo: supplied?.replaceVideo ?? fallback.player.replaceVideo,
    replacingVideo: supplied?.replacingVideo ?? fallback.player.replacingVideo,
    recheckAudio: supplied?.recheckAudio,
    quickInsertNote: supplied?.quickInsertNote ?? fallback.player.quickInsertNote ?? '',
    audioStatus: supplied?.audioStatus,
    player: resolvePlayerLabels(supplied?.player, fallback.player),
  };
}

function usePaneWidth(width: number | undefined, onWidthChange: ((width: number) => void) | undefined) {
  const [internalWidth, setInternalWidth] = useState(DEFAULT_WIDTH);
  const paneWidth = clampPaneWidth(width ?? internalWidth);
  const updateWidth = useCallback(
    (nextWidth: number) => {
      const normalized = clampPaneWidth(nextWidth);
      if (width === undefined) setInternalWidth(normalized);
      onWidthChange?.(normalized);
    },
    [onWidthChange, width],
  );
  return { paneWidth, updateWidth };
}

function useSeekRequest(
  videoRef: ReturnType<typeof useVideoDocumentPlayer>['videoRef'],
  seekToMs: (timestampMs: number) => void,
  seekRequest: Props['seekRequest'],
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !seekRequest) return undefined;
    const seek = () => seekToMs(seekRequest.timestampMs);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [seekRequest, seekToMs, videoRef]);
}

interface ResizeHandleProps {
  width: number;
  label?: string;
  onWidthChange(width: number): void;
}

function VideoDocumentPaneResizeHandle({ width, label, onWidthChange }: ResizeHandleProps) {
  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const onPointerMove = (moveEvent: PointerEvent) => onWidthChange(width + startX - moveEvent.clientX);
    const stopResize = () => {
      globalThis.document.removeEventListener('pointermove', onPointerMove);
      globalThis.document.removeEventListener('pointerup', stopResize);
      globalThis.document.removeEventListener('pointercancel', stopResize);
    };
    globalThis.document.addEventListener('pointermove', onPointerMove);
    globalThis.document.addEventListener('pointerup', stopResize);
    globalThis.document.addEventListener('pointercancel', stopResize);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={MINIMUM_WIDTH}
      aria-valuemax={MAXIMUM_WIDTH}
      aria-valuenow={width}
      className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-border focus-visible:after:bg-ring"
      onPointerDown={beginResize}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onWidthChange(width + 16);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onWidthChange(width - 16);
        }
      }}
    />
  );
}

interface SourcePaneHeaderProps {
  labels: ResolvedSourcePaneLabels;
}

function SourcePaneHeader({ labels }: SourcePaneHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center border-b px-4 text-sm font-semibold">
      <span>{labels.sourceVideo}</span>
    </header>
  );
}

interface SourcePaneBodyProps {
  videoDocument: VideoDocumentDto;
  labels: ResolvedSourcePaneLabels;
  player: ReturnType<typeof useVideoDocumentPlayer>;
  audioInfo: VideoDocumentAudioInfo | undefined;
  audioEnabled: boolean;
  replacingVideo: boolean;
  quickInsertNoteBusy: boolean;
  onReplaceVideo?: () => void;
  onRecheckAudio?: () => void;
  onQuickInsertNote?: () => void;
  onOpenMaterial(materialId: string): void;
}

function SourcePaneBody({
  videoDocument,
  labels,
  player,
  audioInfo,
  audioEnabled,
  replacingVideo,
  quickInsertNoteBusy,
  onReplaceVideo,
  onRecheckAudio,
  onQuickInsertNote,
  onOpenMaterial,
}: SourcePaneBodyProps) {
  const audioStatusLabel = audioInfo ? labels.audioStatus?.[audioInfo.status] : undefined;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-14">
      {videoDocument.source.available ? (
        <div
          ref={player.playerRef}
          data-slot="video-document-player"
          className={cn(
            'overflow-hidden rounded-lg border bg-media-surround-dark',
            player.state.fullscreen && 'flex h-screen w-screen flex-col rounded-none border-0',
            player.state.fallbackFullscreen &&
              'fixed inset-0 z-[2147483647] m-0 h-dvh w-dvw max-w-none rounded-none border-0',
          )}
        >
          <video
            ref={player.videoRef}
            className={cn(
              'aspect-video w-full bg-media-surround-dark object-contain',
              player.state.fullscreen && 'min-h-0 flex-1 basis-0',
            )}
            src={videoDocument.source.asset.mediaUrl}
            preload="metadata"
            playsInline
            muted={player.state.muted}
            tabIndex={0}
            onDoubleClick={() => void player.actions.toggleFullscreen()}
            {...player.videoEvents}
          />
          <VideoDocumentPlayerControls
            labels={labels.player}
            {...player.state}
            audioEnabled={audioEnabled}
            onTogglePlayback={() => void player.actions.togglePlayback()}
            onSeek={player.actions.seekToMs}
            onJump={player.actions.jumpBySeconds}
            onToggleMuted={player.actions.toggleMuted}
            onVolumeChange={player.actions.setVolume}
            onPlaybackRateChange={player.actions.setPlaybackRate}
            onTogglePictureInPicture={() => void player.actions.togglePictureInPicture()}
            onToggleFullscreen={() => void player.actions.toggleFullscreen()}
          />
        </div>
      ) : (
        <div className="grid aspect-video w-full place-items-center rounded-lg border bg-surface-sunken text-sm text-muted-foreground">
          {labels.sourceUnavailable}
        </div>
      )}
      {onQuickInsertNote && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          disabled={quickInsertNoteBusy || !videoDocument.source.available}
          onClick={onQuickInsertNote}
        >
          {quickInsertNoteBusy ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <NotebookPenIcon className="size-4" />
          )}
          {labels.quickInsertNote}
        </Button>
      )}
      <div className="mt-3 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <strong className="min-w-0 flex-1 truncate text-sm">
            {videoDocument.source.displayName || videoDocument.title}
          </strong>
          {audioStatusLabel && <Badge variant="outline">{audioStatusLabel}</Badge>}
          {onRecheckAudio && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={labels.recheckAudio}
              onClick={onRecheckAudio}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
          )}
        </div>
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatVideoDocumentTime(videoDocument.source.asset.durationMs)} · {videoDocument.source.asset.width}×
          {videoDocument.source.asset.height}
          {audioInfo?.primaryCodec ? ` · ${audioInfo.primaryCodec}` : ''}
        </span>
      </div>
      <div className={cn('mt-4 grid gap-2', onReplaceVideo && 'grid-cols-2')}>
        {onReplaceVideo && (
          <Button type="button" variant="outline" size="sm" disabled={replacingVideo} onClick={onReplaceVideo}>
            {replacingVideo ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />}
            {replacingVideo ? labels.replacingVideo : labels.replaceVideo}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onOpenMaterial(videoDocument.source.materialId)}
        >
          <ExternalLinkIcon className="size-4" />
          {labels.openSourceMaterial}
        </Button>
      </div>
    </div>
  );
}

export function VideoDocumentSourcePane({
  document,
  seekRequest,
  labels: suppliedLabels,
  audioInfo,
  width,
  replacingVideo = false,
  quickInsertNoteBusy = false,
  onWidthChange,
  onReplaceVideo,
  onRecheckAudio,
  onQuickInsertNote,
  onPlaybackTimeChange,
  onPlaybackStateChange,
  onPlaybackError,
  onOpenMaterial,
  onCollapse,
}: Props) {
  const { messages } = useI18n();
  const labels = resolveLabels(suppliedLabels, messages.videoDocuments);
  const { paneWidth, updateWidth } = usePaneWidth(width, onWidthChange);
  const resolvedAudioInfo = audioInfo ?? document.source.audio;
  const audioEnabled = document.source.available && resolvedAudioInfo?.status !== 'NO_AUDIO';
  const player = useVideoDocumentPlayer({
    sourceId: document.source.asset.id,
    fallbackDurationMs: document.source.asset.durationMs,
    audioEnabled,
    enabled: document.source.available,
    onPlaybackTimeChange,
    onPlaybackStateChange,
    onPlaybackError,
  });
  useSeekRequest(player.videoRef, player.actions.seekToMs, seekRequest);

  return (
    <aside
      className="relative flex min-h-0 shrink-0 flex-col border-l bg-surface"
      style={{ width: paneWidth, minWidth: MINIMUM_WIDTH, maxWidth: MAXIMUM_WIDTH }}
      data-slot="video-document-source-pane"
      data-audio-status={resolvedAudioInfo?.status}
    >
      <VideoDocumentPaneResizeHandle width={paneWidth} label={labels.resize} onWidthChange={updateWidth} />
      <SourcePaneHeader labels={labels} />
      <SourcePaneBody
        videoDocument={document}
        labels={labels}
        player={player}
        audioInfo={resolvedAudioInfo}
        audioEnabled={audioEnabled}
        replacingVideo={replacingVideo}
        quickInsertNoteBusy={quickInsertNoteBusy}
        onReplaceVideo={onReplaceVideo}
        onRecheckAudio={onRecheckAudio}
        onQuickInsertNote={onQuickInsertNote}
        onOpenMaterial={onOpenMaterial}
      />
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="absolute bottom-2 right-2 z-30 shadow-overlay"
        title={labels.collapse}
        aria-label={labels.collapse}
        onClick={onCollapse}
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
    </aside>
  );
}
