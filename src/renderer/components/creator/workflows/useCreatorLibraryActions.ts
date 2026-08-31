import { useRef, useState } from 'react';
import type { AlbumDto, Locale, VideoDocumentDto } from '@/shared/contracts';
import { createSerialTaskQueue } from '@/renderer/lib/serialTaskQueue';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type AlbumDestination = 'LIBRARY' | 'NEW_CREATION';

interface Options {
  albumCreated(albumId: string, destination: AlbumDestination): Promise<void>;
  albumMovedMessage: string;
  albumRenamedMessage: string;
  albumMemberAddedMessage: string;
  albumMemberRemovedMessage: string;
  blocked(): boolean;
  locale: Locale;
  notify(message: string): void;
  onDocumentRenamed(document: VideoDocumentDto): void;
  operationFailedMessage: string;
  refresh(): Promise<void>;
  refreshAlbums(): Promise<void>;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useCreatorLibraryActions(options: Options) {
  const [busy, setBusy] = useState(false);
  const [moveQueue] = useState(createSerialTaskQueue);
  const busyRef = useRef(false);
  const albumCreated = useStableCallback(options.albumCreated);
  const blocked = useStableCallback(options.blocked);
  const notify = useStableCallback(options.notify);
  const onDocumentRenamed = useStableCallback(options.onDocumentRenamed);
  const refresh = useStableCallback(options.refresh);
  const refreshAlbums = useStableCallback(options.refreshAlbums);

  const runBusy = useStableCallback(async (task: () => Promise<void>) => {
    if (busyRef.current || blocked()) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } catch (reason) {
      notify(`${options.operationFailedMessage}: ${messageFor(reason)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  });

  const renameAlbum = useStableCallback(async (album: AlbumDto, title: string) => {
    await window.desktopApi.albumsRename({ albumId: album.id, title, locale: options.locale });
    await refreshAlbums();
    notify(options.albumRenamedMessage);
  });

  const renameDocument = useStableCallback(async (documentId: string, title: string) => {
    onDocumentRenamed(await window.desktopApi.videoDocumentRename({ documentId, title }));
  });

  const createAlbum = useStableCallback(
    async (parent: AlbumDto | null, title: string, destination: AlbumDestination = 'LIBRARY') =>
      runBusy(async () => {
        const created = await window.desktopApi.albumsCreate({
          title,
          titleLocale: options.locale,
          parentAlbumId: parent?.id ?? null,
        });
        await refreshAlbums();
        await albumCreated(created.id, destination);
      }),
  );

  const toggleAlbumPin = useStableCallback(async (album: AlbumDto) =>
    runBusy(async () => {
      await window.desktopApi.albumsSetPinned({ albumId: album.id, pinned: !album.pinned });
      await refreshAlbums();
    }),
  );

  const toggleCreationItemPin = useStableCallback(async (creationItemId: string, pinned: boolean) =>
    runBusy(async () => {
      await window.desktopApi.creationItemSetPinned({ creationItemId, pinned });
      await refresh();
    }),
  );

  const moveAlbum = useStableCallback(async (albumId: string, parentAlbumId: string | null) => {
    if (busyRef.current || blocked()) return;
    return moveQueue.enqueue(async () => {
      try {
        await window.desktopApi.albumsMove({ albumId, parentAlbumId });
        await refreshAlbums();
        notify(options.albumMovedMessage);
      } catch (reason) {
        notify(`${options.operationFailedMessage}: ${messageFor(reason)}`);
        throw reason;
      }
    });
  });

  const moveCreationItem = useStableCallback(async (creationItemId: string, albumId: string | null) => {
    if (busyRef.current || blocked()) return;
    return moveQueue.enqueue(async () => {
      try {
        await window.desktopApi.creationItemMove({ creationItemId, albumId });
        await refresh();
        notify(albumId ? options.albumMemberAddedMessage : options.albumMemberRemovedMessage);
      } catch (reason) {
        await refresh().catch(() => undefined);
        notify(`${options.operationFailedMessage}: ${messageFor(reason)}`);
        throw reason;
      }
    });
  });

  return {
    busy,
    createAlbum,
    moveAlbum,
    moveCreationItem,
    renameAlbum,
    renameDocument,
    toggleAlbumPin,
    toggleCreationItemPin,
  };
}
