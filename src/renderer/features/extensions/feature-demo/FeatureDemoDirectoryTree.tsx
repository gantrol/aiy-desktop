import { useMemo, type ReactNode } from 'react';
import type { AssetDto, BootstrapDto } from '@/shared/contracts';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { TreeBranchContent } from '@/renderer/components/albums/TreeDisclosureRail';
import { getTreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';
import {
  CreationLibraryTreeItem,
  getCreationTreeMediaNodeMetrics,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
import { allAssets } from '@/renderer/components/creator/utils';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
  DIRECTORY_DEMO_LAYOUT,
  type DirectoryDemoState,
} from '@/renderer/features/extensions/feature-demo/featureDemoDirectoryScene';
import { useI18n } from '@/renderer/i18n/useI18n';

interface FeatureDemoDirectoryTreeProps {
  data: BootstrapDto;
  state: DirectoryDemoState;
}

function collectDemoMaterials(data: BootstrapDto) {
  const assets: AssetDto[] = [];
  const seen = new Set<string>();
  function add(asset: AssetDto) {
    if (assets.length >= 3 || seen.has(asset.id) || !asset.mimeType.startsWith('image/') || !asset.mediaUrl) return;
    if (asset.width <= 0 || asset.height <= 0) return;
    seen.add(asset.id);
    assets.push(asset);
  }
  for (const series of data.series) {
    for (const asset of allAssets(series)) add(asset);
    if (series.cover) add(series.cover);
    if (assets.length >= 3) break;
  }
  for (const album of data.albums) {
    if (assets.length >= 3) break;
    for (const asset of album.previewAssets) add(asset);
  }
  return assets;
}

// Assemble the same cover, branch and work-row components used by the library.
// The timeline supplies state; no pointer events or business writes are simulated.
function DirectoryBranch({
  assets,
  title,
  open,
  previewExpanded,
  nested = false,
  expandLabel,
  children,
}: {
  assets: AssetDto[];
  title: string;
  open: boolean;
  previewExpanded: boolean;
  nested?: boolean;
  expandLabel: string;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} className="relative">
      <div className="relative flex h-[4.25rem] min-w-0 items-center gap-1 px-1">
        <AlbumTreePreview
          assets={assets}
          title={title}
          open={open}
          previewExpanded={previewExpanded}
          animate={false}
          expandable={assets.length > 0}
          expandLabel={expandLabel}
          overlayStyle="solid"
          branchTopology={nested ? getTreeBranchItemTopology(0, 1) : undefined}
          onClick={() => undefined}
          onDoubleClick={() => undefined}
        />
        <Button variant="ghost" className="h-14 min-w-0 flex-1 justify-start px-1 font-normal">
          <span className="line-clamp-2 whitespace-normal break-words text-left text-base font-medium leading-5">
            {title}
          </span>
        </Button>
      </div>
      <TreeBranchContent style={{ animation: 'none' }}>{children}</TreeBranchContent>
    </Collapsible>
  );
}

export function FeatureDemoDirectoryTree({ data, state }: FeatureDemoDirectoryTreeProps) {
  const { messages } = useI18n();
  const copy = messages.extensions.featureDemo.directory;
  const assets = useMemo(() => collectDemoMaterials(data), [data]);
  const selectedAsset = state.selected ? assets[0] : null;

  if (!assets.length) {
    return <div className="grid size-full place-items-center text-sm text-muted-foreground">{copy.empty}</div>;
  }

  return (
    <div data-feature-demo-live-directory-tree className="flex size-full min-h-0 bg-background">
      <ScrollArea className="h-full shrink-0 border-r" style={{ width: DIRECTORY_DEMO_LAYOUT.sidebarWidth }}>
        <nav aria-label={copy.root} style={{ padding: DIRECTORY_DEMO_LAYOUT.padding }}>
          <DirectoryBranch
            assets={assets}
            title={copy.root}
            open={state.rootOpen}
            previewExpanded={state.preview === 'root'}
            expandLabel={
              state.rootOpen
                ? messages.videoDocuments.collapseAlbum(copy.root)
                : messages.videoDocuments.expandAlbum(copy.root)
            }
          >
            <DirectoryBranch
              assets={assets}
              title={copy.collection}
              open={state.childOpen}
              previewExpanded={state.preview === 'child'}
              nested
              expandLabel={
                state.childOpen
                  ? messages.videoDocuments.collapseAlbum(copy.collection)
                  : messages.videoDocuments.expandAlbum(copy.collection)
              }
            >
              {assets.map((asset, index) => {
                const items = [{ asset }];
                const metrics = getCreationTreeMediaNodeMetrics(items);
                const title = copy.work(index + 1);
                return (
                  <CreationLibraryTreeItem
                    key={asset.id}
                    selected={selectedAsset?.id === asset.id}
                    ariaLabel={title}
                    openLabel={title}
                    title={title}
                    preview={<MediaStackPreview items={items} size="tree" spread="settled" animate={false} />}
                    previewBounds={metrics.bounds}
                    previewStyle={{ width: metrics.width }}
                    branchTopology={getTreeBranchItemTopology(index, assets.length)}
                    onOpen={() => undefined}
                  />
                );
              })}
            </DirectoryBranch>
          </DirectoryBranch>
        </nav>
      </ScrollArea>
      <div className="min-w-0 flex-1 p-6">
        {selectedAsset ? (
          <figure className="flex h-full min-h-0 flex-col gap-3">
            <AssetMedia asset={selectedAsset} alt={copy.work(1)} className="min-h-0 w-full flex-1 object-contain" />
            <figcaption className="text-center text-sm font-medium">{copy.work(1)}</figcaption>
          </figure>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-2 auto-rows-fr gap-4">
            {assets.map((asset, index) => (
              <AssetMedia
                key={asset.id}
                asset={asset}
                alt={copy.work(index + 1)}
                className="size-full min-h-0 object-contain"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
