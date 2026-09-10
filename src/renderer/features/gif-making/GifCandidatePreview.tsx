import { useEffect, useMemo, useState } from 'react';
import { DownloadIcon, PauseIcon, PlayIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { GifCanvas } from '@/renderer/features/gif-making/GifCanvas';
import { GifFrameImage } from '@/renderer/features/gif-making/GifFrameStrip';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { GifGenerationCandidate } from '@/shared/contracts/gif-generation';
import { gifPlaybackFrames } from '@/shared/contracts/gif-making';
export function GifCandidatePreview({ candidate, onError }: { candidate: GifGenerationCandidate; onError(): void }) {
  const labels = useI18n().messages.creator.gifMaker;
  const [playing, setPlaying] = useState(true),
    [index, setIndex] = useState(0);
  const assets = useMemo(() => new Map(candidate.assets.map((a) => [a.id, a])), [candidate.assets]);
  const manifest = candidate.manifest!;
  const sequence = useMemo(() => gifPlaybackFrames(manifest), [manifest]);
  const frame = sequence[index % sequence.length];
  const uniqueFrames = manifest.frames.filter(
    (item, i, items) =>
      items.findIndex(
        (other) =>
          other.assetId === item.assetId && JSON.stringify(other.sourceRect) === JSON.stringify(item.sourceRect),
      ) === i,
  );
  useEffect(() => {
    if (!playing || !frame) return;
    const timer = setTimeout(() => {
      if (index + 1 >= sequence.length && manifest.loop === 'ONCE') setPlaying(false);
      else setIndex((value) => (value + 1) % sequence.length);
    }, frame.durationMs);
    return () => clearTimeout(timer);
  }, [frame, index, sequence.length, manifest.loop, playing]);
  if (!frame) return null;
  return (
    <div className="min-w-0 space-y-2" aria-label={labels.generation.candidate}>
      <div className="flex h-[clamp(240px,48vh,560px)] items-center justify-center overflow-hidden bg-muted/40 p-2">
        <GifCanvas
          manifest={manifest}
          frame={frame}
          assets={assets}
          label={labels.generation.candidate}
          onError={onError}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={playing ? labels.pause : labels.play}
          onClick={() => {
            if (!playing && index + 1 >= sequence.length) setIndex(0);
            setPlaying((value) => !value);
          }}
        >
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={labels.generation.saveFrame}
          onClick={() => void window.desktopApi.assetFileSaveAs(frame.assetId).catch(onError)}
        >
          <DownloadIcon className="size-4" />
        </Button>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {index + 1} / {sequence.length} ·{' '}
          {(sequence.reduce((sum, item) => sum + item.durationMs, 0) / 1000).toFixed(2)} s
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label={labels.sequence}>
        {uniqueFrames.map((item, i) => (
          <Button
            key={item.id}
            size="sm"
            variant={
              frame.assetId === item.assetId && JSON.stringify(frame.sourceRect) === JSON.stringify(item.sourceRect)
                ? 'secondary'
                : 'ghost'
            }
            className="h-auto shrink-0 flex-col gap-1 px-1 py-1"
            aria-label={`${labels.frame} ${i + 1}`}
            onClick={() => {
              setPlaying(false);
              setIndex(sequence.findIndex((current) => current.id === item.id));
            }}
          >
            <span className="block h-12 w-14 overflow-hidden">
              <GifFrameImage frame={item} asset={assets.get(item.assetId)} />
            </span>
            {i + 1}
          </Button>
        ))}
      </div>
    </div>
  );
}
