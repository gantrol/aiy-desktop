import { useState } from 'react';
import type { AlbumDto, Locale, VideoDocumentDto, VideoDocumentGenerationRunDto } from '@/shared/contracts';
import type { NavigationMode, VideoDocumentsLocation } from '@/renderer/components/app/app-navigation';
import { createVideoDocument } from '@/renderer/features/video-documents/createVideoDocument';
import type { VideoDocumentStartConfiguration } from '@/renderer/features/video-documents/VideoDocumentStartDialog';

interface Options {
  locale: Locale;
  location: VideoDocumentsLocation;
  document: VideoDocumentDto | null;
  title: string;
  selectedDocumentIdRef: { current: string | null };
  importFailedLabel: string;
  transcriptRequiredLabel: string;
  onNavigate(location: VideoDocumentsLocation, mode?: NavigationMode): void;
  onAlbumsChange(): void | Promise<void>;
  notify(message: string): void;
  formatGenerationError(run: VideoDocumentGenerationRunDto): string;
  setDocument(document: VideoDocumentDto): void;
  setTitle(title: string): void;
  updateSummary(document: VideoDocumentDto): void;
  refreshDocumentList(): void;
  refreshNavigation(): void;
}

export function useVideoDocumentLibraryActions({
  locale,
  location,
  document,
  title,
  selectedDocumentIdRef,
  importFailedLabel,
  transcriptRequiredLabel,
  onNavigate,
  onAlbumsChange,
  notify,
  formatGenerationError,
  setDocument,
  setTitle,
  updateSummary,
  refreshDocumentList,
  refreshNavigation,
}: Options) {
  const [savingTitle, setSavingTitle] = useState(false);

  async function saveTitle() {
    if (!document || savingTitle) return;
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === document.title) {
      setTitle(document.title);
      return;
    }
    setSavingTitle(true);
    try {
      const updated = await window.desktopApi.videoDocumentRename({ documentId: document.id, title: nextTitle });
      setDocument(updated);
      setTitle(updated.title);
      updateSummary(updated);
      refreshNavigation();
    } catch (reason) {
      setTitle(document.title);
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingTitle(false);
    }
  }

  async function moveDocument(documentId: string, albumId: string | null) {
    const updated = await window.desktopApi.videoDocumentMove({ documentId, albumId });
    if (document?.id === documentId) {
      setDocument(updated);
      setTitle(updated.title);
    }
    updateSummary(updated);
    refreshNavigation();
    void Promise.resolve(onAlbumsChange()).catch((reason) =>
      notify(reason instanceof Error ? reason.message : String(reason)),
    );
    if (location.documentId === documentId) {
      onNavigate(
        {
          collection: albumId ? { kind: 'album', albumId } : { kind: 'unfiled' },
          documentId,
        },
        'replace',
      );
    }
  }

  async function moveAlbum(albumId: string, parentAlbumId: string | null) {
    await window.desktopApi.albumsMove({ albumId, parentAlbumId });
    await Promise.resolve(onAlbumsChange());
    refreshNavigation();
  }

  async function createAlbum(title: string, parentAlbumId: string | null) {
    await window.desktopApi.albumsCreate({ title, titleLocale: locale, parentAlbumId });
    await Promise.resolve(onAlbumsChange());
    refreshNavigation();
  }

  async function renameAlbum(album: AlbumDto, nextTitle: string) {
    await window.desktopApi.albumsRename({ albumId: album.id, title: nextTitle, locale });
    await Promise.resolve(onAlbumsChange());
    refreshNavigation();
  }

  async function renameDocument(documentId: string, nextTitle: string) {
    const updated = await window.desktopApi.videoDocumentRename({ documentId, title: nextTitle });
    if (selectedDocumentIdRef.current === documentId) {
      setDocument(updated);
      setTitle(updated.title);
    }
    updateSummary(updated);
    refreshNavigation();
  }

  async function createDocument(configuration: VideoDocumentStartConfiguration) {
    const created = await createVideoDocument({
      configuration,
      locale,
      importFailedLabel,
      transcriptRequiredLabel,
      notify,
      formatGenerationError,
    });
    refreshDocumentList();
    refreshNavigation();
    await Promise.resolve(onAlbumsChange());
    onNavigate({
      collection: created.albumId ? { kind: 'album', albumId: created.albumId } : { kind: 'unfiled' },
      documentId: created.id,
    });
  }

  return {
    savingTitle,
    saveTitle,
    moveDocument,
    moveAlbum,
    createAlbum,
    renameAlbum,
    renameDocument,
    createDocument,
  };
}
