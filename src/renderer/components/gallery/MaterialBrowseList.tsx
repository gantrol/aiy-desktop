import { FileTextIcon, VideoIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { isVideoAsset } from '@/renderer/components/media/AssetMedia';
import { materialTitle, type MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ScratchImage } from '@/renderer/components/media/ScratchImage';
import { useRef } from 'react';
import { VirtualList } from '@/renderer/components/ui/virtual-list';
import { useWorkspaceVisible } from '@/renderer/components/workspace/WorkspacePaneScope';

const materialKey = (item: MaterialLibraryItem) => item.key;

export function MaterialBrowseList({
  items,
  selectedKey,
  onSelect,
  active = true,
}: {
  items: readonly MaterialLibraryItem[];
  selectedKey: string;
  onSelect(item: MaterialLibraryItem): void;
  active?: boolean;
}) {
  const { messages } = useI18n();
  const workspaceVisible = useWorkspaceVisible();
  const viewportRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
        <div className="p-2">
          <VirtualList
            items={items}
            itemKey={materialKey}
            viewportRef={viewportRef}
            active={active && workspaceVisible}
            estimatedHeight={68}
            renderItem={(item) => {
              const title = materialTitle(item, messages.gallery.inspector.title);
              const asset = item.kind === 'IMAGE' ? item.image.asset : null;
              return (
                <Button
                  key={item.key}
                  variant="ghost"
                  aria-current={item.key === selectedKey ? 'true' : undefined}
                  className={cn(
                    'h-auto w-full justify-start gap-2 p-2 text-left font-normal',
                    item.key === selectedKey && 'bg-selected text-selected-foreground',
                  )}
                  onClick={() => onSelect(item)}
                >
                  {asset && !isVideoAsset(asset) ? (
                    <ScratchImage
                      src={mediaThumbnailUrl(asset, 192)}
                      loading="lazy"
                      decoding="async"
                      alt=""
                      className="size-12 shrink-0 object-contain"
                    />
                  ) : asset ? (
                    <VideoIcon className="size-6 shrink-0" />
                  ) : (
                    <FileTextIcon className="size-6 shrink-0" />
                  )}
                  <span className="min-w-0 truncate text-sm">{title}</span>
                </Button>
              );
            }}
          />
        </div>
      </ScrollArea>
    </>
  );
}
