import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/renderer/lib/utils';
import { ContentBlockHandle } from '@/renderer/features/content-editor/ContentBlockHandle';
import { ContentLinkPasteMenu } from '@/renderer/features/content-editor/ContentLinkPasteMenu';
import { ContentLinkContextMenu } from '@/renderer/features/content-editor/ContentLinkContextMenu';
import { ContentLinkSource } from '@/renderer/features/content-editor/ContentLinkProviders';

export function VideoDocumentEditorSurfaces({
  embedded,
  contentSource,
  chrome,
  toolbarRoot,
  editor,
  editorRootRef,
  secondaryChromeRoot,
}: {
  embedded?: boolean;
  contentSource?: import('@/shared/contracts/content-library').ContentSource;
  chrome: ReactNode;
  toolbarRoot?: HTMLDivElement | null;
  editor: Editor;
  editorRootRef: RefObject<HTMLDivElement | null>;
  secondaryChromeRoot?: HTMLDivElement | null;
}) {
  return (
    <ContentLinkSource.Provider value={contentSource}>
      <div
        ref={editorRootRef}
        data-slot="video-document-wysiwyg-editor"
        data-content-source={contentSource ? JSON.stringify(contentSource) : undefined}
        className={cn(
          'group/editor relative min-w-0 w-full',
          embedded ? 'bg-transparent text-inherit' : 'border-y bg-surface focus-within:border-selected-border',
        )}
      >
        {toolbarRoot ? createPortal(chrome, toolbarRoot) : chrome}
        <ContentBlockHandle editor={editor} rootRef={editorRootRef} source={contentSource} />
        <ContentLinkPasteMenu editor={editor} source={contentSource} />
        <ContentLinkContextMenu editor={editor} source={contentSource}>
          <EditorContent
            className="min-w-0 w-full [&>.ProseMirror]:min-w-0 [&>.ProseMirror]:w-full [&_.find-and-replace-result]:box-decoration-clone [&_.find-and-replace-result]:rounded-sm [&_.find-and-replace-result]:bg-warning-surface [&_.find-and-replace-result-current]:scroll-mt-24 [&_.find-and-replace-result-current]:ring-1 [&_.find-and-replace-result-current]:ring-inset [&_.find-and-replace-result-current]:ring-warning"
            editor={editor}
          />
        </ContentLinkContextMenu>
      </div>
      {secondaryChromeRoot ? createPortal(chrome, secondaryChromeRoot) : null}
    </ContentLinkSource.Provider>
  );
}
