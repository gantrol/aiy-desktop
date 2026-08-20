import { useMemo, useState } from 'react';
import type { GenerationRunDto } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { AssetHoverPreview } from '@/renderer/components/creator/AssetHoverPreview';

type PairSlot = 'A' | 'B';

interface Labels {
  images: string;
  viewAllImages: string;
}

interface Props {
  runs: GenerationRunDto[];
  seriesId: string;
  pairSelecting: boolean;
  contextLabel: string;
  labels: Labels;
  repeatOrdinalOffset?: number;
  pairSlotFor(runId: string): PairSlot | null;
  onSelect(assetId: string): void;
  onPairSelect(runId: string): void;
  notify(message: string): void;
}

interface SuccessfulRun {
  run: GenerationRunDto & { asset: NonNullable<GenerationRunDto['asset']> };
  repeatIndex: number;
}

const stackFrame = { maxWidth: 164, maxHeight: 168 };

function fittedFrame(width: number, height: number) {
  const safeWidth = width > 0 ? width : 1;
  const safeHeight = height > 0 ? height : 1;
  const ratio = safeWidth / safeHeight;
  const frameRatio = stackFrame.maxWidth / stackFrame.maxHeight;

  return ratio >= frameRatio
    ? { width: stackFrame.maxWidth, height: stackFrame.maxWidth / ratio }
    : { width: stackFrame.maxHeight * ratio, height: stackFrame.maxHeight };
}

export function ComparisonResultStack({
  runs,
  seriesId,
  pairSelecting,
  contextLabel,
  labels,
  repeatOrdinalOffset = 0,
  pairSlotFor,
  onSelect,
  onPairSelect,
  notify,
}: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const successes = useMemo(
    () =>
      runs
        .flatMap((run, repeatIndex): SuccessfulRun[] =>
          run.asset ? [{ run: run as SuccessfulRun['run'], repeatIndex }] : [],
        )
        .reverse(),
    [runs],
  );
  const visible = successes.slice(0, 3);
  const cover = visible[0];
  const popoverHeight = Math.min(22, Math.ceil(successes.length / 3) * 7.5);

  if (!cover) return null;

  function select(item: SuccessfulRun) {
    if (pairSelecting) onPairSelect(item.run.id);
    else onSelect(item.run.asset.id);
    setOpen(false);
  }

  const fanned = expanded || open;
  const stepX = fanned ? 24 : 10;
  const stepY = fanned ? 2 : 4;
  const centerX = ((visible.length - 1) * stepX) / 2;
  const centerY = ((visible.length - 1) * stepY) / 2;
  return (
    <div className="flex h-48 items-center justify-center overflow-hidden">
      <div
        data-comparison-result-stack
        data-image-count={successes.length}
        role="group"
        aria-label={labels.images}
        className="relative h-44 w-52 shrink-0"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => {
          setExpanded(false);
          setActiveRunId(null);
        }}
        onFocusCapture={() => setExpanded(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setExpanded(false);
            setActiveRunId(null);
          }
        }}
      >
        {visible.map((item, depth) => {
          const frame = fittedFrame(item.run.asset.width, item.run.asset.height);
          const slot = pairSlotFor(item.run.id);
          const active = activeRunId === item.run.id;
          const translateX = depth * stepX - centerX;
          const translateY = depth * stepY - centerY;
          const rotation = depth * (fanned ? 2.25 : 1.5);
          const repeatLabel = `${contextLabel} · R${item.repeatIndex + repeatOrdinalOffset + 1}`;
          return (
            <AssetFileContextMenu
              key={item.run.id}
              assetId={item.run.asset.id}
              notify={notify}
              revealContext={{ kind: 'CREATION', seriesId }}
            >
              <AssetHoverPreview asset={item.run.asset} side="left">
                <button
                  type="button"
                  data-stack-layer={depth}
                  data-stack-active={active || undefined}
                  aria-label={slot ? `${repeatLabel} · ${slot}` : repeatLabel}
                  aria-pressed={pairSelecting ? Boolean(slot) : undefined}
                  className={cn(
                    'group absolute top-1/2 left-1/2 rounded-md outline-none transition-transform duration-base ease-enter focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  style={{
                    width: frame.width,
                    height: frame.height,
                    zIndex: active ? 30 : 20 - depth,
                    transform: `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) rotate(${rotation}deg)`,
                  }}
                  onMouseEnter={() => setActiveRunId(item.run.id)}
                  onMouseLeave={() => setActiveRunId((current) => (current === item.run.id ? null : current))}
                  onFocus={() => setActiveRunId(item.run.id)}
                  onBlur={() => setActiveRunId((current) => (current === item.run.id ? null : current))}
                  onClick={() => select(item)}
                >
                  <span
                    className={cn(
                      'pointer-events-none relative isolate block size-full overflow-hidden rounded-md border bg-surface-sunken transition-transform duration-base ease-enter',
                      pairSelecting && active && 'ring-2 ring-selected-border',
                      slot && 'ring-2 ring-ring',
                    )}
                    style={{ transform: active ? `rotate(${-rotation}deg)` : 'none' }}
                  >
                    <ImageAmbientBackdrop src={item.run.asset.mediaUrl} />
                    <img
                      className="relative z-10 size-full object-contain"
                      src={item.run.asset.mediaUrl}
                      alt=""
                      draggable={false}
                    />
                    <span className="absolute right-1.5 bottom-1.5 z-20 rounded-sm border bg-overlay/90 px-1 py-0.5 font-mono text-[9px] font-medium tabular-nums">
                      R{item.repeatIndex + repeatOrdinalOffset + 1}
                    </span>
                    {slot && (
                      <span className="absolute top-1.5 left-1.5 z-20 grid size-5 place-items-center rounded-sm border bg-background/95 text-[11px] font-semibold">
                        {slot}
                      </span>
                    )}
                  </span>
                </button>
              </AssetHoverPreview>
            </AssetFileContextMenu>
          );
        })}
        {successes.length > 3 && (
          <span className="pointer-events-none absolute top-0 right-0 z-40 rounded-full border bg-overlay px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums">
            +{successes.length - 3}
          </span>
        )}
        {successes.length > 1 && (
          <Popover modal open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="absolute right-0 bottom-0 z-40 rounded-full border bg-overlay px-2 py-1 text-[10px] font-medium tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${labels.viewAllImages} · ${successes.length} ${labels.images}`}
              >
                {successes.length} {labels.images}
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" sideOffset={8} className="w-80 p-2">
              <div className="px-1 pb-2 text-xs font-medium tabular-nums">
                {contextLabel} · {successes.length} {labels.images}
              </div>
              <ScrollArea style={{ height: `min(${popoverHeight}rem, 55vh)` }}>
                <div className="grid grid-cols-3 gap-2 pr-2 pb-1">
                  {successes.map((item) => {
                    const slot = pairSlotFor(item.run.id);
                    return (
                      <AssetFileContextMenu
                        key={item.run.id}
                        assetId={item.run.asset.id}
                        notify={notify}
                        revealContext={{ kind: 'CREATION', seriesId }}
                      >
                        <button
                          type="button"
                          aria-label={`${contextLabel} · R${item.repeatIndex + repeatOrdinalOffset + 1}${slot ? ` · ${slot}` : ''}`}
                          aria-pressed={pairSelecting ? Boolean(slot) : undefined}
                          className={cn(
                            'relative isolate h-28 overflow-hidden rounded-md border bg-surface-sunken outline-none hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            slot && 'ring-2 ring-foreground',
                          )}
                          onClick={() => select(item)}
                        >
                          <ImageAmbientBackdrop src={item.run.asset.mediaUrl} loading="lazy" />
                          <img
                            className="relative z-10 size-full object-contain"
                            src={item.run.asset.mediaUrl}
                            alt=""
                            loading="lazy"
                            draggable={false}
                          />
                          <span className="absolute right-1 bottom-1 z-20 rounded-sm border bg-background/90 px-1 py-0.5 font-mono text-[9px] font-medium tabular-nums">
                            R{item.repeatIndex + repeatOrdinalOffset + 1}
                          </span>
                          {slot && (
                            <span className="absolute top-1 left-1 z-20 grid size-5 place-items-center rounded-sm border bg-background/95 text-[11px] font-semibold">
                              {slot}
                            </span>
                          )}
                        </button>
                      </AssetFileContextMenu>
                    );
                  })}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
