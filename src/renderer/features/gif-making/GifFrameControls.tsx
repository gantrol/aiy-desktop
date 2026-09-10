import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, PauseIcon, PlayIcon, ScissorsIcon, XIcon } from 'lucide-react';
import { GIF_MAX_FRAMES } from '@/shared/contracts/gif-making';
import { Button } from '@/renderer/components/ui/button';
import { GifNumber } from '@/renderer/features/gif-making/GifSettings';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
export function GifFrameControls({ model }: { model: GifMakerModel }) {
  const {
    labels,
    change,
    manifest,
    selected,
    selectedIndex,
    selectedAsset,
    playing,
    setPlaying,
    setPlayIndex,
    setSheet,
    setShowEncoded,
    sequence,
    busy,
    select,
    move,
  } = model;
  return (
    <div className="flex flex-wrap items-end gap-2 pt-2">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={labels.previous}
        disabled={!selected || busy}
        onClick={() => select(manifest.frames[Math.max(0, selectedIndex - 1)].id)}
      >
        <ChevronLeftIcon className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="secondary"
        aria-label={playing ? labels.pause : labels.play}
        data-action="gif-toggle-playback"
        aria-pressed={playing}
        disabled={sequence.length < 2 || busy}
        onClick={() => {
          setShowEncoded(false);
          setPlayIndex(
            Math.max(
              0,
              sequence.findIndex((frame) => frame.id === selected?.id),
            ),
          );
          setPlaying((value) => !value);
        }}
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={labels.next}
        disabled={!selected || busy}
        onClick={() => select(manifest.frames[Math.min(manifest.frames.length - 1, selectedIndex + 1)].id)}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
      {selected && (
        <>
          <div className="w-28">
            <GifNumber
              label={labels.duration}
              id="gif-frame-duration"
              value={selected.durationMs}
              min={20}
              max={60_000}
              step={10}
              onChange={(durationMs) =>
                change((value) => ({
                  ...value,
                  frames: value.frames.map((frame) => (frame.id === selected.id ? { ...frame, durationMs } : frame)),
                }))
              }
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              change((value) => ({
                ...value,
                frames: value.frames.map((frame) => ({ ...frame, durationMs: selected.durationMs })),
              }))
            }
          >
            {labels.applyAll}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={labels.duplicate}
            data-action="gif-duplicate-frame"
            disabled={manifest.frames.length >= GIF_MAX_FRAMES}
            onClick={() => {
              const copy = { ...selected, id: crypto.randomUUID() };
              change((value) => ({
                ...value,
                frames: [...value.frames.slice(0, selectedIndex + 1), copy, ...value.frames.slice(selectedIndex + 1)],
              }));
              select(copy.id);
            }}
          >
            <CopyIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={labels.remove}
            data-action="gif-remove-frame"
            onClick={() => {
              change((value) => ({
                ...value,
                frames: value.frames.filter((frame) => frame.id !== selected.id),
              }));
              setPlaying(false);
            }}
          >
            <XIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={selectedIndex < 1}
            data-action="gif-move-earlier"
            onClick={() => move(selected.id, manifest.frames[selectedIndex - 1].id)}
          >
            {labels.earlier}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={selectedIndex >= manifest.frames.length - 1}
            data-action="gif-move-later"
            onClick={() => move(selected.id, manifest.frames[selectedIndex + 1].id)}
          >
            {labels.later}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPlaying(false);
              change((value) => ({ ...value, frames: [...value.frames].reverse() }));
            }}
          >
            {labels.reverse}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={labels.split}
            data-action="gif-split-sheet"
            disabled={!selectedAsset}
            onClick={() => setSheet(true)}
          >
            <ScissorsIcon className="size-4" />
          </Button>
        </>
      )}
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {manifest.frames.length} {labels.frames} ·{' '}
        {(sequence.reduce((sum, frame) => sum + frame.durationMs, 0) / 1000).toFixed(2)} s
      </span>
    </div>
  );
}
