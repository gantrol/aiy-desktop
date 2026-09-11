import { Button } from '@/renderer/components/ui/button';
import { registerWorkspaceDrain } from '@/renderer/components/workspace/workspace-drain';
import { ContentAlbumSelect } from '@/renderer/features/content-editor/ContentAlbumSelect';
import { NoteDocumentWorkspace } from '@/renderer/features/content-editor/NoteDocumentWorkspace';
import { ContentDocumentToolbar } from '@/renderer/features/content-editor/ContentDocumentWorkspace';
import { useNoteComments } from '@/renderer/features/content-editor/useNoteComments';
import { useNoteMediaIntake } from '@/renderer/features/content-editor/useNoteMediaIntake';
import { usePetalFiles } from '@/renderer/features/desktop-petals/use-petal-files';
import { noteFileCapture } from '@/renderer/features/desktop-petals/note-file-capture';
import { petalErrorText } from '@/shared/petal-errors';
import { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import { PinNoteButton } from '@/renderer/features/desktop-petals/PinNoteButton';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { AlbumDto, InspirationStashDto } from '@/shared/contracts';
import type { DesktopNote, DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { FolderOpen, LoaderCircle, Save, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

interface Props {
  libraryId: string;
  stash: InspirationStashDto;
  albums: readonly AlbumDto[];
  refresh(): Promise<void>;
  notify(message: string): void;
  onEditMaterials?(note: DesktopNote): Promise<void>;
}

function NoteEditorSession({
  libraryId,
  initial,
  draft,
  stash,
  albums,
  refresh,
  notify,
  onEditMaterials,
}: Props & { initial: DesktopNote; draft: DesktopPetalSnapshot['draft'] }) {
  const { locale, messages } = useI18n();
  const copy = messages.desktopPetals;
  const onSaved = useStableCallback(() => {
    void refresh().catch((reason) => notify(String(reason)));
  });
  const [session] = useState(
    () =>
      new NoteEditSession(initial, draft, {
        checkpoint: window.desktopApi.contentLibrary.noteCheckpoint,
        save: async (input) => {
          const result = await window.desktopApi.contentLibrary.noteSave(input);
          onSaved();
          return result;
        },
      }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const editorHandle = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [activePanel, setActivePanel] = useState('MEDIA');
  const [panelsOpen, setPanelsOpen] = useState(true);
  const files = usePetalFiles(
    session,
    async () => !editorHandle.current || editorHandle.current.whenSettled(),
    (reason) => notify(petalErrorText(reason, copy.errors)),
  );
  const settleFiles = files.settle;
  const mediaIntake = useNoteMediaIntake({ editorHandle, locale, notify, session });
  const settleMedia = mediaIntake.settle;
  const comments = useNoteComments({
    session,
    state,
    editorHandle,
    scrollRoot,
    panelOpen: panelsOpen && activePanel === 'COMMENTS',
    onPanelOpen: () => {
      setActivePanel('COMMENTS');
      setPanelsOpen(true);
    },
    onPanelToggle: () => {
      if (panelsOpen && activePanel === 'COMMENTS') setPanelsOpen(false);
      else {
        setActivePanel('COMMENTS');
        setPanelsOpen(true);
      }
    },
    notify: (reason) => notify(String(reason)),
  });
  const lastSourceHash = useRef(`${stash.contentHash}:${stash.albumId}`);
  useEffect(() => {
    const identity = `${stash.contentHash}:${stash.albumId}`;
    if (identity === lastSourceHash.current) return;
    lastSourceHash.current = identity;
    const current = session.getSnapshot().note;
    session.receive({
      ...current,
      text: stash.content.manualPrompt,
      format: stash.content.format,
      document: stash.content.document,
      title: stash.content.title ?? '',
      displayTitle: stash.displayTitle,
      contentHash: stash.contentHash,
      albumId: stash.albumId,
      references: stash.content.referenceAssets.map((asset) => ({ assetId: asset.id, mediaUrl: asset.mediaUrl })),
      files: stash.content.files,
    });
  }, [stash, session]);
  useEffect(
    () =>
      registerWorkspaceDrain(async () => {
        if (!(await settleFiles())) throw new Error(copy.note.unsaved);
        await settleMedia();
        if (editorHandle.current && !(await editorHandle.current.whenRecoverable())) throw new Error(copy.note.unsaved);
        if (!(await session.checkpointForExit())) throw new Error(copy.note.unsaved);
      }),
    [session, copy.note.unsaved, settleFiles, settleMedia],
  );
  useEffect(() => () => session.dispose(), [session]);
  const error = useStableCallback((reason: unknown) => notify(String(reason)));
  return (
    <div
      data-content-source={JSON.stringify({ kind: 'INSPIRATION_STASH', id: stash.id })}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      {...noteFileCapture((selected) => files.importFiles(selected).then(onSaved))}
    >
      <ContentDocumentToolbar>
        <ContentAlbumSelect
          albumId={state.note.albumId}
          albums={albums.filter((album) => !album.archivedAt)}
          onError={error}
          onChange={async (albumId) => {
            if (!(await settleFiles())) throw new Error(copy.note.unsaved);
            if (!(await session.flush())) throw new Error(copy.note.unsaved);
            const moved = await window.desktopApi.inspirationStashMove({ id: stash.id, albumId });
            session.receive({ ...session.getSnapshot().note, albumId: moved.albumId });
            await refresh();
          }}
        />
        <div className="flex-1" />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={state.frozen}
          title={copy.files.add}
          aria-label={copy.files.add}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        {onEditMaterials && (
          <Button
            data-action="edit-note-materials"
            size="sm"
            variant="ghost"
            onClick={() =>
              void (async () => {
                if (!(await settleFiles())) throw new Error(copy.note.unsaved);
                if (editorHandle.current && !(await editorHandle.current.whenSettled()))
                  throw new Error(copy.note.unsaved);
                if (!(await session.flush())) throw new Error(copy.note.unsaved);
                await onEditMaterials(session.getSnapshot().note);
              })().catch(error)
            }
          >
            {copy.document.materials}
          </Button>
        )}
        <PinNoteButton stashId={stash.id} saved={state.status === 'saved'} notify={notify} />
        <Button
          size="icon-sm"
          variant="ghost"
          title={copy.document.reveal}
          aria-label={copy.document.reveal}
          onClick={() =>
            void (async () => {
              if (!(await session.flush())) throw new Error(copy.note.unsaved);
              await window.desktopApi.contentLibrary.reveal({ kind: 'INSPIRATION_STASH', id: stash.id });
            })().catch(error)
          }
        >
          <FolderOpen className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title={copy.document.save}
          aria-label={copy.document.save}
          disabled={state.status === 'saving'}
          onClick={() => void session.flush()}
        >
          {state.status === 'saving' ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
        </Button>
      </ContentDocumentToolbar>
      <NoteDocumentWorkspace
        activePanel={activePanel}
        comments={comments}
        editorHandle={editorHandle}
        fileInput={fileInput}
        files={files}
        libraryId={libraryId}
        panelsOpen={panelsOpen}
        mediaIntake={mediaIntake}
        scrollRoot={scrollRoot}
        session={session}
        stashId={stash.id}
        state={state}
        onActivePanelChange={setActivePanel}
        onError={error}
        onPanelsOpenChange={setPanelsOpen}
        onSaved={onSaved}
      />
    </div>
  );
}

export function NoteContentEditor(props: Props) {
  const copy = useI18n().messages.desktopPetals;
  const [loaded, setLoaded] = useState<{ note: DesktopNote; draft: DesktopPetalSnapshot['draft'] } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void window.desktopApi.contentLibrary
      .noteOpen(props.stash.id)
      .then((value) => {
        if (live) setLoaded(value);
      })
      .catch((reason) => {
        if (live) setError(String(reason));
      });
    return () => {
      live = false;
    };
  }, [props.stash.id]);
  return loaded?.note.stashId === props.stash.id ? (
    <NoteEditorSession key={props.stash.id} {...props} initial={loaded.note} draft={loaded.draft} />
  ) : (
    <div role="status" className="p-4 text-sm">
      {error || copy.note.saving}
    </div>
  );
}
