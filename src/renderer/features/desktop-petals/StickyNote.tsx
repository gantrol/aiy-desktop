import { leavePetalEditor } from '@/renderer/features/desktop-petals/petal-editor-leave';
import { Button } from '@/renderer/components/ui/button';
import { ModalOverlayScope } from '@/renderer/components/ui/overlay-layer';
import { ContentAlbumSelect } from '@/renderer/features/content-editor/ContentAlbumSelect';
import { NoteAttachmentStrip } from '@/renderer/features/content-editor/NoteAttachmentStrip';
import { NoteDocumentInput } from '@/renderer/features/content-editor/NoteDocumentInput';
import { NoteTitleInput } from '@/renderer/features/content-editor/NoteTitleInput';
import { CollapsedPetal } from '@/renderer/features/desktop-petals/CollapsedPetal';
import { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import { NoteResizeHandle } from '@/renderer/features/desktop-petals/NoteResizeHandle';
import { NoteAppearanceMenu } from '@/renderer/features/desktop-petals/NoteAppearanceMenu';
import { noteAppearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { PetalExternalApplications } from '@/renderer/features/desktop-petals/PetalExternalApplications';
import { PetalNoteActions } from '@/renderer/features/desktop-petals/PetalNoteActions';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { PetalNoteRecovery } from '@/renderer/features/desktop-petals/PetalNoteRecovery';
import { PetalReferenceAdd } from '@/renderer/features/desktop-petals/PetalReferences';
import { StickyNoteSurface } from '@/renderer/features/desktop-petals/StickyNoteSurface';
import { usePetalReferences } from '@/renderer/features/desktop-petals/use-petal-references';
import { usePetalFiles } from '@/renderer/features/desktop-petals/use-petal-files';
import { PetalFileAttachments } from '@/renderer/features/desktop-petals/PetalFileAttachments';
import { NoteFileInput } from '@/renderer/features/desktop-petals/NoteFileInput';
import { noteFileCapture } from '@/renderer/features/desktop-petals/note-file-capture';
import { useCodexAgentSignal } from '@/renderer/features/extensions/codex-content/CodexAgentLight';
import { CodexNoteProvider } from '@/renderer/features/extensions/codex-content/CodexNoteContext';
import { CODEX_CONTENT_APPLICATION_ID } from '@/shared/contracts/content-applications';
import { sameArticleElementPlacements } from '@/shared/contracts/article';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalLabel } from '@/shared/petal-preview';
import type { DesktopNote, DesktopPetalSnapshot, PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';
import { ALargeSmall } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function StickyNote({ initialNote, snapshot }: { initialNote: DesktopNote; snapshot: DesktopPetalSnapshot }) {
  return (
    <CodexNoteProvider
      stashId={initialNote.stashId}
      persisted={initialNote.persisted}
      available={snapshot.contentApplications.some(
        (item) => item.id === CODEX_CONTENT_APPLICATION_ID && item.available,
      )}
    >
      <StickyNoteSession initialNote={initialNote} snapshot={snapshot} />
    </CodexNoteProvider>
  );
}

function StickyNoteSession({ initialNote, snapshot }: { initialNote: DesktopNote; snapshot: DesktopPetalSnapshot }) {
  const signal = useCodexAgentSignal();
  const { messages } = useI18n();
  const copy = messages.desktopPetals;
  const [session] = useState(() => new NoteEditSession(initialNote, snapshot.draft, window.desktopPetals));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [appearanceError, setAppearanceError] = useState('');
  const [formatting, setFormatting] = useState(false);
  const [toolbarRoot, setToolbarRoot] = useState<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const finishingCollapse = useRef(false);
  const leaveRequest = useRef(0);
  const editorHandle = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
  const onError = useCallback((reason: unknown) => setAppearanceError(String(reason)), []);
  const references = usePetalReferences(session, onError);
  const { settle } = references;
  const fileInput = useRef<HTMLInputElement>(null);
  const files = usePetalFiles(
    session,
    async () => {
      if (editorHandle.current && !(await editorHandle.current.whenSettled())) return false;
      return settle();
    },
    onError,
  );
  const settleFiles = files.settle;
  const prepare = async () => {
    if (!(await settleFiles())) return null;
    if (editorHandle.current && !(await editorHandle.current.whenSettled())) return null;
    if (!(await settle())) return null;
    if (!(await session.flush())) return null;
    return session.getSnapshot().note;
  };
  useEffect(() => {
    session.receive(initialNote);
  }, [initialNote, session]);
  useEffect(() => {
    session.setFrozen(snapshot.suspended);
    setClosing(false);
    finishingCollapse.current = false;
    if (!snapshot.expanded) {
      setFormatting(false);
    }
  }, [session, snapshot.suspended, snapshot.expanded, snapshot.editEpoch]);
  useEffect(() => {
    let active = true;
    const unsubscribe = window.desktopPetals.onFlush((save, deadline) => {
      const request = ++leaveRequest.current;
      return leavePetalEditor(
        {
          settleFiles,
          settleEditor: async (requireRevision) => {
            const handle = editorHandle.current;
            return !handle || (await (requireRevision ? handle.whenSettled() : handle.whenRecoverable()));
          },
          settleReferences: settle,
          freeze: (value) => session.setFrozen(value),
          preserve: session.prepareToLeave,
          current: () => active && request === leaveRequest.current,
          deadline,
        },
        Boolean(save),
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [session, settle, settleFiles]);
  useEffect(() => () => session.dispose(), [session]);
  const appearance = async (patch: { color?: PetalColor; icon?: PetalIcon }) => {
    try {
      const note = await window.desktopPetals.appearance({ id: state.note.id, ...patch });
      session.receive(note);
      setAppearanceError('');
    } catch (error) {
      setAppearanceError(String(error));
    }
  };
  const finishCollapse = useCallback(async () => {
    if (finishingCollapse.current) return;
    finishingCollapse.current = true;
    try {
      await window.desktopPetals.expand(false);
    } catch (error) {
      finishingCollapse.current = false;
      setClosing(false);
      session.setFrozen(false);
      setAppearanceError(String(error));
    }
  }, [session]);
  useEffect(() => {
    if (!closing) return;
    // Animation cancellation, reduced motion changes and hidden windows must not trap the editor.
    const timer = setTimeout(() => void finishCollapse(), 240);
    return () => clearTimeout(timer);
  }, [closing, finishCollapse]);
  const collapse = async () => {
    if (closing || finishingCollapse.current) return;
    if (!(await settleFiles())) return;
    if (editorHandle.current && !(await editorHandle.current.whenRecoverable())) return;
    if (!(await settle()) || !(await session.checkpointForExit())) return;
    session.setFrozen(true);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) await finishCollapse();
    else setClosing(true);
  };
  const noteActions: PetalNoteMenuActions = {
    home: snapshot.home,
    alwaysOnTop: snapshot.alwaysOnTop,
    note: state.note,
    board: snapshot.board,
    persisted: state.note.persisted,
    disabled: snapshot.suspended || closing || state.frozen,
    beforeAction: () => session.flush(),
    onDuplicate: () =>
      window.desktopPetals.create({
        requestId: crypto.randomUUID(),
        stashId: state.note.stashId,
        duplicate: true,
      }),
    onAppearance: appearance,
    onError,
  };
  if (!snapshot.expanded) {
    const petalTitle =
      petalLabel(state.title, state.text) ||
      state.note.files?.[0]?.name ||
      (state.referenceAssetIds.length || state.note.importedImages?.length ? copy.board.IMAGE : copy.note.newTitle);
    return (
      <CollapsedPetal
        titlesVisible={snapshot.titlesVisible}
        color={state.note.color}
        icon={state.note.icon}
        label={copy.note.open.replace('{title}', petalTitle)}
        title={petalTitle}
        signal={signal}
        onOpen={() => void window.desktopPetals.expand(true).catch(onError)}
        onError={onError}
        menuActions={{ ...noteActions, onExpand: () => window.desktopPetals.expand(true) }}
        anchor={snapshot.flowerAnchor}
        menuPreview={snapshot.flowerPreview}
      />
    );
  }
  return (
    <ModalOverlayScope style={noteAppearanceStyle(state.note.color)}>
      <StickyNoteSurface
        color={state.note.color}
        icon={state.note.icon}
        editable={state.note.editable}
        closing={closing}
        appearance={<NoteAppearanceMenu {...noteActions} />}
        actions={<PetalNoteActions {...noteActions} onCollapse={collapse} />}
        onDragOver={references.onDragOver}
        {...noteFileCapture(files.importFiles)}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === 'note-close') void finishCollapse();
        }}
      >
        <NoteTitleInput
          session={session}
          state={state}
          compact
          readOnly={state.frozen || closing || !state.note.editable}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NoteDocumentInput
            session={session}
            state={state}
            articleElements={state.elements}
            onArticleElementsChange={(elements, reason) => {
              if (sameArticleElementPlacements(state.elements, elements)) return;
              session.updateProjection(elements, [], reason === 'identity');
            }}
            onHandleChange={(handle) => {
              editorHandle.current = handle;
            }}
            onError={() => onError(copy.document.failure)}
            compact
            embedded
            toolbarVisible={formatting}
            toolbarRoot={toolbarRoot}
            readOnly={!state.note.editable || state.frozen || closing}
            importImage={references.importImage}
          />
        </div>
        <NoteAttachmentStrip
          note={state.note}
          disabled={state.frozen || !state.note.editable || closing}
          markdown={state.text}
          format={state.format}
          onRemove={(assetId) => references.change({ kind: 'remove', assetId })}
        />
        <div ref={setToolbarRoot} className="shrink-0" />
        <PetalFileAttachments
          files={state.note.files ?? []}
          libraryId={snapshot.libraryId}
          stashId={state.note.stashId}
          disabled={state.frozen || closing || !state.note.editable}
          onOpen={files.open}
          onRemove={files.remove}
        />
        <NoteFileInput
          inputRef={fileInput}
          onFiles={files.importFiles}
          progress={files.progress}
          onCancel={files.cancel}
        />
        <footer className="flex shrink-0 items-center gap-0.5 px-3 py-1.5">
          <ContentAlbumSelect
            defaultWhenUnassigned={!state.note.persisted}
            albumId={state.note.albumId}
            disabled={state.frozen || closing}
            onError={onError}
            onChange={async (albumId) => {
              if (!(await session.flush())) throw new Error(copy.note.unsaved);
              session.receive(await window.desktopPetals.setAlbum({ id: state.note.id, albumId }));
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-inherit"
            aria-label={copy.document.format}
            title={copy.document.format}
            aria-pressed={formatting}
            onClick={() => setFormatting((open) => !open)}
          >
            <ALargeSmall className="size-4" />
          </Button>
          <PetalReferenceAdd
            note={state.note}
            disabled={state.frozen || !state.note.editable || closing}
            onChange={references.change}
            onError={onError}
            onAddFiles={() => fileInput.current?.click()}
          />
        </footer>
        <PetalExternalApplications
          applications={snapshot.contentApplications}
          note={state.note}
          prepare={prepare}
          disabled={state.frozen || closing}
          onError={onError}
        />
        <PetalNoteRecovery session={session} state={state} appearanceError={appearanceError} />
        <NoteResizeHandle disabled={state.frozen || closing} onError={onError} />
      </StickyNoteSurface>
    </ModalOverlayScope>
  );
}
