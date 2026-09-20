import { useMemo, useState, type RefObject } from 'react';
import {
  ContentCommentPopover,
  type ContentCommentDraftPopover,
} from '@/renderer/features/content-editor/ContentCommentPopover';
import { ContentCommentsPanel } from '@/renderer/features/content-editor/ContentCommentsPanel';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import type { VideoDocumentArticleElementControls } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentCommentStatus } from '@/shared/contracts';
import type { NoteCommentMutationInput } from '@/shared/contracts/desktop-petals';

interface CommentDraft extends ContentCommentDraftPopover {
  anchor: NonNullable<ReturnType<VideoDocumentWysiwygEditorHandle['captureArticleCommentTarget']>>['anchor'];
}

export function useNoteComments({
  session,
  state,
  editorHandle,
  scrollRoot,
  panelOpen,
  onPanelOpen,
  onPanelToggle,
  notify,
}: {
  session: NoteEditSession;
  state: ReturnType<NoteEditSession['getSnapshot']>;
  editorHandle: RefObject<VideoDocumentWysiwygEditorHandle | null>;
  scrollRoot: RefObject<HTMLDivElement | null>;
  panelOpen: boolean;
  onPanelOpen(): void;
  onPanelToggle(): void;
  notify(reason: unknown): void;
}) {
  const copy = useI18n().messages.contentEditor.comment;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredRect, setHoveredRect] = useState<ContentCommentDraftPopover['rect'] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRect, setSelectedRect] = useState<ContentCommentDraftPopover['rect'] | null>(null);
  const comments = state.note.comments.map((comment) => ({
    ...comment,
    targetResolution: editorHandle.current?.getArticleCommentTargetResolution(comment.id) ?? comment.targetResolution,
  }));

  async function mutate(input: NoteCommentMutationInput) {
    if (busy) return null;
    setBusy(true);
    try {
      const result = await window.desktopApi.contentLibrary.noteCommentMutate(input);
      session.replaceComments(result.comments);
      return result;
    } catch (reason) {
      notify(reason);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function beginComment() {
    const target = editorHandle.current?.captureArticleCommentTarget();
    if (!target || busy) return;
    setDraft({ anchor: { ...target.anchor }, preview: target.preview, rect: target.rect });
    setHoveredId(null);
    setHoveredRect(null);
    setSelectedId(null);
    setSelectedRect(null);
  }

  async function submitComment(body: string) {
    const currentDraft = draft;
    const previousIds = new Set(comments.map((comment) => comment.id));
    if (!currentDraft || busy || !body.trim() || !(await session.flush())) return;
    const revisionId = session.getSnapshot().note.revisionId;
    const snapshot = editorHandle.current?.getPersistenceSnapshot();
    if (!revisionId || !snapshot) return;
    const result = await mutate({
      operation: 'CREATE',
      noteId: state.note.id,
      expectedRevisionId: revisionId,
      elements: snapshot.articleElements,
      anchor: currentDraft.anchor,
      preview: currentDraft.preview,
      body,
    });
    const created = result?.comments.find((comment) => !previousIds.has(comment.id));
    if (!created) return;
    setDraft(null);
    setSelectedId(created.id);
    setSelectedRect(currentDraft.rect);
    onPanelOpen();
  }

  function hover(commentId: string | null) {
    setHoveredId(commentId);
    setHoveredRect(commentId ? (editorHandle.current?.getArticleCommentAnchorRect(commentId) ?? null) : null);
  }

  function select(commentId: string, reveal = false) {
    const comment = comments.find((candidate) => candidate.id === commentId);
    if (!comment) return;
    if (reveal && comment.targetResolution !== 'MISSING') {
      const location = editorHandle.current?.resolveArticleCommentLocation(commentId) ?? {
        elementId: comment.anchor.startElementId,
        relativeOffset: comment.anchor.startOffset,
        blockIndex: comment.anchor.startBlockIndex,
      };
      if (scrollRoot.current) editorHandle.current?.revealArticleLocation(location, scrollRoot.current);
      else editorHandle.current?.focusArticleElement(location.elementId);
    }
    setDraft(null);
    setHoveredId(null);
    setHoveredRect(null);
    setSelectedId(commentId);
    setSelectedRect(editorHandle.current?.getArticleCommentAnchorRect(commentId) ?? null);
  }

  const status = (commentId: string, next: ContentCommentStatus) =>
    void mutate({ operation: 'SET_STATUS', noteId: state.note.id, commentId, status: next });
  const elementPreviews = useMemo(
    () => Object.fromEntries(state.elements.map((element) => [element.elementId, element.preview])),
    [state.elements],
  );
  const controls: VideoDocumentArticleElementControls = {
    comments,
    commentsOpen: panelOpen,
    hoveredCommentId: hoveredId,
    selectedCommentId: selectedId,
    editTrail: [],
    elementPreviews,
    busy,
    commentLabel: copy.quickAdd,
    commentsLabel: copy.list,
    historyLabel: copy.history,
    previousEditLabel: copy.previousEdit,
    nextEditLabel: copy.nextEdit,
    onAddComment: beginComment,
    onCommentHover: hover,
    onCommentSelect: select,
    onCommentsToggle: onPanelToggle,
    onEditTrailSelect: () => undefined,
    onPreviousEdit: () => undefined,
    onNextEdit: () => undefined,
  };

  return {
    busy,
    comments,
    controls,
    panel: (
      <ContentCommentsPanel
        busy={busy}
        comments={comments}
        hoveredId={hoveredId}
        selectedId={selectedId}
        onHover={hover}
        onSelect={(id) => select(id, true)}
        onStatusChange={status}
      />
    ),
    popover: (
      <ContentCommentPopover
        busy={busy}
        draft={draft}
        hovered={selectedId || draft ? null : (comments.find((comment) => comment.id === hoveredId) ?? null)}
        hoveredRect={hoveredRect}
        selected={comments.find((comment) => comment.id === selectedId) ?? null}
        selectedRect={selectedRect}
        onDelete={(commentId) => {
          void mutate({ operation: 'DELETE', noteId: state.note.id, commentId });
          setSelectedId(null);
          setSelectedRect(null);
        }}
        onDraftCancel={() => setDraft(null)}
        onDraftSubmit={(body) => void submitComment(body)}
        onHoverDismiss={() => hover(null)}
        onHoverEngage={select}
        onReply={async (commentId, body) =>
          (await mutate({ operation: 'ADD_REPLY', noteId: state.note.id, commentId, body })) !== null
        }
        onSelectedClose={() => {
          setSelectedId(null);
          setSelectedRect(null);
        }}
        onStatusChange={status}
        onUpdateBody={(commentId, body) =>
          void mutate({ operation: 'UPDATE_BODY', noteId: state.note.id, commentId, body })
        }
      />
    ),
  };
}
