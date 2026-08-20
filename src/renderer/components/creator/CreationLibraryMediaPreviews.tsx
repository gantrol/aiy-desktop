import type { AlbumDto, AssetDto, Locale } from '@/shared/contracts';
import { AlbumCoverBadge } from '@/renderer/components/albums/AlbumTreePreview';
import { TreeBranchNodeConnector, TreeBranchTransitRail } from '@/renderer/components/albums/TreeDisclosureRail';
import { getTreeNodeAnchor, type TreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';
import {
  getMediaStackHorizontalBounds,
  getMediaStackLayout,
  getMediaStackPrimaryFrameBounds,
  MediaStackPreview,
  type MediaStackItem,
} from '@/renderer/components/media/MediaStackPreview';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';

export interface CreationAssetNavigationTarget {
  sessionId: string;
  seriesId: string;
}

interface SessionAssetRecord {
  asset: AssetDto;
  seriesId: string;
}

export function indexCreationAssetNavigationTargets(
  sessionAssetsById: ReadonlyMap<string, readonly SessionAssetRecord[]>,
) {
  const result = new Map<string, CreationAssetNavigationTarget[]>();
  for (const [sessionId, assets] of sessionAssetsById) {
    for (const { asset, seriesId } of assets) {
      const current = result.get(asset.id) ?? [];
      current.push({ sessionId, seriesId });
      result.set(asset.id, current);
    }
  }
  return result;
}

export function resolveCreationAlbumPreviewTarget(
  albumId: string,
  assetId: string,
  targetsByAssetId: ReadonlyMap<string, readonly CreationAssetNavigationTarget[]>,
  albumBySessionId: ReadonlyMap<string, string>,
  parentAlbumById: ReadonlyMap<string, string>,
) {
  const candidates = targetsByAssetId.get(assetId) ?? [];
  for (const candidate of candidates) {
    let currentAlbumId: string | undefined = albumBySessionId.get(candidate.sessionId);
    const visited = new Set<string>();
    while (currentAlbumId && !visited.has(currentAlbumId)) {
      if (currentAlbumId === albumId) return candidate;
      visited.add(currentAlbumId);
      currentAlbumId = parentAlbumById.get(currentAlbumId);
    }
  }
  return null;
}

export function creationAlbumPreviewAssetLabel(
  album: Pick<AlbumDto, 'id' | 'title'>,
  index: number,
  locale: Locale,
  target: CreationAssetNavigationTarget | null,
  openLabel: string,
) {
  if (!target) return `${openLabel}: ${album.title}`;
  return locale === 'zh'
    ? `打开对应创作：${album.title} · 图片 ${index + 1}`
    : `Open related creation: ${album.title} · Image ${index + 1}`;
}

export function CompactCreationAlbumPreview({
  album,
  assets,
  assetLabel,
  onAlbumSelect,
  onAssetSelect,
  onAssetPreviewChange,
}: {
  album: AlbumDto;
  assets: readonly AssetDto[];
  assetLabel(asset: AssetDto, index: number): string;
  onAlbumSelect(): void;
  onAssetSelect(asset: AssetDto): void;
  onAssetPreviewChange(asset: AssetDto | null): void;
}) {
  return (
    <span className="pointer-events-none relative z-10 grid size-full place-items-center">
      <MediaStackPreview
        className="pointer-events-none"
        size="rail"
        singleItemAlign="center"
        items={assets.map((asset) => ({ asset }))}
        onAssetSelect={onAssetSelect}
        onAssetPreviewChange={onAssetPreviewChange}
        assetLabel={assetLabel}
      />
      <AlbumCoverBadge compact label={album.title} overlayStyle="solid" onClick={onAlbumSelect} />
    </span>
  );
}

export function CreationSessionTreePreview({
  items,
  branchTopology,
  onAssetSelect,
  actions,
  notify,
}: {
  items: MediaStackItem[];
  branchTopology: TreeBranchItemTopology | undefined;
  onAssetSelect(asset: AssetDto): void;
  actions: readonly ActionMenuAction[];
  notify(message: string): void;
}) {
  const paintedBounds = getMediaStackHorizontalBounds('tree', items, 'settled');
  const previewWidth = Math.ceil(Math.max(getMediaStackLayout('tree').containerWidth, paintedBounds.right));
  const preview = (
    <MediaStackPreview
      size="tree"
      items={items}
      onAssetSelect={onAssetSelect}
      notify={notify}
      contextActions={actions}
    />
  );
  if (!branchTopology) {
    return (
      <span
        className="relative z-10 -ml-1 flex h-[4.25rem] shrink-0 items-center overflow-visible pl-0.5"
        style={{ width: previewWidth }}
      >
        {preview}
      </span>
    );
  }
  const nodeAnchor = getTreeNodeAnchor(getMediaStackPrimaryFrameBounds('tree', items));
  return (
    <span
      data-tree-branch-media-preview
      className="relative z-10 -ml-1 flex h-[4.25rem] shrink-0 items-center overflow-visible"
      style={{ width: previewWidth }}
    >
      <TreeBranchTransitRail topology={branchTopology} />
      <TreeBranchNodeConnector topology={branchTopology} anchor={nodeAnchor} />
      {preview}
    </span>
  );
}
