import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { DEMO_DURATION } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';

interface Props {
  ready: boolean;
  playing: boolean;
  fullscreen?: boolean;
  time: number;
  onToggle(): void;
  onReplay(): void;
  onSeek(time: number): void;
  onFullscreen(): void;
}

export function DemoPlaybackControls({
  ready,
  playing,
  fullscreen = false,
  time,
  onToggle,
  onReplay,
  onSeek,
  onFullscreen,
}: Props) {
  const { messages } = useI18n();
  const copy = messages.extensions.featureDemo;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={!ready} onClick={onToggle}>
        {playing ? <Pause /> : <Play />}
        {playing ? copy.pause : copy.play}
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={copy.replay} disabled={!ready} onClick={onReplay}>
        <RotateCcw />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={copy.v050.seekBackward}
        disabled={!ready || time === 0}
        onClick={() => onSeek(Math.max(0, time - 5))}
      >
        <ChevronLeft />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={copy.v050.seekForward}
        disabled={!ready || time >= DEMO_DURATION}
        onClick={() => onSeek(Math.min(DEMO_DURATION, time + 5))}
      >
        <ChevronRight />
      </Button>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {time.toFixed(2)} / {DEMO_DURATION.toFixed(2)}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={
          fullscreen
            ? messages.extensions.transitionShowcase.exitFullscreen
            : messages.extensions.transitionShowcase.enterFullscreen
        }
        title={
          fullscreen
            ? messages.extensions.transitionShowcase.exitFullscreen
            : messages.extensions.transitionShowcase.enterFullscreen
        }
        aria-pressed={fullscreen}
        onClick={onFullscreen}
      >
        {fullscreen ? <Minimize2 /> : <Maximize2 />}
      </Button>
    </div>
  );
}
