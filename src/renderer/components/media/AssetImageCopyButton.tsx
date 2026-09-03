import { CopyIcon, LoaderCircleIcon } from 'lucide-react';
import { useState, type MouseEvent, type PointerEvent } from 'react';
import type { MessageCatalog } from '@/renderer/i18n/catalog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { useAssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import { cn } from '@/renderer/lib/utils';

export async function copyAssetImage(
  assetId: string,
  labels: MessageCatalog['assetFile'],
  notify: (message: string) => void,
) {
  notify(labels.copying);
  try {
    await window.desktopApi.assetFileCopy(assetId);
    notify(labels.copied);
  } catch (reason) {
    notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    throw reason;
  }
}

export function AssetImageCopyButton({ assetId, className }: { assetId: string; className?: string }) {
  const { messages } = useI18n();
  const menuActions = useAssetMenuActions();
  const [copying, setCopying] = useState(false);

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (copying) return;
    setCopying(true);
    try {
      await copyAssetImage(assetId, messages.assetFile, menuActions?.notify ?? (() => undefined));
    } catch {
      // copyAssetImage reports the actionable failure through the app notification surface.
    } finally {
      setCopying(false);
    }
  }

  function preserveImageInteraction(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      className={cn(
        'absolute top-2 right-2 z-20 size-8 opacity-0 shadow-overlay transition-opacity group-hover/article-image:opacity-100 group-focus-within/article-image:opacity-100 focus-visible:opacity-100',
        className,
      )}
      title={messages.assetFile.copy}
      aria-label={messages.assetFile.copy}
      aria-busy={copying || undefined}
      disabled={copying}
      onPointerDown={preserveImageInteraction}
      onClick={(event) => void copy(event)}
    >
      {copying ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CopyIcon className="size-4" />}
    </Button>
  );
}
