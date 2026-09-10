import { useMemo, useState } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { GIF_MAX_FRAMES, type GifFrame } from '@/shared/contracts/gif-making';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { Button } from '@/renderer/components/ui/button';
import { GifNumber } from '@/renderer/features/gif-making/GifSettings';
import { useI18n } from '@/renderer/i18n/useI18n';

export function GifSheetDialog({
  asset,
  frame,
  availableFrames,
  onClose,
  onApply,
}: {
  asset: AssetDto;
  frame: GifFrame;
  availableFrames: number;
  onClose(): void;
  onApply(frames: GifFrame[]): void;
}) {
  const labels = useI18n().messages.creator.gifMaker;
  const [rows, setRows] = useState(2),
    [columns, setColumns] = useState(3),
    [margin, setMargin] = useState(0),
    [gap, setGap] = useState(0);
  const cells = useMemo(() => {
    const width = Math.floor((asset.width - 2 * margin - (columns - 1) * gap) / columns);
    const height = Math.floor((asset.height - 2 * margin - (rows - 1) * gap) / rows);
    if (width < 1 || height < 1 || rows * columns > Math.min(availableFrames, GIF_MAX_FRAMES)) return [];
    return Array.from({ length: rows * columns }, (_, index) => ({
      x: margin + (index % columns) * (width + gap),
      y: margin + Math.floor(index / columns) * (height + gap),
      width,
      height,
    }));
  }, [asset, rows, columns, margin, gap, availableFrames]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-dialog="gif-sheet" className="max-w-xl rounded-md" aria-describedby={undefined}>
        <DialogTitle>{labels.split}</DialogTitle>
        <div className="grid grid-cols-4 gap-2">
          <GifNumber id="gif-sheet-rows" label={labels.rows} value={rows} min={1} max={120} onChange={setRows} />
          <GifNumber
            id="gif-sheet-columns"
            label={labels.columns}
            value={columns}
            min={1}
            max={120}
            onChange={setColumns}
          />
          <GifNumber label={labels.margin} value={margin} min={0} max={2048} onChange={setMargin} />
          <GifNumber label={labels.gap} value={gap} min={0} max={2048} onChange={setGap} />
        </div>
        <svg viewBox={`0 0 ${asset.width} ${asset.height}`} className="max-h-80 w-full" aria-label={labels.preview}>
          <image href={asset.mediaUrl} width={asset.width} height={asset.height} />
          {cells.map((cell, i) => (
            <rect
              key={i}
              {...cell}
              fill="none"
              stroke="var(--warning)"
              strokeWidth={Math.max(asset.width, asset.height) / 400}
            />
          ))}
        </svg>
        <Button
          disabled={!cells.length}
          data-action="gif-apply-sheet"
          onClick={() => onApply(cells.map((sourceRect) => ({ ...frame, id: crypto.randomUUID(), sourceRect })))}
        >
          {labels.splitApply} · {cells.length}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
