import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { ContentBlockHandle } from '@/renderer/features/content-editor/ContentBlockHandle';
import { useRef } from 'react';
import { cn } from '@/renderer/lib/utils';
import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';

interface Props {
  editor: Editor | null;
  empty: boolean;
  fullWindow: boolean;
  placeholder: string;
}

export function CreatorPromptEditorSurface({ editor, empty, fullWindow, placeholder }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  return (
    <ScrollArea
      data-creator-prompt-editor
      type="always"
      className={cn(
        'relative [&_[data-slot=scroll-area-scrollbar]]:opacity-100',
        fullWindow ? 'min-h-0 flex-1' : 'h-60 max-h-[38vh]',
      )}
    >
      <div ref={rootRef} className="relative min-h-full pl-7">
        {editor && <ContentBlockHandle editor={editor} rootRef={rootRef} />}
        {editor && empty && (
          <div className="pointer-events-none absolute left-12 right-5 top-2 text-[15px] leading-[1.65] text-muted-foreground">
            {placeholder}
          </div>
        )}
        <EditorContent className="min-h-full [&>.ProseMirror]:min-h-full" editor={editor} />
      </div>
    </ScrollArea>
  );
}
