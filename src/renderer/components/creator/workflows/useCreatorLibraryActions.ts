import { useRef, useState } from 'react';
import { copyCreationTarget } from '@/renderer/components/albums/copyCreationTarget';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { AlbumDto, Locale, VideoDocumentDto } from '@/shared/contracts';
import { createSerialTaskQueue } from '@/renderer/lib/serialTaskQueue';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { articleManagementError } from '@/renderer/components/creator/articleManagementError';

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

export function useCreatorLibraryActions(options: Options) {
  const { messages } = useI18n();
  const messageFor = (reason: unknown) => articleManagementError(reason, messages.creator.album);
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
    async (parent: AlbumDto | null, title: string, destination: AlbumDestination = 'LIBRARY') => {
      if (busyRef.current || blocked()) return false;
      busyRef.current = true;
      setBusy(true);
      let persisted = false;
      try {
        const album = await window.desktopApi.albumsCreate({
          title,
          titleLocale: options.locale,
          parentAlbumId: parent?.id ?? null,
        });
        persisted = true;
        await refreshAlbums();
        await albumCreated(album.id, destination);
      } catch (reason) {
        const message = persisted ? messages.creator.album.albumCreatedRefreshFailed : options.operationFailedMessage;
        notify(`${message}: ${messageFor(reason)}`);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      // A refresh/navigation failure must not offer a retry that creates a second album.
      return persisted;
    },
  );

  const toggleAlbumPin = useStableCallback(async (album: AlbumDto) =>
    runBusy(async () => {
      await window.desktopApi.albumsSetPinned({ albumId: album.id, pinned: !album.pinned });
      await refreshAlbums();
    }),
  );

  const toggleCreationItemPin = useStableCallback(
    async (creationItemId: string, pinned: boolean, articleFormId?: string) =>
      runBusy(async () => {
        await window.desktopApi.creationItemSetPinned({ creationItemId, pinned, articleFormId });
        await refresh();
      }),
  );

  const moveAlbum = useStableCallback(async (albumId: string, parentAlbumId: string | null, copy = false) => {
    if (busyRef.current || blocked()) return;
    return moveQueue.enqueue(async () => {
      try {
        if (copy) await copyCreationTarget('ALBUM', albumId, parentAlbumId);
        else await window.desktopApi.albumsMove({ albumId, parentAlbumId });
        if (copy) await refresh();
        else await refreshAlbums();
        notify(copy ? messages.creator.outline.copied(1) : options.albumMovedMessage);
      } catch (reason) {
        notify(`${options.operationFailedMessage}: ${messageFor(reason)}`);
        throw reason;
      }
    });
  });

  const moveCreationItem = useStableCallback(
    async (creationItemId: string, albumId: string | null, copy = false, articleFormId?: string) => {
      if (busyRef.current || blocked()) return;
      return moveQueue.enqueue(async () => {
        try {
          if (copy) await copyCreationTarget('CREATION_ITEM', creationItemId, albumId);
          else await window.desktopApi.creationItemMove({ creationItemId, albumId, articleFormId });
          await refresh();
          notify(
            copy
              ? messages.creator.outline.copied(1)
              : albumId
                ? options.albumMemberAddedMessage
                : options.albumMemberRemovedMessage,
          );
        } catch (reason) {
          await refresh().catch(() => undefined);
          notify(`${options.operationFailedMessage}: ${messageFor(reason)}`);
          throw new Error(messageFor(reason));
        }
      });
    },
  );

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
