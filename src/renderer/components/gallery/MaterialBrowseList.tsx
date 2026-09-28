import type { ReactNode } from 'react';
import { FileTextIcon, VideoIcon } from 'lucide-react';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { isVideoAsset } from '@/renderer/components/media/AssetMedia';
import { materialTitle, type MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';

export function MaterialBrowseList({
  items,
  selectedKey,
  toggle,
  onSelect,
}: {
  items: readonly MaterialLibraryItem[];
  selectedKey: string;
  toggle: ReactNode;
  onSelect(item: MaterialLibraryItem): void;
}) {
  const { messages } = useI18n();
  return (
    <>
      <WorkbenchPaneHeader>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{messages.workbench.browseResults}</h2>
        {toggle}
      </WorkbenchPaneHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {items.map((item) => {
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
                  <img
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
          })}
        </div>
      </ScrollArea>
    </>
  );
}
