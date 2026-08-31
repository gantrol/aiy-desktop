import type { Editor } from '@tiptap/core';
import { EditorView } from '@tiptap/pm/view';
import { useEffect } from 'react';

export function useVideoDocumentSplitEditorView({
  ariaLabel,
  editor,
  root,
}: {
  ariaLabel: string;
  editor: Editor | null;
  root: HTMLDivElement | null;
}) {
  useEffect(() => {
    if (!editor || editor.isDestroyed || !root) return undefined;
    const sourceView = editor.view;
    const sourceAttributes = sourceView.props.attributes;
    const attributes = typeof sourceAttributes === 'function' ? sourceAttributes(editor.state) : sourceAttributes;
    const splitView = new EditorView(root, {
      ...sourceView.props,
      attributes: { ...attributes, 'aria-label': ariaLabel },
      dispatchTransaction(transaction) {
        if (!editor.isDestroyed && !sourceView.isDestroyed) sourceView.dispatch(transaction);
      },
      state: editor.state,
    });
    splitView.dom.dataset.editorSplitView = '';
    const synchronize = () => {
      if (!splitView.isDestroyed && splitView.state !== editor.state) splitView.updateState(editor.state);
    };
    editor.on('transaction', synchronize);
    return () => {
      editor.off('transaction', synchronize);
      const dom = splitView.dom;
      splitView.destroy();
      dom.remove();
    };
  }, [ariaLabel, editor, root]);
}
