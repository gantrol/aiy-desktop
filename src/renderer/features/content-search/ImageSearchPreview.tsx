import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageSearchItem } from '@/shared/contracts/image-search';
import { imageSearchTitle } from '@/renderer/features/content-search/imageSearchPresentation';
import { ScratchImage } from '@/renderer/components/media/ScratchImage';

export function ImageSearchPreview({ item, notify }: { item: ImageSearchItem | null; notify(message: string): void }) {
  const { messages, locale } = useI18n();
  if (!item)
    return (
      <div className="grid min-h-32 flex-1 place-items-center text-sm text-muted-foreground">
        {messages.workbench.selectResult}
      </div>
    );
  return (
    <AssetFileContextMenu assetId={item.id} notify={notify}>
      <div className="flex size-full min-h-0 items-center justify-center overflow-hidden p-3">
        <ScratchImage
          key={item.id}
          src={`aiy-media://asset/${encodeURIComponent(item.id)}`}
          alt={imageSearchTitle(item, messages.imageSearch, locale)}
          className="max-h-full max-w-full object-contain"
          onError={() => notify(messages.referenceOutline.lookup.notAvailable)}
        />
      </div>
    </AssetFileContextMenu>
  );
}
