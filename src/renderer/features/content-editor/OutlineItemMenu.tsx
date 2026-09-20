import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import { ArrowDown, ArrowUp, Copy, MessageSquarePlus, MoreHorizontal, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { copyLinkedBlockDocument } from '@/shared/block-anchor-copy';
import { ContentBlockReferenceAction } from '@/renderer/features/content-editor/ContentBlockReferenceAction';
import { contentCommentSelectionBelongsToItem } from '@/renderer/features/content-editor/contentCommentScope';
import { activeOutlineView, focusOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import {
  deleteOutlineSelection,
  indentOutlineItem,
  moveOutlineItem,
  moveSelectedOutlineItemsByOne,
  outdentOutlineItem,
  shiftSelectedOutlineItems,
} from '@/renderer/features/content-editor/outlineEditing';
import { OutlineMoveDialog } from '@/renderer/features/content-editor/OutlineMoveDialog';
import {
  focusOutlineItem,
  outlineViewState,
  selectOutlineItem,
  attachOutlineView,
} from '@/renderer/features/content-editor/outlineViewState';

type Action = 'add' | 'note' | 'noteList' | 'indent' | 'outdent' | 'up' | 'down' | 'duplicate' | 'delete';

function editOutlineItem(
  editor: Editor,
  current: ProseMirrorNode,
  position: number,
  action: Action,
  focusedRoot: boolean,
) {
  const resolved = editor.state.doc.resolve(position);
  const parent = resolved.parent;
  const transaction = editor.state.tr;
  let target = position;
  if (action === 'note' || action === 'noteList') {
    target = position + 1 + (current.firstChild?.nodeSize ?? 0);
    if (action === 'note') {
      transaction.insert(target, editor.schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }));
      target += 1;
    } else {
      transaction.insert(
        target,
        editor.schema.nodes.bulletList.create(
          { blockId: crypto.randomUUID(), outlineRole: 'NOTE' },
          editor.schema.nodes.listItem.create(
            { blockId: crypto.randomUUID() },
            editor.schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }),
          ),
        ),
      );
      target += 3;
    }
  } else if (action === 'add' || action === 'duplicate') {
    const next =
      action === 'add'
        ? editor.schema.nodes.listItem.create(
            { blockId: crypto.randomUUID() },
            editor.schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }),
          )
        : editor.schema.nodeFromJSON(
            copyLinkedBlockDocument({
              type: 'doc',
              content: [{ type: parent.type.name, attrs: parent.attrs, content: [current.toJSON()] }],
            }).root.content![0]!.content![0]!,
          );
    if (focusedRoot) {
      let groupPosition: number | null = null;
      current.forEach((child, offset) => {
        if (
          offset + child.nodeSize === current.content.size &&
          ['bulletList', 'orderedList'].includes(child.type.name) &&
          child.attrs.outlineRole !== 'NOTE'
        )
          groupPosition = position + 1 + offset;
      });
      if (groupPosition === null) {
        target = position + current.nodeSize - 1;
        transaction.insert(
          target,
          editor.schema.nodes.bulletList.create({ blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' }, next),
        );
        target += 3;
      } else {
        const group = editor.state.doc.nodeAt(groupPosition)!;
        target = groupPosition + group.nodeSize - 1;
        transaction.insert(target, next);
        target += 2;
      }
    } else {
      target = position + current.nodeSize;
      transaction.insert(target, next);
      target += 2;
    }
  } else if (action === 'delete') {
    if (parent.childCount === 1 && resolved.depth > 1) {
      target = resolved.before();
      transaction.delete(target, resolved.after());
    } else if (parent.childCount === 1) {
      transaction.replaceWith(
        position,
        position + current.nodeSize,
        editor.schema.nodes.listItem.create(null, editor.schema.nodes.paragraph.create()),
      );
      target += 2;
    } else transaction.delete(position, position + current.nodeSize);
  }
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(target, transaction.doc.content.size))));
  const previous = outlineViewState(editor.state);
  attachOutlineView(transaction, { ...previous, selected: [], anchor: null, active: null }, previous);
  editor.view.dispatch(transaction.scrollIntoView());
  focusOutlineView(editor);
}

export function OutlineItemMenu({
  editor,
  node,
  getPos,
  editable,
  selected,
  selectedIds,
  id,
}: {
  editor: Editor;
  node: ProseMirrorNode;
  getPos: () => number | undefined;
  editable: boolean;
  selected: boolean;
  selectedIds: readonly string[];
  id: string;
}) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline;
  const host = useContentReferenceHost();
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveIds, setMoveIds] = useState<readonly string[]>([]);
  const focusId = outlineViewState(editor.state).focus;
  const focusedRoot = focusId === id;
  const deleteBlocked = focusedRoot || Boolean(selected && focusId && selectedIds.includes(focusId));
  const menuSelection = useRef<Selection | null>(null);
  const groups: { offset: number; id: string; role: string | undefined; preview: string }[] = [];
  node.forEach((child, offset) => {
    if (!['bulletList', 'orderedList'].includes(child.type.name)) return;
    groups.push({
      offset,
      id: String(child.attrs.blockId ?? ''),
      role: child.attrs.outlineRole,
      preview: child.firstChild?.firstChild?.textContent.trim().slice(0, 32) || '…',
    });
  });
  const run = (action: Action) => {
    if (!editor.isEditable || editor.isDestroyed || activeOutlineView(editor).composing) return;
    const position = getPos();
    if (position === undefined) return;
    const current = editor.state.doc.nodeAt(position);
    if (!current || current.attrs.blockId !== node.attrs.blockId) return;
    const focusedRoot = outlineViewState(editor.state).focus === id;
    if (focusedRoot && (action === 'duplicate' || action === 'delete')) return;
    if (action === 'indent' || action === 'outdent') {
      if (selected) shiftSelectedOutlineItems(editor, action === 'outdent');
      else if (action === 'indent') indentOutlineItem(editor, id);
      else outdentOutlineItem(editor, id);
      focusOutlineView(editor);
      return;
    }
    if (action === 'up' || action === 'down') {
      if (selected) moveSelectedOutlineItemsByOne(editor, action === 'up' ? -1 : 1);
      else moveOutlineItem(editor, id, action === 'up' ? -1 : 1);
      focusOutlineView(editor);
      return;
    }
    if (action === 'delete' && selected) {
      deleteOutlineSelection(editor);
      focusOutlineView(editor);
      return;
    }
    editOutlineItem(editor, current, position, action, focusedRoot);
  };
  const classify = (offset: number, groupId: string, role: 'NOTE' | 'CHILDREN') => {
    if (!editable || editor.isDestroyed || activeOutlineView(editor).composing) return;
    const position = getPos();
    if (position === undefined) return;
    const groupPosition = position + 1 + offset;
    const group = editor.state.doc.nodeAt(groupPosition);
    if (!group || group.attrs.blockId !== groupId || !['bulletList', 'orderedList'].includes(group.type.name)) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(groupPosition, undefined, { ...group.attrs, outlineRole: role }),
    );
  };
  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) menuSelection.current = editor.state.selection;
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-6 text-muted-foreground opacity-40 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={messages.contentEditor.blocks}
            onMouseDown={(event) => event.preventDefault()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuItem onSelect={() => focusOutlineItem(editor, focusedRoot ? null : id)}>
            {focusedRoot ? copy.whole : copy.zoom}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => selectOutlineItem(editor, id)}>{copy.selectItem}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <ContentBlockReferenceAction editor={editor} blockId={id} />
          {editable && host.onAddComment && (
            <DropdownMenuItem
              onSelect={() => {
                if (editor.isDestroyed || activeOutlineView(editor).composing) return;
                const position = getPos();
                if (position === undefined) return;
                const current = editor.state.doc.nodeAt(position);
                if (!current || current.attrs.blockId !== id) return;
                const saved = menuSelection.current;
                const original = saved?.$from.doc === editor.state.doc ? saved : editor.state.selection;
                const selectedHere = contentCommentSelectionBelongsToItem(current, position, original);
                if (!selectedHere)
                  editor.view.dispatch(
                    editor.state.tr
                      .setSelection(NodeSelection.create(editor.state.doc, position))
                      .setMeta('addToHistory', false),
                  );
                host.onAddComment?.();
                if (!selectedHere && !editor.isDestroyed)
                  editor.view.dispatch(editor.state.tr.setSelection(original).setMeta('addToHistory', false));
              }}
            >
              <MessageSquarePlus />
              {messages.contentEditor.comment.quickAdd}
            </DropdownMenuItem>
          )}
          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => run('add')}>
                <Plus />
                {copy.addItem}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run('note')}>{copy.addNote}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run('noteList')}>{copy.addNoteList}</DropdownMenuItem>
              {groups.length > 0 && <DropdownMenuSeparator />}
              {groups.map((group) => (
                <DropdownMenuItem
                  key={group.id || group.offset}
                  onSelect={() => classify(group.offset, group.id, group.role === 'NOTE' ? 'CHILDREN' : 'NOTE')}
                >
                  {group.role === 'NOTE' ? copy.useAsChildItems : copy.useAsNoteList} · {group.preview}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem disabled={focusedRoot} onSelect={() => run('indent')}>
                {copy.indent}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={focusedRoot} onSelect={() => run('outdent')}>
                {copy.outdent}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={focusedRoot}
                onSelect={() => {
                  setMoveIds(selected ? selectedIds : [id]);
                  setMoveOpen(true);
                }}
              >
                {copy.moveTo}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={focusedRoot} onSelect={() => run('up')}>
                <ArrowUp />
                {messages.contentEditor.moveBlockUp}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={focusedRoot} onSelect={() => run('down')}>
                <ArrowDown />
                {messages.contentEditor.moveBlockDown}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={focusedRoot} onSelect={() => run('duplicate')}>
                <Copy />
                {messages.contentEditor.duplicateBlock}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={deleteBlocked} onSelect={() => run('delete')}>
                {copy.deleteBranch}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {moveOpen && <OutlineMoveDialog editor={editor} open={moveOpen} onOpenChange={setMoveOpen} sourceIds={moveIds} />}
    </>
  );
}
