import {
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';

export interface VideoDocumentPlayerLabels {
  play: string;
  pause: string;
  seek: string;
  backTen: string;
  forwardTen: string;
  mute: string;
  unmute: string;
  volume: string;
  speed: string;
  pictureInPicture: string;
  enterFullscreen: string;
  exitFullscreen: string;
}

interface Props {
  labels: VideoDocumentPlayerLabels;
  playing: boolean;
  currentTimeMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  audioEnabled: boolean;
  canPictureInPicture: boolean;
  pictureInPicture: boolean;
  fullscreen: boolean;
  onTogglePlayback(): void;
  onSeek(timestampMs: number): void;
  onJump(seconds: number): void;
  onToggleMuted(): void;
  onVolumeChange(volume: number): void;
  onPlaybackRateChange(rate: number): void;
  onTogglePictureInPicture(): void;
  onToggleFullscreen(): void;
}

export function formatVideoDocumentTime(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function VideoDocumentPlayerControls({
  labels,
  playing,
  currentTimeMs,
  durationMs,
  volume,
  muted,
  playbackRate,
  audioEnabled,
  canPictureInPicture,
  pictureInPicture,
  fullscreen,
  onTogglePlayback,
  onSeek,
  onJump,
  onToggleMuted,
  onVolumeChange,
  onPlaybackRateChange,
  onTogglePictureInPicture,
  onToggleFullscreen,
}: Props) {
  const safeDurationMs = Math.max(0, durationMs);
  const safeCurrentTimeMs = Math.min(Math.max(0, currentTimeMs), safeDurationMs || currentTimeMs);

  return (
    <div className="space-y-2 border-t border-media-checker-a/10 bg-media-surround-dark px-2.5 py-2 text-media-checker-a">
      <Slider
        min={0}
        max={Math.max(1, safeDurationMs)}
        step={100}
        value={[safeCurrentTimeMs]}
        disabled={safeDurationMs <= 0}
        aria-label={labels.seek}
        aria-valuetext={formatVideoDocumentTime(safeCurrentTimeMs)}
        className="[&_[data-slot=slider-range]]:bg-media-checker-a [&_[data-slot=slider-thumb]]:border-media-checker-a [&_[data-slot=slider-thumb]]:bg-media-checker-a [&_[data-slot=slider-track]]:bg-media-checker-a/25"
        onValueChange={(value) => onSeek(value[0] ?? 0)}
      />
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-media-checker-a hover:bg-media-checker-a/15"
            aria-label={playing ? labels.pause : labels.play}
            onClick={onTogglePlayback}
          >
            {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-media-checker-a hover:bg-media-checker-a/15"
            aria-label={labels.backTen}
            onClick={() => onJump(-10)}
          >
            <RotateCcwIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-media-checker-a hover:bg-media-checker-a/15"
            aria-label={labels.forwardTen}
            onClick={() => onJump(10)}
          >
            <RotateCwIcon className="size-4" />
          </Button>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-media-checker-a/80">
            {formatVideoDocumentTime(safeCurrentTimeMs)} / {formatVideoDocumentTime(safeDurationMs)}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-media-checker-a hover:bg-media-checker-a/15"
            aria-label={muted ? labels.unmute : labels.mute}
            disabled={!audioEnabled}
            onClick={onToggleMuted}
          >
            {muted || !audioEnabled ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
          </Button>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[muted ? 0 : volume]}
            disabled={!audioEnabled}
            aria-label={labels.volume}
            className="w-16 [&_[data-slot=slider-range]]:bg-media-checker-a [&_[data-slot=slider-thumb]]:border-media-checker-a [&_[data-slot=slider-thumb]]:bg-media-checker-a [&_[data-slot=slider-track]]:bg-media-checker-a/25"
            onValueChange={(value) => onVolumeChange(value[0] ?? 0)}
          />
          <select
            value={playbackRate}
            className="ml-auto h-8 rounded-md border border-media-checker-a/15 bg-media-checker-a/10 px-1.5 text-xs text-media-checker-a outline-none focus-visible:ring-2 focus-visible:ring-media-checker-a"
            aria-label={labels.speed}
            onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          >
            {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <option key={rate} value={rate} className="text-foreground">
                {rate}×
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-media-checker-a hover:bg-media-checker-a/15"
            aria-label={labels.pictureInPicture}
            aria-pressed={pictureInPicture}
            disabled={!canPictureInPicture}
            onClick={onTogglePictureInPicture}
          >
            <PictureInPicture2Icon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-media-checker-a hover:bg-media-checker-a/15"
            aria-label={fullscreen ? labels.exitFullscreen : labels.enterFullscreen}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? <MinimizeIcon className="size-4" /> : <MaximizeIcon className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
