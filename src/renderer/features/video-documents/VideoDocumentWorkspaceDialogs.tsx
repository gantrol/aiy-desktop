import type { AlbumDto, VideoDocumentDto } from '@/shared/contracts';
import type { VideoDocumentsLocation } from '@/renderer/components/app/app-navigation';
import { AlbumMoveDialog, type AlbumMoveTarget } from '@/renderer/components/albums/AlbumMoveDialog';
import { CreateAlbumDialog } from '@/renderer/components/albums/CreateAlbumDialog';
import { RenameAlbumDialog } from '@/renderer/components/creator/RenameAlbumDialog';
import { VideoDocumentRenameDialog } from '@/renderer/features/video-documents/VideoDocumentRenameDialog';
import {
  VideoDocumentStartDialog,
  type VideoDocumentStartConfiguration,
} from '@/renderer/features/video-documents/VideoDocumentStartDialog';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface VideoDocumentRenameRequest {
  id: string;
  title: string;
}

export interface VideoDocumentStartRequest {
  file: File;
  source: 'DROP' | 'UPLOAD';
}

interface Props {
  albums: AlbumDto[];
  location: VideoDocumentsLocation;
  document: VideoDocumentDto | null;
  moveTarget: AlbumMoveTarget | null;
  createAlbumParentId: string | null | undefined;
  renameAlbumId: string | null;
  renameDocument: VideoDocumentRenameRequest | null;
  startRequest: VideoDocumentStartRequest | null;
  onMoveTargetChange(target: AlbumMoveTarget | null): void;
  onCreateAlbumParentChange(albumId: string | null | undefined): void;
  onRenameAlbumIdChange(albumId: string | null): void;
  onRenameDocumentChange(request: VideoDocumentRenameRequest | null): void;
  onStartRequestChange(request: VideoDocumentStartRequest | null): void;
  onMoveAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  onMoveDocument(documentId: string, albumId: string | null): Promise<void>;
  onCreateAlbum(title: string, parentAlbumId: string | null): Promise<void>;
  onRenameAlbum(album: AlbumDto, title: string): Promise<void>;
  onRenameDocument(documentId: string, title: string): Promise<void>;
  onCreateDocument(configuration: VideoDocumentStartConfiguration): Promise<void>;
}

export function VideoDocumentWorkspaceDialogs({
  albums,
  location,
  document,
  moveTarget,
  createAlbumParentId,
  renameAlbumId,
  renameDocument,
  startRequest,
  onMoveTargetChange,
  onCreateAlbumParentChange,
  onRenameAlbumIdChange,
  onRenameDocumentChange,
  onStartRequestChange,
  onMoveAlbum,
  onMoveDocument,
  onCreateAlbum,
  onRenameAlbum,
  onRenameDocument,
  onCreateDocument,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  return (
    <>
      <AlbumMoveDialog
        albums={albums}
        target={moveTarget}
        labels={{
          title: labels.moveTitle,
          topLevel: labels.unfiled,
          operationFailed: labels.moveFailed,
        }}
        onOpenChange={(open) => {
          if (!open) onMoveTargetChange(null);
        }}
        onMove={async (albumId) => {
          if (!moveTarget) return;
          if (moveTarget.kind === 'ALBUM') await onMoveAlbum(moveTarget.id, albumId);
          else if (moveTarget.kind === 'DOCUMENT') await onMoveDocument(moveTarget.id, albumId);
        }}
      />
      <CreateAlbumDialog
        open={createAlbumParentId !== undefined}
        parentTitle={albums.find((album) => album.id === createAlbumParentId)?.title}
        labels={{
          title: messages.gallery.albums.createTitle,
          childTitle: messages.gallery.albums.createChild,
          name: messages.gallery.albums.name,
          placeholder: messages.gallery.albums.namePlaceholder,
          cancel: messages.gallery.albums.cancel,
          create: messages.gallery.albums.create,
          operationFailed: messages.gallery.albums.operationFailed,
        }}
        onOpenChange={(open) => {
          if (!open) onCreateAlbumParentChange(undefined);
        }}
        onCreate={(title) => onCreateAlbum(title, createAlbumParentId ?? null)}
      />
      <RenameAlbumDialog
        album={albums.find((album) => album.id === renameAlbumId) ?? null}
        open={Boolean(renameAlbumId)}
        onOpenChange={(open) => {
          if (!open) onRenameAlbumIdChange(null);
        }}
        onSave={onRenameAlbum}
      />
      <VideoDocumentRenameDialog
        open={Boolean(renameDocument)}
        title={renameDocument?.title ?? ''}
        onOpenChange={(open) => {
          if (!open) onRenameDocumentChange(null);
        }}
        onSave={async (nextTitle) => {
          if (renameDocument) await onRenameDocument(renameDocument.id, nextTitle);
        }}
      />
      <VideoDocumentStartDialog
        open={Boolean(startRequest)}
        file={startRequest?.file ?? null}
        source={startRequest?.source ?? 'UPLOAD'}
        albums={albums}
        defaultAlbumId={
          location.collection.kind === 'album' ? location.collection.albumId : (document?.albumId ?? null)
        }
        onOpenChange={(open) => {
          if (!open) onStartRequestChange(null);
        }}
        onCreate={onCreateDocument}
      />
    </>
  );
}
