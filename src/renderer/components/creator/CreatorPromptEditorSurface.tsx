import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { ContentBlockHandle } from '@/renderer/features/content-editor/ContentBlockHandle';
import { OutlineScopeBar } from '@/renderer/features/content-editor/OutlineScopeBar';
import { OutlineAppendButton } from '@/renderer/features/content-editor/OutlineAppendButton';
import { OutlineGlobalCollapseRail } from '@/renderer/features/content-editor/OutlineGlobalCollapseRail';
import { OutlineSelectionToolbar } from '@/renderer/features/content-editor/OutlineSelectionToolbar';
import { useRef } from 'react';
import { cn } from '@/renderer/lib/utils';
import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';

interface Props {
  editor: Editor | null;
  empty: boolean;
  fullWindow: boolean;
  placeholder: string;
  presentation?: 'prompt' | 'document';
  outlineMode?: boolean;
}

export function CreatorPromptEditorSurface({
  editor,
  empty,
  fullWindow,
  placeholder,
  presentation = 'prompt',
  outlineMode = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const content = (
    <div ref={rootRef} className="relative min-h-full pl-7">
      {editor && outlineMode && <OutlineScopeBar editor={editor} />}
      {editor && <ContentBlockHandle editor={editor} rootRef={rootRef} outlineMode={outlineMode} />}
      {editor && empty && !outlineMode && (
        <div
          className={cn(
            'pointer-events-none absolute right-5 top-2 text-[15px] leading-[1.65] text-muted-foreground',
            presentation === 'document' ? 'left-7' : 'left-8',
          )}
        >
          {placeholder}
        </div>
      )}
      <div className="relative min-h-full">
        {editor && outlineMode && <OutlineGlobalCollapseRail editor={editor} />}
        <EditorContent
          className={cn(
            'min-h-full [&>.ProseMirror]:min-h-full',
            presentation === 'document' &&
              '[&_[data-document-image]]:my-4 [&_[data-document-image]]:rounded-sm [&_[data-document-image]_img]:max-h-[clamp(10rem,42vh,24rem)]',
          )}
          editor={editor}
        />
      </div>
      {editor && outlineMode && <OutlineAppendButton editor={editor} />}
      {editor && outlineMode && <OutlineSelectionToolbar editor={editor} />}
    </div>
  );
  if (presentation === 'document') return <div className="min-h-24">{content}</div>;
  return (
    <ScrollArea
      data-creator-prompt-editor
      type="always"
      className={cn(
        'relative [&_[data-slot=scroll-area-scrollbar]]:opacity-100',
        fullWindow ? 'min-h-32 flex-1' : 'h-72 max-h-[46vh]',
      )}
    >
      {content}
    </ScrollArea>
  );
}
