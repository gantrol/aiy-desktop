import type { RefObject } from 'react';
import type { GalleryDictionaryCollection } from '@/renderer/components/app/app-navigation';
import { useAlbumTreeExpansion } from '@/renderer/components/albums/useAlbumTreeExpansion';
import { useDeferredSingleDoubleClick } from '@/renderer/components/albums/useDeferredSingleDoubleClick';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type { AlbumNavigationLabels } from '@/renderer/components/gallery/AlbumNavigation';
import { DictionaryAlbumTree } from '@/renderer/components/gallery/DictionaryAlbumTree';
import type { DictionaryMaterialTree } from '@/renderer/components/gallery/dictionaryMaterialTree';

interface Props {
  viewportRef: RefObject<HTMLDivElement | null>;
  tree: DictionaryMaterialTree;
  selection: GalleryDictionaryCollection | null;
  expansion: ReturnType<typeof useAlbumTreeExpansion>;
  click: ReturnType<typeof useDeferredSingleDoubleClick>;
  labels: AlbumNavigationLabels;
  moreLabel: string;
  onSelect(collection: GalleryDictionaryCollection): void;
}

export function DictionaryNavigationPane({
  viewportRef,
  tree,
  selection,
  expansion,
  click,
  labels,
  moreLabel,
  onSelect,
}: Props) {
  return (
    <ScrollArea type="always" className="min-h-0 flex-1" viewportRef={viewportRef}>
      <div className="space-y-0.5 px-2 py-2">
        <DictionaryAlbumTree
          tree={tree}
          selection={selection}
          expansion={expansion}
          click={click}
          openLabel={labels.open}
          expandLabel={labels.expand}
          collapseLabel={labels.collapse}
          moreLabel={moreLabel}
          moreActionsLabel={labels.moreActions}
          onSelect={onSelect}
        />
      </div>
    </ScrollArea>
  );
}
