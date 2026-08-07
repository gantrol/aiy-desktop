import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AlbumDto, AssetDto } from '../src/shared/contracts';
import { AlbumContentList } from '../src/renderer/components/creator/CreatorAlbumDetail';

vi.mock('../src/renderer/components/media/MediaStackPreview', () => ({
  getMediaStackHorizontalBounds: () => ({ right: 48 }),
  getMediaStackLayout: () => ({ containerWidth: 48 }),
  MediaStackPreview: () => createElement('span', { 'data-test-media-preview': true }),
}));

const asset: AssetDto = {
  id: 'asset-one',
  kind: 'GENERATED',
  width: 64,
  height: 64,
  mimeType: 'image/png',
  mediaUrl: 'data:image/png;base64,',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const album: AlbumDto = {
  id: 'album-one',
  title: 'Snapshot album',
  intent: '',
  creationDefaults: {
    schemaVersion: 1,
    recipes: [],
    dictionaryScope: { mode: 'ALL', sources: [], includeLocalTerms: true },
  },
  pinned: false,
  materialCount: 1,
  seriesCount: 0,
  previewAssets: [asset],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  activityAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  members: [
    {
      id: 'member-one',
      albumId: 'album-one',
      targetType: 'MATERIAL',
      targetId: 'material-one',
      sortOrder: 0,
      imageAsset: asset,
      materialText: null,
      seriesTitle: null,
      childAlbumTitle: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('creator album detail content list', () => {
  it('lists direct material members captured by creation-to-album conversion', () => {
    const html = renderToStaticMarkup(
      createElement(AlbumContentList, {
        album,
        childAlbums: [],
        sessions: [],
        albumBySeriesId: new Map(),
        locale: 'en',
        contentsLabel: 'Contents',
        onSelectAlbum: () => undefined,
        onSelectSeries: () => undefined,
        onOpenMaterial: () => undefined,
      }),
    );

    expect(html).toContain('data-album-direct-material');
    expect(html).toContain('Image material');
    expect(html).not.toContain('>0</span>');
  });
});
