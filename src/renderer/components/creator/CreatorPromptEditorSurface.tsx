import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';

interface Props {
  editor: Editor | null;
  empty: boolean;
  fullWindow: boolean;
  placeholder: string;
}

export function CreatorPromptEditorSurface({ editor, empty, fullWindow, placeholder }: Props) {
  return (
    <ScrollArea
      data-creator-prompt-editor
      type="always"
      className={cn(
        'relative [&_[data-slot=scroll-area-scrollbar]]:opacity-100',
        fullWindow ? 'min-h-0 flex-1' : 'h-60 max-h-[38vh]',
      )}
    >
      <div className="relative min-h-full">
        {editor && empty && (
          <div className="pointer-events-none absolute left-5 top-2 text-md leading-8 text-muted-foreground">
            {placeholder}
          </div>
        )}
        <EditorContent className="min-h-full [&>.ProseMirror]:min-h-full" editor={editor} />
      </div>
    </ScrollArea>
  );
}
