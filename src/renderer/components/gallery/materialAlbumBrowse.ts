import type { AssetDto, MaterialAlbumDto } from '@/shared/contracts';
import { buildMaterialAlbumTree, type MaterialAlbumTreeIndex } from '@/renderer/components/gallery/materialAlbumTree';

export interface MaterialAlbumBrowseSummary {
  album: MaterialAlbumDto;
  childAlbumCount: number;
  directMaterialCount: number;
  materialCount: number;
  previewAssets: AssetDto[];
}

export interface MaterialAlbumBrowseIndex {
  tree: MaterialAlbumTreeIndex;
  summaryById: ReadonlyMap<string, MaterialAlbumBrowseSummary>;
}

interface InternalSummary extends MaterialAlbumBrowseSummary {
  materialIds: Set<string>;
}

function appendPreviewAssets(target: AssetDto[], seen: Set<string>, assets: readonly AssetDto[]) {
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    target.push(asset);
    if (target.length === 4) return;
  }
}

/** Builds the directory-facing counts and flat collage previews for user material albums. */
export function buildMaterialAlbumBrowseIndex(albums: readonly MaterialAlbumDto[]): MaterialAlbumBrowseIndex {
  const tree = buildMaterialAlbumTree(albums);
  const internalById = new Map<string, InternalSummary>();
  const visiting = new Set<string>();

  function summarize(album: MaterialAlbumDto): InternalSummary {
    const cached = internalById.get(album.id);
    if (cached) return cached;

    const materialIds = new Set(album.members.map((member) => member.materialId));
    const previewAssets: AssetDto[] = [];
    const previewAssetIds = new Set<string>();
    appendPreviewAssets(previewAssets, previewAssetIds, album.previewAssets);
    const children = tree.childrenByParentId.get(album.id) ?? [];
    const summary: InternalSummary = {
      album,
      childAlbumCount: children.length,
      directMaterialCount: album.members.length,
      materialCount: materialIds.size,
      previewAssets,
      materialIds,
    };
    internalById.set(album.id, summary);

    if (visiting.has(album.id)) return summary;
    visiting.add(album.id);
    for (const child of children) {
      const childSummary = summarize(child);
      for (const materialId of childSummary.materialIds) materialIds.add(materialId);
      appendPreviewAssets(previewAssets, previewAssetIds, childSummary.previewAssets);
    }
    visiting.delete(album.id);
    summary.materialCount = materialIds.size;
    return summary;
  }

  for (const album of albums) summarize(album);
  return { tree, summaryById: internalById };
}

export function materialAlbumAncestors(albumId: string, tree: MaterialAlbumTreeIndex): MaterialAlbumDto[] {
  const ancestors: MaterialAlbumDto[] = [];
  const visited = new Set<string>([albumId]);
  let parentId = tree.parentById.get(albumId);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = tree.byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = tree.parentById.get(parent.id);
  }
  return ancestors;
}
