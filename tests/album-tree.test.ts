import { describe, expect, it } from 'vitest';
import type { AlbumDto } from '../src/shared/contracts';
import { buildAlbumTreeIndex, flattenAlbumTree } from '../src/renderer/components/albums/albumTree';

function album(
  id: string,
  activityAt: string,
  options: {
    pinned?: boolean;
    archived?: boolean;
    children?: string[];
  } = {},
): AlbumDto {
  return {
    id,
    title: id,
    intent: '',
    creationDefaults: {
      schemaVersion: 1,
      recipes: [],
      dictionaryScope: { mode: 'ALL', sources: [], includeLocalTerms: true },
    },
    pinned: options.pinned ?? false,
    materialCount: 0,
    seriesCount: 0,
    previewAssets: [],
    createdAt: activityAt,
    updatedAt: activityAt,
    activityAt,
    archivedAt: options.archived ? activityAt : null,
    members: (options.children ?? []).map((targetId, index) => ({
      id: `${id}:${targetId}`,
      albumId: id,
      targetType: 'ALBUM' as const,
      targetId,
      sortOrder: index,
      imageAsset: null,
      materialText: null,
      seriesTitle: null,
      childAlbumTitle: targetId,
      createdAt: activityAt,
      updatedAt: activityAt,
    })),
  };
}

describe('album tree projection', () => {
  it('sorts each level by pin and recursive activity and preserves depth', () => {
    const index = buildAlbumTreeIndex([
      album('older-root', '2026-01-01T00:00:00Z'),
      album('parent', '2026-03-01T00:00:00Z', { children: ['child-new', 'child-pinned'] }),
      album('child-new', '2026-04-01T00:00:00Z'),
      album('child-pinned', '2025-01-01T00:00:00Z', { pinned: true }),
      album('pinned-root', '2024-01-01T00:00:00Z', { pinned: true }),
    ]);

    expect(flattenAlbumTree(index).map(({ album: item, depth }) => `${depth}:${item.id}`)).toEqual([
      '0:pinned-root',
      '0:parent',
      '1:child-pinned',
      '1:child-new',
      '0:older-root',
    ]);
  });

  it('hides descendants of an archived branch from the active tree', () => {
    const index = buildAlbumTreeIndex([
      album('archived-parent', '2026-03-01T00:00:00Z', { archived: true, children: ['active-child'] }),
      album('active-child', '2026-04-01T00:00:00Z'),
      album('active-root', '2026-02-01T00:00:00Z'),
    ]);

    expect(index.activeRoots.map((item) => item.id)).toEqual(['active-root']);
    expect(index.archivedRoots.map((item) => item.id)).toEqual(['archived-parent']);
    expect(index.effectivelyArchived.has('active-child')).toBe(true);
  });
});
