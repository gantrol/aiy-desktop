import { NodeViewContent, ReactNodeViewContext, useReactNodeView, type NodeViewContentProps } from '@tiptap/react';
import { useCallback, useMemo } from 'react';
import type { EditorView } from '@tiptap/pm/view';

type ContentElement = HTMLElement & { moveBefore?: (node: Node, reference: Node | null) => void };

/** Keep Tiptap's content and selection ownership while mounting its queued React portal. */
export function ContentNodeViewContent({ view, ...props }: NodeViewContentProps<'div'> & { view: EditorView }) {
  const context = useReactNodeView();
  const { nodeViewContentRef } = context;
  const mount = useCallback(
    (element: ContentElement | null) => {
      // Tiptap 3.30 stages content directly under its renderer until this portal mounts.
      // Its appendChild fallback reads DOM selection per node, forcing layout between
      // every move. Use an atomic move, then restore the model selection only for the
      // focused editor: a newly opened document has no DOM selection to preserve.
      const renderer = element?.closest('.react-renderer');
      const content = renderer?.querySelector<HTMLElement>(':scope > [data-node-view-content-react]');
      if (
        element?.moveBefore &&
        content &&
        content !== element &&
        content.ownerDocument === element.ownerDocument &&
        content.isConnected === element.isConnected &&
        !content.contains(element)
      ) {
        const focused = view.hasFocus();
        element.moveBefore(content, null);
        // Moving a containing node can relocate the native range even with moveBefore.
        // ProseMirror owns the mapped selection after split/indent; project it back now.
        if (focused) view.focus();
      }
      // Already-mounted content is a no-op; other renderers/runtimes retain Tiptap's path.
      nodeViewContentRef?.(element);
    },
    [nodeViewContentRef, view],
  );
  const value = useMemo(() => ({ ...context, nodeViewContentRef: mount }), [context, mount]);
  return (
    <ReactNodeViewContext.Provider value={value}>
      <NodeViewContent {...props} />
    </ReactNodeViewContext.Provider>
  );
}
