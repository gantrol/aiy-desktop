import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Copy,
  CornerDownRight,
  Focus,
  FilePlus2,
  IndentDecrease,
  IndentIncrease,
  Link,
  List,
  ListTree,
  MessageSquarePlus,
  MoreHorizontal,
  MousePointer2,
  MoveVertical,
  Plus,
  Text,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { contextualActionVisibilityClassName } from '@/renderer/components/ui/item-actions';
import { Kbd } from '@/renderer/components/ui/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { shortcutTokens } from '@/renderer/commands/app-shortcuts';
import {
  canPasteOutlinePlainText,
  outlinePlainTextPasteBinding,
  pasteOutlinePlainTextFromClipboard,
} from '@/renderer/features/content-editor/outlinePlainTextPaste';
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
import { addOutlineItem, addOutlineParagraph } from '@/renderer/features/content-editor/outlineAppend';
import { OutlineMoveDialog } from '@/renderer/features/content-editor/OutlineMoveDialog';
import { useOutlinePageAction } from '@/renderer/features/content-editor/useOutlinePageAction';
import { OutlineContentLinkDialog } from '@/renderer/features/content-editor/OutlineContentLinkDialog';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { openContentAssociation } from '@/renderer/features/content-editor/contentAssociation';
import {
  focusOutlineItem,
  outlineViewState,
  selectOutlineItem,
  attachOutlineView,
} from '@/renderer/features/content-editor/outlineViewState';

type Action = 'add' | 'note' | 'noteList' | 'indent' | 'outdent' | 'up' | 'down' | 'duplicate' | 'delete';

function OutlinePlainTextPasteItem({ editor, id, onSelect }: { editor: Editor; id: string; onSelect(): void }) {
  const copy = useI18n().messages.contentEditor;
  const platform = window.desktopApi?.appPlatform ?? 'win32';
  const available = useEditorState({
    editor,
    selector: ({ editor: current }) => canPasteOutlinePlainText(current, id),
  });
  return (
    <DropdownMenuItem disabled={!available} onSelect={onSelect}>
      <ClipboardPaste />
      {copy.pasteAsPlainText}
      <Kbd className="ml-auto">{shortcutTokens(outlinePlainTextPasteBinding(platform), platform).join('+')}</Kbd>
    </DropdownMenuItem>
  );
}

function OutlinePageMenuItem({
  page,
  id,
  disabled,
}: {
  page: ReturnType<typeof useOutlinePageAction>;
  id: string;
  disabled: boolean;
}) {
  const copy = useI18n().messages.referenceOutline;
  if (!page.supported) return null;
  return (
    <DropdownMenuItem disabled={disabled || page.busy} onSelect={() => void page.create([id])}>
      <FilePlus2 />
      {copy.turnIntoPage}
    </DropdownMenuItem>
  );
}

function useOutlinePlainTextPasteMenu(editor: Editor, id: string) {
  const requested = useRef<{ state: Editor['state']; view: ReturnType<typeof activeOutlineView> } | null>(null);
  return {
    request: () => {
      requested.current = { state: editor.state, view: activeOutlineView(editor) };
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const pending = requested.current;
      requested.current = null;
      if (
        !pending ||
        editor.isDestroyed ||
        pending.view.isDestroyed ||
        activeOutlineView(editor) !== pending.view ||
        editor.state.doc !== pending.state.doc ||
        !editor.state.selection.eq(pending.state.selection) ||
        outlineViewState(editor.state) !== outlineViewState(pending.state)
      )
        return;
      // Read only after the menu's focus trap has closed, in its original editor pane.
      focusOutlineView(editor, pending.view);
      void pasteOutlinePlainTextFromClipboard(editor, id);
    },
  };
}

function OutlinePositionMenu({
  disabled,
  onAction,
  onMoveTo,
}: {
  disabled: boolean;
  onAction: (action: 'up' | 'down' | 'indent' | 'outdent') => void;
  onMoveTo: () => void;
}) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <MoveVertical className="size-4 shrink-0" />
        {copy.moveAndIndent}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <DropdownMenuItem onSelect={() => onAction('up')}>
            <ArrowUp />
            {messages.contentEditor.moveBlockUp}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('down')}>
            <ArrowDown />
            {messages.contentEditor.moveBlockDown}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onAction('indent')}>
            <IndentIncrease />
            {copy.indent}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('outdent')}>
            <IndentDecrease />
            {copy.outdent}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onMoveTo}>
            <CornerDownRight />
            {copy.moveTo}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

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
  if (action === 'noteList') {
    target = position + 1 + (current.firstChild?.nodeSize ?? 0);
    const caret = editor.state.selection.from;
    let found = false;
    current.forEach((child, offset, index) => {
      if (index > 0 && ['bulletList', 'orderedList'].includes(child.type.name) && child.attrs.outlineRole !== 'NOTE')
        return;
      const start = position + 1 + offset;
      if (!found) target = start + child.nodeSize;
      if (caret > start && caret < start + child.nodeSize) found = true;
    });
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
  } else if (action === 'duplicate') {
    const next = editor.schema.nodeFromJSON(
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
  const folded = new Set(previous.folded);
  if (action === 'noteList') folded.delete(current.attrs.blockId);
  attachOutlineView(transaction, { ...previous, folded, selected: [], anchor: null, active: null }, previous);
  editor.view.dispatch(transaction.scrollIntoView());
  focusOutlineView(editor);
}

interface OutlineItemMenuProps {
  editor: Editor;
  node: ProseMirrorNode;
  getPos: () => number | undefined;
  editable: boolean;
  selected: boolean;
  selectedIds: readonly string[];
  id: string;
}

function outlineNoteGroups(node: ProseMirrorNode) {
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
  return groups;
}

export function OutlineItemMenu({ editor, node, getPos, editable, selected, selectedIds, id }: OutlineItemMenuProps) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline;
  const host = useContentReferenceHost();
  const linkHost = useOutlineContentLinkHost();
  const page = useOutlinePageAction(editor);
  const [linkMode, setLinkMode] = useState<'EXISTING' | 'NEW' | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveIds, setMoveIds] = useState<readonly string[]>([]);
  const focusId = outlineViewState(editor.state).focus;
  const focusedRoot = focusId === id;
  const deleteBlocked = focusedRoot || Boolean(selected && focusId && selectedIds.includes(focusId));
  const menuSelection = useRef<Selection | null>(null);
  const plainTextPaste = useOutlinePlainTextPasteMenu(editor, id);
  const groups = outlineNoteGroups(node);
  const run = (action: Action) => {
    if (!editor.isEditable || editor.isDestroyed || activeOutlineView(editor).composing) return;
    const position = getPos();
    if (position === undefined) return;
    const current = editor.state.doc.nodeAt(position);
    if (!current || current.attrs.blockId !== node.attrs.blockId) return;
    const focusedRoot = outlineViewState(editor.state).focus === id;
    if (focusedRoot && (action === 'duplicate' || action === 'delete')) return;
    if (action === 'add' || action === 'note') {
      if (action === 'add') addOutlineItem(editor, id);
      else addOutlineParagraph(editor, id);
      focusOutlineView(editor);
      return;
    }
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
            data-outline-item-menu
            className={`size-6 text-muted-foreground ${contextualActionVisibilityClassName}`}
            aria-label={messages.contentEditor.blocks}
            onMouseDown={(event) => event.preventDefault()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
          onCloseAutoFocus={plainTextPaste.onCloseAutoFocus}
        >
          <DropdownMenuItem onSelect={() => focusOutlineItem(editor, focusedRoot ? null : id)}>
            <Focus />
            {focusedRoot ? copy.whole : copy.zoom}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => selectOutlineItem(editor, id)}>
            <MousePointer2 />
            {copy.selectItem}
          </DropdownMenuItem>
          <OutlinePageMenuItem page={page} id={id} disabled={!editable || focusedRoot} />
          {editable && (
            <>
              <DropdownMenuSeparator />
              <OutlinePlainTextPasteItem editor={editor} id={id} onSelect={plainTextPaste.request} />
              <DropdownMenuItem onSelect={() => run('add')}>
                <Plus />
                {focusedRoot ? copy.addChildItem : copy.addItem}
                <Kbd className="ml-auto">
                  {window.desktopApi?.appPlatform === 'darwin' ? '⌘⇧↵' : 'Ctrl+Shift+Enter'}
                </Kbd>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Text className="size-4 shrink-0" />
                  {copy.addContent}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => run('note')}>
                      <Text />
                      {copy.addNote}
                      <Kbd className="ml-auto">Shift+Enter</Kbd>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => run('noteList')}>
                      <List />
                      {copy.addNoteList}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={focusedRoot} onSelect={() => run('duplicate')}>
                <Copy />
                {copy.duplicateItem}
              </DropdownMenuItem>
            </>
          )}
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
              <OutlinePositionMenu
                disabled={focusedRoot}
                onAction={run}
                onMoveTo={() => {
                  setMoveIds(selected ? selectedIds : [id]);
                  setMoveOpen(true);
                }}
              />
              {groups.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ListTree className="size-4 shrink-0" />
                    {copy.convertList}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-80 overflow-y-auto">
                      {groups.map((group) => (
                        <DropdownMenuItem
                          key={group.id || group.offset}
                          onSelect={() => classify(group.offset, group.id, group.role === 'NOTE' ? 'CHILDREN' : 'NOTE')}
                        >
                          {group.role === 'NOTE' ? <ListTree /> : <List />}
                          <span className="shrink-0">
                            {group.role === 'NOTE' ? copy.useAsChildItems : copy.useAsNoteList}
                          </span>
                          <span className="truncate text-muted-foreground" title={group.preview}>
                            {group.preview}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
            </>
          )}
          {(host.source || (editable && linkHost)) && <DropdownMenuSeparator />}
          <ContentBlockReferenceAction editor={editor} blockId={id} />
          {editable && linkHost && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Link className="size-4 shrink-0" />
                {copy.linkContent}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onSelect={() => {
                      const selection = menuSelection.current ?? editor.state.selection;
                      const document = editor.state.doc;
                      setTimeout(() => {
                        if (!editor.isDestroyed && editor.state.doc === document)
                          openContentAssociation(editor, { blockId: id, selection });
                      }, 0);
                    }}
                  >
                    <Link />
                    {copy.linkExisting}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setLinkMode('NEW')}>
                    <Plus />
                    {copy.linkCreate}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={deleteBlocked} onSelect={() => run('delete')}>
                <Trash2 />
                {copy.deleteBranch}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {moveOpen && <OutlineMoveDialog editor={editor} open={moveOpen} onOpenChange={setMoveOpen} sourceIds={moveIds} />}
      {linkMode && (
        <OutlineContentLinkDialog editor={editor} blockId={id} mode={linkMode} onClose={() => setLinkMode(null)} />
      )}
    </>
  );
}
