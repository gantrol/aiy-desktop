import type { RefObject } from 'react';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { VideoDocumentCreationStarter } from '@/renderer/features/video-documents/VideoDocumentCreationStarter';
import { useI18n } from '@/renderer/i18n/useI18n';

export function NewCreationVideoWorkspace({
  model,
  inputScope,
}: {
  model: CreatorScreenViewModel;
  inputScope: RefObject<string>;
}) {
  const { app, draftInput, generation, selection } = model;
  const document = generation.promptDocument;
  const labels = useI18n().messages.creator.workNavigation;
  return (
    <VideoDocumentCreationStarter
      beforeCreate={async () => {
        const scope = inputScope.current;
        if (!(await draftInput.recovery.flush())) throw new Error(labels.openFailed);
        if (inputScope.current !== scope) throw new Error(labels.openFailed);
        const draft = await selection.creationDraftSession.saveDraftNow();
        if (inputScope.current !== scope) throw new Error(labels.openFailed);
        return { kind: 'DRAFT', id: draft.id };
      }}
      locale={app.locale}
      albums={app.data.albums}
      defaultAlbumId={selection.targetAlbumId}
      request={selection.videoCreationRequest}
      attachedVideos={document.videoAttachments}
      onRemoveAttachedVideo={(materialId) =>
        document.updateVideoAttachments((current) => current.filter((video) => video.materialId !== materialId))
      }
      onRequestChange={selection.setVideoCreationRequest}
      onLibraryChange={app.refreshAlbums}
      onCreated={(documentId, albumId) => app.onSelectDocument(documentId, albumId)}
      notify={app.notify}
    />
  );
}
