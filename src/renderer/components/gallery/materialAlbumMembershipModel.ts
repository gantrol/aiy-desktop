import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import type {
  MaterialAlbumMembershipApplyResult,
  MaterialAlbumMembershipEdit,
} from '@/shared/contracts/material-album-membership';

export function albumMembershipRows(albums: readonly MaterialAlbumDto[], target: MaterialSelectionTargetInput) {
  const byId = new Map(albums.map((album) => [album.id, album]));
  return albums
    .filter((album) => album.kind === 'USER' && !album.readOnly)
    .map((album) => {
      const parents: string[] = [];
      const visited = new Set([album.id]);
      let parentId = album.parentId;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        parents.unshift(parent.title);
        parentId = parent.parentId;
      }
      const member =
        album.members.find((candidate) =>
          target.kind === 'MATERIAL'
            ? candidate.materialId === target.materialId
            : candidate.imageAsset?.id === target.imageAssetId,
        ) ?? null;
      return { album, member, parentPath: parents.join(' / '), path: [...parents, album.title].join(' / ') };
    });
}

export function membershipChanges(rows: ReturnType<typeof albumMembershipRows>, selected: ReadonlySet<string>) {
  return rows.flatMap(({ album, member }): MaterialAlbumMembershipEdit['changes'] => {
    const checked = selected.has(album.id);
    return checked === Boolean(member)
      ? []
      : [{ albumId: album.id, checked, expected: member ? { id: member.id, updatedAt: member.updatedAt } : null }];
  });
}

export function patchAlbumMemberships(
  albums: readonly MaterialAlbumDto[],
  result: Extract<MaterialAlbumMembershipApplyResult, { status: 'APPLIED' }>,
) {
  const patches = new Map(result.patches.map((patch) => [patch.albumId, patch]));
  const all =
    result.createdAlbum && !albums.some((album) => album.id === result.createdAlbum!.id)
      ? [...albums, result.createdAlbum]
      : albums;
  return all.map((album) => {
    const patch = patches.get(album.id);
    if (!patch) return album;
    const members = album.members.filter(
      (member) => member.id !== patch.previousMemberId && member.id !== patch.member?.id,
    );
    if (patch.member) members.push(patch.member);
    members.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    return {
      ...album,
      members,
      materialCount: members.length,
      updatedAt: patch.updatedAt,
      previewAssets: members.flatMap((member) => (member.imageAsset ? [member.imageAsset] : [])).slice(0, 4),
    };
  });
}

export function normalizedAlbumQuery(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}
