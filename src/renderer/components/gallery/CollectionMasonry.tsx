import { useCallback, type ComponentProps } from 'react';
import { useMaterialLayoutPreferences } from '@/renderer/components/gallery/materialLayoutPreferences';
import { getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { computeJustifiedRows } from '@/renderer/components/ui/justified-row-layout';
import { MasonrySurface } from '@/renderer/components/ui/masonry-surface';
import { computeShortestColumnMasonry } from '@/renderer/components/ui/shortest-column-masonry';

export const COLLECTION_CAPTION_HEIGHT = 52;
const GAP = 12;

/** Keep titles usable on portrait covers without cropping the thumbnail. */
export function collectionCoverRatio(asset?: { width: number | null; height: number | null } | null) {
  return Math.max(3 / 4, Math.min(2, getSourceMediaAspectRatio(asset?.width ?? 0, asset?.height ?? 0, 4 / 3)));
}

type Props = Pick<ComponentProps<typeof MasonrySurface>, 'items' | 'renderItem' | 'viewportRef' | 'className'>;

export function CollectionMasonry({ items, viewportRef, ...props }: Props) {
  const { preferences } = useMaterialLayoutPreferences();
  const { arrangement, size } = preferences;
  const computeLayout = useCallback(
    (width: number) => {
      if (arrangement === 'ROWS') {
        return {
          columnCount: 0,
          columnWidth: 0,
          ...computeJustifiedRows(items, width, size, GAP, COLLECTION_CAPTION_HEIGHT),
        };
      }
      const { columnWidth } = computeShortestColumnMasonry([], width, size, GAP);
      return computeShortestColumnMasonry(
        items.map((item) => ({ ...item, height: columnWidth / item.aspectRatio + COLLECTION_CAPTION_HEIGHT })),
        width,
        size,
        GAP,
      );
    },
    [arrangement, items, size],
  );
  return (
    <MasonrySurface
      {...props}
      items={items}
      computeLayout={computeLayout}
      layoutKind={arrangement}
      viewportRef={viewportRef}
      virtualize={Boolean(viewportRef)}
      preserveScrollAnchor
    />
  );
}
