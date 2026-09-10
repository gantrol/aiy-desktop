import type { AssetDto } from '@/shared/contracts';
import type { GifFrame } from '@/shared/contracts/gif-making';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';

type FrameImageUrl = (asset: AssetDto, size: 128 | 512) => string;

export function GifFrameImage({
  frame,
  asset,
  imageUrl = mediaThumbnailUrl,
}: {
  frame: GifFrame;
  asset: AssetDto | undefined;
  imageUrl?: FrameImageUrl;
}) {
  if (!asset) return null;
  if (!frame.sourceRect)
    return (
      <img src={imageUrl(asset, 128)} alt="" loading="lazy" draggable={false} className="size-full object-contain" />
    );
  const rect = frame.sourceRect ?? { x: 0, y: 0, width: asset.width, height: asset.height };
  return (
    <svg viewBox={`${rect.x} ${rect.y} ${rect.width} ${rect.height}`} className="size-full" aria-hidden="true">
      <image href={imageUrl(asset, 512)} width={asset.width} height={asset.height} />
    </svg>
  );
}
export function GifFrameStrip({
  frames,
  selectedId,
  assets,
  onSelect,
  onMove,
  imageUrl,
}: {
  frames: GifFrame[];
  selectedId: string | undefined;
  assets: Map<string, AssetDto>;
  onSelect(id: string): void;
  onMove(sourceId: string, targetId: string): void;
  imageUrl?: FrameImageUrl;
}) {
  const labels = useI18n().messages.creator.gifMaker;
  return (
    <div role="group" aria-label={labels.frames} className="flex min-h-24 gap-2 overflow-x-auto py-2">
      {frames.map((frame, index) => (
        <Button
          key={frame.id}
          data-gif-frame-id={frame.id}
          data-duration-ms={frame.durationMs}
          variant="ghost"
          aria-pressed={frame.id === selectedId}
          aria-label={`${labels.frame} ${index + 1} · ${frame.durationMs} ms`}
          onClick={() => onSelect(frame.id)}
          className={cn(
            'h-24 w-20 shrink-0 flex-col gap-1 rounded-sm p-1',
            selectedId === frame.id && 'bg-accent ring-1 ring-foreground/40',
          )}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-aiy-gif-frame', frame.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-aiy-gif-frame')) event.preventDefault();
          }}
          onDrop={(event) => {
            const source = event.dataTransfer.getData('application/x-aiy-gif-frame');
            if (source) {
              event.preventDefault();
              event.stopPropagation();
              onMove(source, frame.id);
            }
          }}
        >
          <span className="block h-14 w-full overflow-hidden">
            <GifFrameImage frame={frame} asset={assets.get(frame.assetId)} imageUrl={imageUrl} />
          </span>
          <span className="text-2xs tabular-nums">
            {index + 1} · {frame.durationMs} ms
          </span>
        </Button>
      ))}
    </div>
  );
}
