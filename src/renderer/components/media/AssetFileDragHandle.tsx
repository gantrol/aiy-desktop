import { FileOutputIcon } from 'lucide-react';
import type { DragEvent } from 'react';
import { startNativeImageAssetDrag } from '@/renderer/components/albums/albumDrag';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  assetId: string;
  label: string;
  className?: string;
  notify(message: string): void;
}

export function AssetFileDragHandle({ assetId, label, className, notify }: Props) {
  const failedLabel = useI18n().messages.assetFile.failed;

  function startDrag(event: DragEvent<HTMLButtonElement>) {
    try {
      startNativeImageAssetDrag(event, [assetId]);
    } catch (reason) {
      notify(`${failedLabel}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      draggable
      title={label}
      aria-label={label}
      className={cn(
        'cursor-grab bg-overlay/95 text-foreground active:cursor-grabbing hover:bg-hover active:bg-pressed',
        className,
      )}
      onDragStart={startDrag}
    >
      <FileOutputIcon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
