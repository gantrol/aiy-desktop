import { Pause, Play } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { GifCanvas } from '@/renderer/features/gif-making/GifCanvas';
import { GifFrameStrip } from '@/renderer/features/gif-making/GifFrameStrip';
import { GifAdoptButton } from '@/renderer/features/gif-making/GifAdoptButton';
import { useI18n } from '@/renderer/i18n/useI18n';
import { demoNoop } from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
import { demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import {
  demoFrameImageUrl,
  demoSmileAssets,
  demoSmileDuration,
  demoSmileIndex,
  demoSmileManifest,
} from '@/renderer/features/extensions/feature-demo/v050/demoSmileData';

/** Real GIF components render supplied frames; their clock belongs to the demo, not a timer or animated img. */
export function DemoSmileResult({ time, onError }: { time: number; onError(): void }) {
  const { messages } = useI18n();
  const labels = messages.creator.gifMaker;
  const frame = demoSmileManifest.frames[demoSmileIndex(time)];
  const playing = time >= demoCues.motionPlay && time < demoCues.motionHold;
  return (
    <div className="absolute inset-0 flex min-h-0 flex-col gap-3 bg-background p-6">
      <div data-demo-smile-canvas className="flex min-h-0 flex-1 items-center justify-center bg-muted/40">
        <GifCanvas
          manifest={demoSmileManifest}
          frame={frame}
          assets={demoSmileAssets}
          label={messages.extensions.featureDemo.v050.smileTitle}
          onError={onError}
        />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          data-demo-smile-play
          size="icon-sm"
          variant="outline"
          aria-label={playing ? labels.pause : labels.play}
          onClick={demoNoop}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {demoSmileIndex(time) + 1} / {demoSmileManifest.frames.length} · {demoSmileDuration} ms · 1024 × 1536
        </span>
        <div className="ml-auto">
          <GifAdoptButton disabled={false} alreadyAdopted={false} hasEditor={false} onAdopt={demoNoop} />
        </div>
      </div>
      <GifFrameStrip
        frames={demoSmileManifest.frames}
        selectedId={frame.id}
        assets={demoSmileAssets}
        imageUrl={demoFrameImageUrl}
        onSelect={demoNoop}
        onMove={demoNoop}
      />
    </div>
  );
}
