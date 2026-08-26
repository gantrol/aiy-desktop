import type { AlbumDto, AssetDto, Locale } from '@/shared/contracts';
import { AlbumCoverBadge } from '@/renderer/components/albums/AlbumTreePreview';
import {
  CreationTreeNodeFrame,
  type CreationLibraryTreePlacementProps,
  type CreationTreeChildBranch,
  getCreationTreeMediaNodeMetrics,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
import { useTreeBranchPreviewGesture } from '@/renderer/components/albums/useTreeBranchPreviewGesture';
import { MediaStackPreview, type MediaStackItem } from '@/renderer/components/media/MediaStackPreview';
import { cn } from '@/renderer/lib/utils';
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

export interface CreationSessionTreePreviewProps extends CreationLibraryTreePlacementProps {
  items: MediaStackItem[];
  childBranch?: CreationTreeChildBranch;
  onAssetSelect(asset: AssetDto): void;
  actions: readonly ActionMenuAction[];
  notify(message: string): void;
  onGestureExpand?(): void;
  onPointerTrackStart?(clientY: number): void;
  onPointerTrack?(clientY: number): boolean;
}

export function CreationSessionTreePreview({
  items,
  childBranch,
  branchTopology,
  onAssetSelect,
  actions,
  notify,
  onGestureExpand,
  onPointerTrackStart,
  onPointerTrack,
}: CreationSessionTreePreviewProps) {
  const metrics = getCreationTreeMediaNodeMetrics(items);
  const previewGesture = useTreeBranchPreviewGesture({
    open: childBranch?.open ?? false,
    expandable: Boolean(childBranch),
    canSpreadPreview: false,
    onGestureExpand: childBranch ? onGestureExpand : undefined,
    onPointerTrackStart: childBranch ? onPointerTrackStart : undefined,
    onPointerTrack: childBranch ? onPointerTrack : undefined,
  });
  const preview = (
    <MediaStackPreview
      size="tree"
      items={items}
      onAssetSelect={onAssetSelect}
      notify={notify}
      contextActions={actions}
    />
  );
  return (
    <CreationTreeNodeFrame
      data-tree-branch-media-preview
      bounds={metrics.bounds}
      branchTopology={branchTopology}
      className={cn('-ml-1 flex h-[4.25rem] items-center', !branchTopology && 'pl-0.5')}
      style={{ width: metrics.width }}
      {...(childBranch ? previewGesture.bindings : {})}
    >
      {preview}
    </CreationTreeNodeFrame>
  );
}
