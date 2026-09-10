import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { contentRootBlock } from '@/renderer/features/content-editor/contentRootBlock';
import { ContentLinkBlockActions } from '@/renderer/features/content-editor/ContentLinkBlockActions';
import { useI18n } from '@/renderer/i18n/useI18n';
import { captureBlockDocument } from '@/shared/contracts/block-document';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { ArrowDown, ArrowUp, Copy, GripVertical, X } from 'lucide-react';
import type { ContentSource } from '@/shared/contracts/content-library';

/** Lists and tables move with their children, preserving their internal structure and identities. */
export function ContentBlockActions({
  editor,
  blockId,
  source,
  onOpenChange,
}: {
  editor: Editor;
  blockId: string;
  source?: ContentSource;
  onOpenChange?(open: boolean): void;
}) {
  const copy = useI18n().messages.contentEditor;
  const current = useEditorState({
    editor,
    selector: ({ editor }) => {
      const block = contentRootBlock(editor, blockId);
      return {
        index: block?.index ?? -1,
        count: editor.state.doc.childCount,
        convertible: block?.node.type.name === 'paragraph' || block?.node.type.name === 'heading',
        editable: editor.isEditable && Boolean(block),
      };
    },
  });
  const run = (action: 'up' | 'down' | 'duplicate' | 'delete') => {
    if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return;
    const { doc } = editor.state;
    const block = contentRootBlock(editor, blockId);
    if (!block) return;
    const { index, position, node } = block;
    const transaction = editor.state.tr;
    let target = position;
    if (action === 'duplicate') {
      const copied = captureBlockDocument({ type: 'doc', content: [node.toJSON()] }, [], true).root.content![0]!;
      target = position + node.nodeSize;
      transaction.insert(target, editor.schema.nodeFromJSON(copied));
    } else if (action === 'delete') {
      transaction.delete(position, position + node.nodeSize);
      if (!transaction.doc.childCount) transaction.insert(0, editor.schema.nodes.paragraph.create());
      transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(Math.min(position, transaction.doc.content.size))),
      );
    } else {
      if ((action === 'up' && !index) || (action === 'down' && index + 1 >= doc.childCount)) return;
      target = action === 'up' ? position - doc.child(index - 1).nodeSize : position + doc.child(index + 1).nodeSize;
      transaction.delete(position, position + node.nodeSize).insert(target, node);
    }
    if (action !== 'delete') transaction.setSelection(NodeSelection.create(transaction.doc, target));
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
  };
  const convert = (type: 'paragraph' | 'heading') => {
    if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return;
    const block = contentRootBlock(editor, blockId);
    if (!block || !['paragraph', 'heading'].includes(block.node.type.name)) return;
    const transaction = editor.state.tr.setNodeMarkup(block.position, editor.schema.nodes[type], {
      ...block.node.attrs,
      ...(type === 'heading' ? { level: 2 } : {}),
    });
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(block.position + 1)));
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
  };
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-5 rounded-sm"
          aria-label={copy.blocks}
          title={copy.blocks}
          disabled={!current.editable}
          onMouseDown={(event) => event.preventDefault()}
        >
          <GripVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editor.isDestroyed) editor.view.focus();
        }}
      >
        <DropdownMenuItem disabled={current.index === 0} onSelect={() => run('up')}>
          <ArrowUp />
          {copy.moveBlockUp}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={current.index + 1 >= current.count} onSelect={() => run('down')}>
          <ArrowDown />
          {copy.moveBlockDown}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('duplicate')}>
          <Copy />
          {copy.duplicateBlock}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('delete')}>
          <X />
          {copy.deleteBlock}
        </DropdownMenuItem>
        {current.convertible && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => convert('paragraph')}>{copy.paragraphBlock}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => convert('heading')}>{copy.headingBlock}</DropdownMenuItem>
          </>
        )}
        <ContentLinkBlockActions editor={editor} blockId={blockId} source={source} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
