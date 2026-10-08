import { useRef, type RefObject } from 'react';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';

/** Changing persistence scope keeps the window and restores the editor's block-relative caret and viewport. */
export function useTemporaryNotePromotion({
  session,
  editor,
  scrollRoot,
  prepare,
}: {
  session: NoteEditSession;
  editor: RefObject<VideoDocumentWysiwygEditorHandle | null>;
  scrollRoot: RefObject<HTMLDivElement | null>;
  prepare(): Promise<DesktopNote | null>;
}) {
  const position = useRef<{
    location: ReturnType<VideoDocumentWysiwygEditorHandle['captureArticleLocation']>;
    scrollTop: number;
  } | null>(null);
  return {
    async promote() {
      if (!(await prepare())) return;
      position.current = {
        location: editor.current?.captureArticleLocation() ?? null,
        scrollTop: scrollRoot.current?.scrollTop ?? 0,
      };
      if (!session.setFrozen(true)) return;
      try {
        const note = session.getSnapshot().note;
        await window.desktopPetals.temporaryFiles({ kind: 'promote', id: note.id, expectedHash: note.contentHash });
      } catch (error) {
        position.current = null;
        throw error;
      } finally {
        session.setFrozen(false);
      }
    },
    restore(handle: VideoDocumentWysiwygEditorHandle | null) {
      if (!handle || session.getSnapshot().note.temporary || !position.current) return;
      const captured = position.current;
      requestAnimationFrame(() => {
        if (editor.current !== handle) return;
        if (captured.location) handle.restoreArticleLocation(captured.location);
        if (scrollRoot.current) scrollRoot.current.scrollTop = captured.scrollTop;
        position.current = null;
      });
    },
  };
}
