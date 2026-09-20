import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { activeOutlineView, focusOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { useI18n } from '@/renderer/i18n/useI18n';
import { moveOutlineSelection } from '@/renderer/features/content-editor/outlineEditing';
import { outlineMoveTargets, type OutlineDropPlacement } from '@/renderer/features/content-editor/outlineMove';
import {
  outlineScopedTargets,
  outlineViewState,
  outlineVisibleItems,
} from '@/renderer/features/content-editor/outlineViewState';

export function OutlineMoveDialog({
  editor,
  open,
  onOpenChange,
  sourceIds,
  onMoved,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange(open: boolean): void;
  sourceIds: readonly string[];
  onMoved?(): void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.referenceOutline;
  const [query, setQuery] = useState('');
  const returnView = useRef(activeOutlineView(editor));
  const [moveError, setMoveError] = useState(false);
  useEditorState({ editor, selector: ({ editor: current }) => current.state.doc });
  const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable });
  const view = useEditorState({ editor, selector: ({ editor: current }) => outlineViewState(current.state) });
  const names = new Map<string, string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'listItem' && typeof node.attrs.blockId === 'string')
      names.set(node.attrs.blockId, node.firstChild?.textContent.trim() || '…');
  });
  const legalTargets = outlineScopedTargets(
    editor.state.doc,
    view,
    sourceIds,
    outlineMoveTargets(editor.state.doc.toJSON(), sourceIds),
  );
  const targetIds = outlineVisibleItems(editor.state.doc, view)
    .map((row) => row.id)
    .filter((id) => legalTargets.has(id))
    .filter((id) => names.get(id)?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .slice(0, 80);
  const placements: { id: OutlineDropPlacement; label: string }[] = [
    { id: 'BEFORE', label: copy.beforeItem },
    { id: 'INSIDE', label: copy.insideItem },
    { id: 'AFTER', label: copy.afterItem },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editor.isDestroyed) focusOutlineView(editor, returnView.current);
        }}
      >
        <DialogTitle>{copy.moveTo}</DialogTitle>
        <Input
          autoFocus
          aria-label={copy.findMoveTarget}
          placeholder={copy.findMoveTarget}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setMoveError(false);
          }}
        />
        {moveError && (
          <p role="alert" className="text-xs text-destructive">
            {locale === 'zh'
              ? '当前位置无需移动，或目标已经改变。请选择其他位置。'
              : 'The selection is already here, or the destination changed. Choose another position.'}
          </p>
        )}
        <div className="max-h-72 overflow-y-auto">
          {!targetIds.length && (
            <p role="status" className="py-3 text-sm text-muted-foreground">
              {locale === 'zh' ? '没有匹配的可用目标' : 'No available destinations match your search'}
            </p>
          )}
          {targetIds.map((id) => (
            <div key={id} className="flex min-w-0 items-center gap-1 border-b py-1 last:border-0">
              <span className="min-w-0 flex-1 truncate text-sm">{names.get(id)}</span>
              {placements
                .filter((placement) => id !== view.focus || placement.id === 'INSIDE')
                .map((placement) => (
                  <Button
                    key={placement.id}
                    size="sm"
                    variant="ghost"
                    disabled={!editable || activeOutlineView(editor).composing}
                    aria-label={`${placement.label} · ${names.get(id)}`}
                    onClick={() => {
                      if (moveOutlineSelection(editor, sourceIds, id, placement.id)) {
                        onMoved?.();
                        onOpenChange(false);
                      } else setMoveError(true);
                    }}
                  >
                    {placement.label}
                  </Button>
                ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
