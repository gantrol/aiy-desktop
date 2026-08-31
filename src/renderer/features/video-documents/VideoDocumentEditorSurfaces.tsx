import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

export function VideoDocumentEditorSurfaces({
  chrome,
  editor,
  editorRootRef,
  secondaryChromeRoot,
}: {
  chrome: ReactNode;
  editor: Editor;
  editorRootRef: RefObject<HTMLDivElement | null>;
  secondaryChromeRoot?: HTMLDivElement | null;
}) {
  return (
    <>
      <div
        ref={editorRootRef}
        data-slot="video-document-wysiwyg-editor"
        className="group/editor relative min-w-0 w-full border-y bg-surface focus-within:border-selected-border"
      >
        {chrome}
        <div className="min-w-0 overflow-hidden">
          <EditorContent
            className="min-w-0 w-full [&>.ProseMirror]:min-w-0 [&>.ProseMirror]:w-full [&_.find-and-replace-result]:box-decoration-clone [&_.find-and-replace-result]:rounded-sm [&_.find-and-replace-result]:bg-warning-surface [&_.find-and-replace-result-current]:scroll-mt-24 [&_.find-and-replace-result-current]:ring-1 [&_.find-and-replace-result-current]:ring-inset [&_.find-and-replace-result-current]:ring-warning"
            editor={editor}
          />
        </div>
      </div>
      {secondaryChromeRoot ? createPortal(chrome, secondaryChromeRoot) : null}
    </>
  );
}
