import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { SigmaIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ContentMathForm } from '@/renderer/features/content-editor/ContentMathForm';
import { captureReferenceInsertion } from '@/renderer/features/content-editor/referenceInsertion';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { isMathNode } from '@/shared/content-math';

/** Retain and map the original selection while a formula is edited in a portal. */
export function ContentMathAction({
  editor,
  getPos,
  children,
  menuItem,
  display,
}: {
  editor: Editor;
  getPos?: () => number | undefined;
  children?: ReactNode;
  menuItem?: boolean;
  display?: boolean;
}) {
  const copy = useI18n().messages.contentEditor.math;
  const [draft, setDraft] = useState<{ source: string; display: boolean; editing: boolean } | null>(null);
  const capture = useRef<ReturnType<typeof captureReferenceInsertion> | null>(null);
  useEffect(() => () => capture.current?.dispose(), [editor]);

  function close() {
    capture.current?.dispose();
    capture.current = null;
    setDraft(null);
  }

  function open() {
    if (editor.isDestroyed || !editor.isEditable) return;
    const position = getPos?.();
    if (getPos) {
      if (position === undefined || !isMathNode(editor.state.doc.nodeAt(position)?.type.name)) return;
      editor.commands.setNodeSelection(position);
    }
    const selected = editor.state.selection;
    const node = selected instanceof NodeSelection && isMathNode(selected.node.type.name) ? selected.node : null;
    capture.current?.dispose();
    capture.current = captureReferenceInsertion(editor);
    setDraft({
      source: node?.attrs.latex ?? editor.state.doc.textBetween(selected.from, selected.to, '\n'),
      display: node?.type.name === 'blockMath',
      editing: Boolean(node),
    });
  }

  function apply(latex: string, block: boolean, remove = false) {
    try {
      const selection = capture.current?.selection();
      if (!selection) return false;
      const old = selection instanceof NodeSelection && isMathNode(selection.node.type.name) ? selection.node : null;
      if (draft?.editing && !old) return false;
      const type = block ? 'blockMath' : 'inlineMath';
      const chain = editor.chain().command(({ tr }) => {
        closeHistory(tr).setSelection(selection);
        return true;
      });
      if (remove) chain.deleteSelection();
      else if (old?.type.name === type) chain.updateAttributes(type, { latex });
      else {
        const formula = { type, attrs: { latex } };
        chain.insertContent(
          old?.isBlock && !block
            ? { type: 'paragraph', attrs: { blockId: old.attrs.blockId }, content: [formula] }
            : formula,
        );
      }
      const applied = chain.run();
      if (!applied) return false;
      close();
      editor.commands.focus();
      return true;
    } catch {
      return false;
    }
  }

  return (
    <Popover open={Boolean(draft)} onOpenChange={(value) => (value ? open() : close())}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={menuItem ? 'sm' : 'icon-sm'}
          disabled={!editor.isEditable}
          aria-label={getPos ? copy.edit : copy.insert}
          title={getPos ? copy.edit : copy.insert}
          className={cn(
            menuItem ? 'w-full justify-start font-normal' : 'size-7',
            children && 'inline h-auto w-auto max-w-full whitespace-normal rounded-sm p-0 align-baseline font-normal',
            children && display && 'block w-full overflow-x-auto text-center',
          )}
          onMouseDown={(event) => event.preventDefault()}
        >
          {children ?? <SigmaIcon className="size-3.5" />}
          {menuItem && copy.insert}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={draft?.editing ? copy.edit : copy.insert}
        className="w-96 max-w-[calc(100vw-2rem)] rounded-md p-3"
        onCloseAutoFocus={(event) => {
          if (editor.isFocused) event.preventDefault();
        }}
      >
        {draft && (
          <ContentMathForm
            source={draft.source}
            display={draft.display}
            onApply={apply}
            onRemove={draft.editing ? () => apply('', false, true) : undefined}
            onCancel={close}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
