import { useEffect, useState } from 'react';
import { CropIcon, LoaderCircleIcon, Maximize2Icon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';

export interface ImageAspectRatio {
  width: number;
  height: number;
}

interface Props {
  open: boolean;
  aiAvailable: boolean;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onCrop(ratio: ImageAspectRatio): void;
  onReframe(ratio: ImageAspectRatio): void;
}

const ratios: ImageAspectRatio[] = [
  { width: 1, height: 1 },
  { width: 3, height: 4 },
  { width: 2, height: 3 },
  { width: 4, height: 3 },
  { width: 16, height: 9 },
];

export function ImageAspectDialog({ open, aiAvailable, busy, onOpenChange, onCrop, onReframe }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.imageTransform;
  const [operation, setOperation] = useState<'CROP' | 'AI_REFRAME'>('CROP');
  const [ratio, setRatio] = useState<ImageAspectRatio>({ width: 3, height: 4 });

  useEffect(() => {
    if (!open) return;
    setOperation('CROP');
    setRatio({ width: 3, height: 4 });
  }, [open]);

  const submit = () => (operation === 'CROP' ? onCrop(ratio) : onReframe(ratio));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-md"
        data-dialog="image-aspect"
        data-operation-state={busy ? 'pending' : 'ready'}
        aria-busy={busy}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <Segmented
          type="single"
          value={operation}
          onValueChange={(value) => value && setOperation(value as typeof operation)}
          className="grid w-full grid-cols-2"
        >
          <SegmentedItem value="CROP">
            <CropIcon className="mr-1.5 size-3.5" />
            {labels.crop}
          </SegmentedItem>
          <SegmentedItem value="AI_REFRAME" disabled={!aiAvailable}>
            <Maximize2Icon className="mr-1.5 size-3.5" />
            {labels.aiReframe}
          </SegmentedItem>
        </Segmented>
        <div className="grid grid-cols-5 gap-2">
          {ratios.map((item) => {
            const selected = item.width === ratio.width && item.height === ratio.height;
            return (
              <button
                key={`${item.width}:${item.height}`}
                type="button"
                className={cn(
                  'grid h-16 place-items-center rounded-lg border bg-surface text-xs font-medium outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'border-selected-border bg-selected text-selected-foreground ring-1 ring-ring',
                )}
                aria-pressed={selected}
                data-image-ratio={`${item.width}:${item.height}`}
                onClick={() => setRatio(item)}
              >
                <span
                  className="grid place-items-center rounded-sm border border-current/50"
                  style={{
                    width: `${Math.min(28, (28 * item.width) / item.height)}px`,
                    height: `${Math.min(28, (28 * item.height) / item.width)}px`,
                  }}
                />
                <span>
                  {item.width}:{item.height}
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            data-action="image-transform-submit"
            aria-busy={busy}
            disabled={busy || (operation === 'AI_REFRAME' && !aiAvailable)}
            onClick={submit}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {operation === 'CROP' ? labels.cropAction : labels.reframeAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
