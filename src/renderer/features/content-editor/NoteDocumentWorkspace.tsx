import type { RefObject } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { ContentDocumentWorkspace } from '@/renderer/features/content-editor/ContentDocumentWorkspace';
import { NoteDocumentInput } from '@/renderer/features/content-editor/NoteDocumentInput';
import { NoteMediaPanel } from '@/renderer/features/content-editor/NoteMediaPanel';
import { NoteTitleInput } from '@/renderer/features/content-editor/NoteTitleInput';
import type { useNoteComments } from '@/renderer/features/content-editor/useNoteComments';
import { NoteFileInput } from '@/renderer/features/desktop-petals/NoteFileInput';
import { PetalFileAttachments } from '@/renderer/features/desktop-petals/PetalFileAttachments';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import type { usePetalFiles } from '@/renderer/features/desktop-petals/use-petal-files';
import type { useNoteMediaIntake } from '@/renderer/features/content-editor/useNoteMediaIntake';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useI18n } from '@/renderer/i18n/useI18n';
import { sameArticleElementPlacements } from '@/shared/contracts/article';

export function NoteDocumentWorkspace({
  activePanel,
  comments,
  editorHandle,
  fileInput,
  files,
  libraryId,
  panelsOpen,
  mediaIntake,
  scrollRoot,
  session,
  stashId,
  state,
  onActivePanelChange,
  onError,
  onPanelsOpenChange,
  onSaved,
}: {
  activePanel: string;
  comments: ReturnType<typeof useNoteComments>;
  editorHandle: RefObject<VideoDocumentWysiwygEditorHandle | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  files: ReturnType<typeof usePetalFiles>;
  libraryId: string;
  panelsOpen: boolean;
  mediaIntake: ReturnType<typeof useNoteMediaIntake>;
  scrollRoot: RefObject<HTMLDivElement | null>;
  session: NoteEditSession;
  stashId: string;
  state: ReturnType<NoteEditSession['getSnapshot']>;
  onActivePanelChange(panel: string): void;
  onError(reason: unknown): void;
  onPanelsOpenChange(open: boolean): void;
  onSaved(): void;
}) {
  const messages = useI18n().messages;
  const copy = messages.desktopPetals;
  const editorCopy = messages.contentEditor;
  return (
    <>
      <ContentDocumentWorkspace
        documentWidth="STANDARD"
        scrollRootRef={scrollRoot}
        title={<NoteTitleInput document session={session} state={state} readOnly={state.frozen} />}
        sidePanel={
          <ContentWorkspacePanels
            preferenceKey="note"
            active={activePanel}
            open={panelsOpen}
            onActiveChange={onActivePanelChange}
            onOpenChange={onPanelsOpenChange}
            tabs={[
              {
                id: 'MEDIA',
                label: editorCopy.media,
                count: state.referenceAssetIds.length,
                content: (
                  <NoteMediaPanel
                    note={{
                      ...state.note,
                      references: state.referenceAssetIds.map((id) => ({
                        assetId: id,
                        mediaUrl: `aiy-media://asset/${encodeURIComponent(id)}`,
                      })),
                    }}
                    disabled={state.frozen}
                    intake={mediaIntake}
                  />
                ),
              },
              {
                id: 'COMMENTS',
                label: editorCopy.comments,
                count: comments.comments.filter((comment) => comment.status === 'OPEN').length,
                content: comments.panel,
              },
              {
                id: 'FILES',
                label: editorCopy.files,
                count: state.note.files?.length ?? 0,
                content: (
                  <>
                    <PetalFileAttachments
                      files={state.note.files ?? []}
                      libraryId={libraryId}
                      stashId={stashId}
                      disabled={state.frozen}
                      onOpen={files.open}
                      onRemove={async (id) => {
                        const result = await files.remove(id);
                        onSaved();
                        return result;
                      }}
                    />
                    <NoteFileInput
                      inputRef={fileInput}
                      onFiles={async (selected) => {
                        const result = await files.importFiles(selected);
                        onSaved();
                        return result;
                      }}
                      progress={files.progress}
                      onCancel={files.cancel}
                    />
                  </>
                ),
              },
            ]}
          />
        }
      >
        <NoteDocumentInput
          session={session}
          state={state}
          readOnly={state.frozen}
          articleElements={state.elements}
          articleElementControls={comments.controls}
          onArticleElementsChange={(elements, reason) => {
            if (sameArticleElementPlacements(state.elements, elements)) return;
            session.updateProjection(
              elements,
              editorHandle.current?.getArticleCommentAnchors() ?? [],
              reason === 'identity',
            );
          }}
          onHandleChange={(handle) => {
            editorHandle.current = handle;
          }}
          onError={() => onError(copy.document.failure)}
        />
        {state.status === 'error' && (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
            <span className="text-destructive">{state.error}</span>
            <Button size="xs" variant="ghost" onClick={() => void session.keepMine()}>
              {copy.note.keepMine}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void session.useSaved()}>
              {copy.note.useSaved}
            </Button>
          </div>
        )}
      </ContentDocumentWorkspace>
      {comments.popover}
    </>
  );
}
