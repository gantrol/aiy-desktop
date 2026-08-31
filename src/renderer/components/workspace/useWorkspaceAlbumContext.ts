import { useCallback, useEffect, useState } from 'react';

type AlbumIdsByTab = Readonly<Record<string, string | null>>;

function setAlbumId(current: AlbumIdsByTab, tabId: string, albumId: string | null): AlbumIdsByTab {
  return current[tabId] === albumId ? current : { ...current, [tabId]: albumId };
}

export function useWorkspaceAlbumContext(spaceId: string | null, activeTabId: string | null) {
  const [creatorByTab, setCreatorByTab] = useState<AlbumIdsByTab>({});
  const [galleryByTab, setGalleryByTab] = useState<AlbumIdsByTab>({});

  useEffect(() => {
    setCreatorByTab({});
    setGalleryByTab({});
  }, [spaceId]);

  const setCreatorAlbum = useCallback((tabId: string, albumId: string | null) => {
    setCreatorByTab((current) => setAlbumId(current, tabId, albumId));
  }, []);
  const setGalleryAlbum = useCallback((tabId: string, albumId: string | null) => {
    setGalleryByTab((current) => setAlbumId(current, tabId, albumId));
  }, []);

  return {
    creatorAlbumId: activeTabId ? (creatorByTab[activeTabId] ?? null) : null,
    galleryAlbumId: activeTabId ? (galleryByTab[activeTabId] ?? null) : null,
    setCreatorAlbum,
    setGalleryAlbum,
  };
}
