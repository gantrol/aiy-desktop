import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageOffIcon, RotateCcwIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function ContentMediaThumbnail({
  assetId,
  mediaUrl,
  index,
  actions,
  controls,
  label: customLabel,
}: {
  assetId?: string;
  mediaUrl?: string;
  index: number;
  actions: readonly ActionMenuAction[];
  controls?: ReactNode;
  label?: string;
}) {
  const copy = useI18n().messages.contentEditor;
  const label = customLabel ?? copy.previewImage.replace('{index}', String(index + 1));
  const [failedUrl, setFailedUrl] = useState<string>();
  const available = Boolean(mediaUrl && failedUrl !== mediaUrl);
  const preview = (
    <DialogTrigger asChild>
      <Button
        variant="ghost"
        className="relative aspect-square h-auto w-full cursor-zoom-in overflow-hidden rounded-sm bg-muted p-0"
        aria-label={available ? label : `${label}: ${copy.imageUnavailable}`}
        title={available ? label : copy.imageUnavailable}
        disabled={!available}
      >
        {available ? (
          <img
            src={mediaUrl}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setFailedUrl(mediaUrl)}
            className="size-full object-contain"
          />
        ) : (
          <ImageOffIcon className="size-5 text-muted-foreground" />
        )}
        {!controls && !customLabel && (
          <span className="absolute top-1.5 left-1.5 rounded bg-overlay/90 px-1.5 py-0.5 text-2xs tabular-nums">
            {index + 1}
          </span>
        )}
      </Button>
    </DialogTrigger>
  );
  return (
    <Dialog>
      <div className="relative min-w-0">
        {assetId ? (
          <AssetFileContextMenu assetId={assetId} actions={actions}>
            {preview}
          </AssetFileContextMenu>
        ) : (
          preview
        )}
        {mediaUrl && !available && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background"
            aria-label={copy.reloadImage}
            title={copy.reloadImage}
            onClick={() => setFailedUrl(undefined)}
          >
            <RotateCcwIcon className="size-4" />
          </Button>
        )}
        {controls}
      </div>
      <DialogContent className="max-w-[min(96vw,80rem)] rounded-sm p-3" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{label}</DialogTitle>
        {assetId ? (
          <AssetFileContextMenu assetId={assetId} actions={actions}>
            <img src={mediaUrl} alt={label} className="h-[80dvh] w-full object-contain" />
          </AssetFileContextMenu>
        ) : (
          <img src={mediaUrl} alt={label} className="h-[80dvh] w-full object-contain" />
        )}
      </DialogContent>
    </Dialog>
  );
}
