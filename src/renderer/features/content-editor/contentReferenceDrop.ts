import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import type { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { ContentSource } from '@/shared/contracts/content-source';
import { resolveDroppedContentLinks } from '@/renderer/features/content-editor/contentLinkDrop';
import { resolveReferenceDrop } from '@/renderer/features/content-editor/resolveReferenceDrop';
import { captureReferenceInsertion } from '@/renderer/features/content-editor/referenceInsertion';
import { revealInsertedReferences } from '@/renderer/features/content-editor/referenceToolbarState';

/** Keep asynchronous drops at the pointer's original position in the receiving view. */
export async function dropContentReferences({
  editor,
  view,
  position,
  payload,
  source,
  sessions,
  linkSpaceId,
}: {
  editor: Editor;
  view: EditorView;
  position: number;
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>;
  source?: ContentSource;
  sessions: ReturnType<typeof useArticleEditorSessions>;
  linkSpaceId?: string;
}) {
  const insertion = captureReferenceInsertion(editor, position, view);
  const disconnect = window.desktopApi?.onLocalSpaceTransition?.(() => insertion.dispose());
  try {
    const nodes = [];
    if (linkSpaceId) {
      const links = await resolveDroppedContentLinks(payload, linkSpaceId, () => insertion.selection());
      for (const link of links)
        nodes.push(
          editor.schema.nodes.paragraph.create(
            { blockId: crypto.randomUUID() },
            editor.schema.text(link.title || link.url, [editor.schema.marks.link.create({ href: link.url })]),
          ),
        );
    } else {
      const references = await resolveReferenceDrop(payload, () => insertion.selection(), { source, sessions });
      nodes.push(...references.map((reference) => editor.schema.nodeFromJSON(reference)));
    }
    const transaction = closeHistory(editor.state.tr).setSelection(insertion.selection());
    transaction.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0));
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.to)));
    transaction.removeStoredMark(editor.schema.marks.link);
    revealInsertedReferences(
      transaction,
      nodes.filter((node) => node.type.name === 'contentReference').map((node) => String(node.attrs.blockId)),
    );
    view.dispatch(transaction.setMeta('preventAutolink', true).scrollIntoView());
    view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  } finally {
    insertion.dispose();
    disconnect?.();
  }
}
