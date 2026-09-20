import type { AlbumDto, AssetDto, MaterialAlbumDto } from '@/shared/contracts';
const stamp = '2026-09-14T12:00:00Z';
export const albumAssets: AssetDto[] = [
  ['landscape', 600, 400],
  ['portrait', 400, 600],
  ['square', 300, 300],
  ['video', 400, 600],
].map(([name, width, height]) => ({
  id: `album-demo-${name}`,
  width: Number(width),
  height: Number(height),
  kind: 'REFERENCE',
  mimeType: name === 'video' ? 'video/mp4' : 'image/svg+xml',
  mediaUrl: 'unused-in-static-navigation',
  createdAt: stamp,
}));
export function demoAlbums(english: boolean): MaterialAlbumDto[] {
  const names = english
    ? [
        'Quiet afternoons',
        'Botanical studies',
        'A little colour',
        'Work in progress',
        'A very long album name that should not displace the controls',
        'Missing cover',
      ]
    : [
        '午后的片刻',
        '花与叶的习作',
        '收集一点颜色',
        '还在酝酿',
        '一个很长很长的图集名称，也不应挤走预览与更多操作',
        '暂时无法读取封面',
      ];
  return names.map((title, index) => ({
    id: `album-${index}`,
    title,
    kind: 'USER',
    systemKey: null,
    sourceAlbumId: null,
    sourceSeriesId: null,
    materialCount: [12, 6, 1, 0, 28, 2][index],
    previewAssets:
      index === 3
        ? []
        : index === 5
          ? [{ ...albumAssets[0], id: 'album-demo-broken' }]
          : index === 2
            ? [albumAssets[2]]
            : index === 1
              ? [albumAssets[1], albumAssets[0]]
              : albumAssets,
    readOnly: false,
    parentId: null,
    createdAt: stamp,
    updatedAt: stamp,
    members: [],
  }));
}
export function asCreationAlbum(album: MaterialAlbumDto): AlbumDto {
  return {
    id: album.id,
    title: album.title,
    intent: '',
    pinned: false,
    creationDefaults: {
      schemaVersion: 1,
      recipes: [],
      dictionaryScope: { mode: 'ALL', sources: [], includeLocalTerms: true },
    },
    materialCount: album.materialCount,
    creationItemCount: 0,
    previewAssets: album.previewAssets,
    createdAt: stamp,
    updatedAt: stamp,
    activityAt: stamp,
    archivedAt: null,
    members: [],
  };
}
