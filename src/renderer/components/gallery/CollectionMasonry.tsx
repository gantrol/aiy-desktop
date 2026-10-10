import { useCallback, type ComponentProps } from 'react';
import { useMaterialLayoutPreferences } from '@/renderer/components/gallery/materialLayoutPreferences';
import { getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { MasonrySurface } from '@/renderer/components/ui/masonry-surface';
import { useWorkspaceVisible } from '@/renderer/components/workspace/WorkspacePaneScope';
import { computeCollectionLayout, type CollectionLayoutItem } from '@/renderer/components/gallery/collectionLayout';
import {
  CollectionMeasuredItem,
  useCollectionItemMeasurements,
} from '@/renderer/components/gallery/CollectionMeasuredItem';

/** Preserve actual cover proportions; text items have no image aspect ratio. */
export function collectionCoverRatio(asset?: { width: number | null; height: number | null } | null) {
  return getSourceMediaAspectRatio(asset?.width ?? 0, asset?.height ?? 0, 4 / 3);
}

type Props = Pick<ComponentProps<typeof MasonrySurface>, 'renderItem' | 'viewportRef' | 'className'> & {
  items: readonly CollectionLayoutItem[];
};

export function CollectionMasonry({ items, viewportRef, renderItem, ...props }: Props) {
  const visible = useWorkspaceVisible();
  const { preferences } = useMaterialLayoutPreferences();
  const { size } = preferences;
  const { measurements, observe } = useCollectionItemMeasurements(items);
  const computeLayout = useCallback(
    (width: number) => computeCollectionLayout(items, width, size, measurements),
    [items, measurements, size],
  );
  return (
    <MasonrySurface
      {...props}
      items={items}
      computeLayout={computeLayout}
      layoutKind="COLUMNS"
      renderItem={(item, index, placement, layout) =>
        !visible ? null : items[index].textOnly ? (
          <CollectionMeasuredItem id={item.id} observe={observe}>
            {renderItem(item, index, placement, layout)}
          </CollectionMeasuredItem>
        ) : (
          renderItem(item, index, placement, layout)
        )
      }
      viewportRef={viewportRef}
      virtualize={Boolean(viewportRef)}
      preserveScrollAnchor
    />
  );
}
