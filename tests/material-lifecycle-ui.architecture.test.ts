import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('material selection integration contract', () => {
  it('supports explicit, modifier, checkbox, and long-press selection entry points', () => {
    const gallery = read('src/renderer/components/GalleryScreen.tsx');
    const toolbar = read('src/renderer/components/gallery/MaterialLibraryToolbar.tsx');
    const card = read('src/renderer/components/gallery/MaterialCard.tsx');

    expect(gallery).toContain('selectionMode');
    expect(gallery).toContain('nextGallerySelection');
    expect(toolbar).toContain('onSelectionModeChange');
    expect(card).toContain('<SelectionCheckbox');
    expect(card).toContain('useLongPressSelection');
  });

  it('adds one selection to multiple albums and dictionary entries', () => {
    const gallery = read('src/renderer/components/GalleryScreen.tsx');
    const batch = read('src/renderer/components/gallery/MaterialBatchToolbar.tsx');
    const membership = read('src/renderer/components/gallery/MaterialAlbumMembership.tsx');

    expect(gallery).toContain('materialsAddToDestinations');
    expect(gallery).toContain('albumIds');
    expect(gallery).toContain('termIds');
    expect(batch).toContain('onAdd(albumIds, termIds)');
    expect(batch).toContain('destinations.size');
    expect(batch).toContain('containsText');
    expect(batch).toContain('flattenMaterialAlbumTree');
    expect(batch).not.toContain('FolderPlusIcon');
    expect(membership).toContain('flattenMaterialAlbumTree');
    expect(membership).toContain('if (albumRows.length === 0) return null');
    expect(gallery).toContain('createAlbumAndCollect');
    expect(gallery).toContain('materialAlbumsCreate');
    expect(gallery).toContain('materialAlbumsAddMany');
  });

  it('does not expose creation/album conversion actions or IPC', () => {
    const creator = read('src/renderer/components/CreatorScreen.tsx');
    const library = read('src/renderer/components/creator/ResultLibrary.tsx');
    const detail = read('src/renderer/components/gallery/AlbumDetailHeader.tsx');
    const contracts = read('src/shared/contracts.ts');
    const ipc = read('src/main/ipc.ts');

    expect(library).not.toContain("id: 'convert-to-album'");
    expect(library).not.toContain("id: 'convert-to-creation'");
    expect(detail).not.toContain("id: 'convert-to-creation'");
    expect(creator).not.toContain("kind: 'CREATION_SESSION'");
    expect(creator).not.toContain('materialCollectionsCreateCreationGroup');
    expect(contracts).not.toContain("kind: 'CREATION_SESSION'");
    expect(ipc).not.toContain('material-collections:create-creation-group');
  });
});
