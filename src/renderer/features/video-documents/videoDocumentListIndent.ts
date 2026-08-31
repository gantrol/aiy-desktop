import { Extension, type Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

function indentRootParagraphIntoPreviousListItem(editor: Editor) {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  let paragraph = $from.parent;
  let paragraphIndex = $from.index(0);
  let paragraphStart = $from.depth === 1 ? $from.before(1) : $from.pos;
  if ($from.depth !== 1 || paragraph.type.name !== 'paragraph' || $from.parentOffset !== 0) {
    const nodeAfter = $from.depth === 0 ? $from.nodeAfter : null;
    if (!nodeAfter || nodeAfter.type.name !== 'paragraph') return false;
    paragraph = nodeAfter;
    paragraphIndex = $from.index(0);
    paragraphStart = $from.pos;
  }
  if (paragraphIndex === 0) return false;
  const previousList = state.doc.child(paragraphIndex - 1);
  if (previousList.type.name !== 'bulletList' && previousList.type.name !== 'orderedList') return false;
  const lastItemIndex = previousList.childCount - 1;
  const lastItem = previousList.child(lastItemIndex);
  if (lastItem.type.name !== 'listItem') return false;
  const nextItemContent = lastItem.content.append(Fragment.from(paragraph));
  if (!lastItem.type.validContent(nextItemContent)) return false;
  const previousListStart = paragraphStart - previousList.nodeSize;
  const nextList = previousList.copy(previousList.content.replaceChild(lastItemIndex, lastItem.copy(nextItemContent)));
  const transaction = state.tr.replaceWith(previousListStart, paragraphStart + paragraph.nodeSize, nextList);
  transaction.setSelection(TextSelection.create(transaction.doc, paragraphStart - 1));
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export function synchronizeVideoDocumentEditorSelectionFromDom(editor: Editor, editorView?: EditorView) {
  const state = editor.state;
  const view = editorView ?? editor.view;
  const domSelection = view.dom.ownerDocument.getSelection();
  const anchorNode = domSelection?.anchorNode;
  if (!domSelection?.isCollapsed || !anchorNode || !view.dom.contains(anchorNode)) return;
  let position: number;
  try {
    position = view.posAtDOM(anchorNode, domSelection.anchorOffset);
  } catch {
    return;
  }
  if (position < 0 || position > state.doc.content.size) return;
  const selection = TextSelection.near(state.doc.resolve(position), 1);
  if (selection.eq(state.selection)) return;
  view.dispatch(state.tr.setSelection(selection));
}

export const VideoDocumentListIndent = Extension.create({
  name: 'videoDocumentListIndent',
  priority: 1_000,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        synchronizeVideoDocumentEditorSelectionFromDom(this.editor);
        return (
          indentRootParagraphIntoPreviousListItem(this.editor) ||
          this.editor.commands.sinkListItem(this.editor.isActive('taskItem') ? 'taskItem' : 'listItem')
        );
      },
    };
  },
});
