import { useEffect, useState } from 'react';
import type { GalleryItemDto, Locale } from '@/shared/contracts';

const PAGE_SIZE = 60;
const MAX_PAGES = 5;
const MAX_VIDEOS = 16;

function isSelectableVideo(item: GalleryItemDto) {
  return Boolean(item.materialId && (item.materialKind === 'VIDEO' || item.asset.mimeType.startsWith('video/')));
}

export function useRecentVideoMaterials(locale: Locale) {
  const [items, setItems] = useState<GalleryItemDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setItems([]);
    setLoading(true);

    void (async () => {
      const videos: GalleryItemDto[] = [];
      const assetIds = new Set<string>();
      let cursor: string | null = null;
      let knownTotal: number | undefined;

      for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
        const page = await window.desktopApi.galleryList({
          locale,
          source: 'MATERIAL',
          unratedDimensions: [],
          cursor,
          knownTotal,
          limit: PAGE_SIZE,
        });
        knownTotal ??= page.total;
        for (const item of page.items) {
          if (!isSelectableVideo(item) || assetIds.has(item.asset.id)) continue;
          assetIds.add(item.asset.id);
          videos.push(item);
          if (videos.length >= MAX_VIDEOS) break;
        }
        if (videos.length >= MAX_VIDEOS || !page.nextCursor) break;
        cursor = page.nextCursor;
      }

      if (alive) setItems(videos);
    })()
      .catch(() => {
        if (alive) setItems([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [locale]);

  return { items, loading };
}
