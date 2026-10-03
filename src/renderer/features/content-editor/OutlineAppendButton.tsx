import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Plus } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { appendOutlineItem } from '@/renderer/features/content-editor/outlineAppend';
import { outlineViewState } from '@/renderer/features/content-editor/outlineViewState';

export function OutlineAppendButton({ editor }: { editor: Editor }) {
  const { messages } = useI18n();
  const { editable, focused } = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      editable: current.isEditable,
      focused: Boolean(outlineViewState(current.state).focus),
    }),
  });
  if (!editable) return null;
  return (
    <div data-outline-append className={`group/outline-append pb-4 pr-2 ${focused ? 'pl-12' : 'pl-4'}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={focused ? messages.referenceOutline.addChildItem : messages.referenceOutline.addItem}
        title={focused ? messages.referenceOutline.addChildItem : messages.referenceOutline.addItem}
        className="h-7 w-full justify-start rounded-sm px-1 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => appendOutlineItem(editor)}
      >
        <Plus aria-hidden="true" className="size-4" strokeWidth={1.5} />
      </Button>
    </div>
  );
}
