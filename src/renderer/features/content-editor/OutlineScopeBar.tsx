import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  focusOutlineItem,
  outlineFocusPath,
  outlineViewState,
} from '@/renderer/features/content-editor/outlineViewState';

export function OutlineScopeBar({ editor }: { editor: Editor }) {
  const copy = useI18n().messages.referenceOutline;
  const view = useEditorState({ editor, selector: ({ editor: current }) => outlineViewState(current.state) });
  if (!view.focus) return null;
  const path = outlineFocusPath(editor.state.doc, view.focus);
  return (
    <nav aria-label={copy.zoom} className="flex min-w-0 items-center gap-1 border-b px-6 py-1">
      <Button size="sm" variant="ghost" onClick={() => focusOutlineItem(editor, null)}>
        {copy.whole}
      </Button>
      {path.map((item) => (
        <span key={item.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          <Button
            size="sm"
            variant="ghost"
            className="min-w-0 max-w-48 truncate"
            aria-current={item.id === view.focus ? 'location' : undefined}
            onClick={() => focusOutlineItem(editor, item.id)}
          >
            {item.title}
          </Button>
        </span>
      ))}
    </nav>
  );
}
