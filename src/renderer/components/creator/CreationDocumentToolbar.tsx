import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Bold, Italic, List, Redo2, Undo2 } from 'lucide-react';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { ContentToolbar } from '@/renderer/features/content-editor/ContentToolbar';
import { emptyToolbarState, selectToolbarState } from '@/renderer/features/content-editor/contentEditorToolbarState';
import { FormatButton, HeadingMenu, LinkMenu } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CreationDocumentToolbar({
  editor,
  materials,
  children,
  outlineMode = false,
}: {
  editor: Editor | null;
  materials: ReactNode;
  children: ReactNode;
  outlineMode?: boolean;
}) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.editor.richText;
  const state =
    useEditorState({ editor, selector: ({ editor: current }) => selectToolbarState(current) }) ?? emptyToolbarState;
  return (
    <TooltipProvider>
      <ContentToolbar label={labels.formatting} className="min-h-11 border-0 bg-transparent px-0">
        {(narrow) => (
          <>
            {editor && (
              <>
                {!outlineMode && <HeadingMenu editor={editor} state={state} labels={labels} textLabel={!narrow} />}
                <FormatButton
                  label={labels.bold}
                  active={state.bold}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                >
                  <Bold className="size-3.5" />
                </FormatButton>
                <FormatButton
                  label={labels.italic}
                  active={state.italic}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                  <Italic className="size-3.5" />
                </FormatButton>
                {!outlineMode && (
                  <FormatButton
                    label={labels.bulletList}
                    active={state.bulletList}
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                  >
                    <List className="size-3.5" />
                  </FormatButton>
                )}
                <LinkMenu editor={editor} active={state.link} labels={labels} />
                <span className="mx-1 h-4 border-l" aria-hidden />
                <FormatButton
                  label={labels.undo}
                  disabled={!state.canUndo}
                  onClick={() => editor.chain().focus().undo().run()}
                >
                  <Undo2 className="size-3.5" />
                </FormatButton>
                <FormatButton
                  label={labels.redo}
                  disabled={!state.canRedo}
                  onClick={() => editor.chain().focus().redo().run()}
                >
                  <Redo2 className="size-3.5" />
                </FormatButton>
              </>
            )}
            <div className="ml-auto flex items-center gap-1">
              {materials}
              {children}
            </div>
          </>
        )}
      </ContentToolbar>
    </TooltipProvider>
  );
}
