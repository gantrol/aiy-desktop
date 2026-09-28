import { useEffect, useRef, type RefObject } from 'react';
import { leavePetalEditor } from '@/renderer/features/desktop-petals/petal-editor-leave';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';

export function useNoteEditorFlush(
  session: NoteEditSession,
  editorHandle: RefObject<VideoDocumentWysiwygEditorHandle | null>,
  settleFiles: () => Promise<boolean>,
  settleReferences: () => Promise<boolean>,
) {
  const leaveRequest = useRef(0);
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
          settleReferences,
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
  }, [session, settleReferences, settleFiles, editorHandle]);
}
