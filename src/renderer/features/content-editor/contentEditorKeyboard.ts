import { Extension, type Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { deleteEmptyListLeaf } from '@/renderer/features/content-editor/contentListDeletion';
import { commandMatchesShortcut } from '@/renderer/commands/app-shortcuts';

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

export function synchronizeContentEditorSelectionFromDom(editor: Editor, editorView?: EditorView) {
  const state = editor.state;
  // A DOM caret cannot represent the editor's gap cursor or node selection semantics.
  if (!(state.selection instanceof TextSelection)) return;
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
  const $position = state.doc.resolve(position);
  // Searching near a block boundary can select the next image instead of the gap before it.
  if (!$position.parent.inlineContent) return;
  const selection = TextSelection.create(state.doc, position);
  if (selection.eq(state.selection)) return;
  view.dispatch(state.tr.setSelection(selection));
}

export const ContentEditorKeyboard = Extension.create({
  name: 'contentEditorKeyboard',
  priority: 1_000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown: (view, event) => {
            if (event.isComposing || view.composing) return false;
            if (event.key === 'Enter' && event.repeat) {
              event.preventDefault();
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              synchronizeContentEditorSelectionFromDom(this.editor, view);
            }
            if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
              return (
                indentRootParagraphIntoPreviousListItem(this.editor) ||
                this.editor.commands.sinkListItem(this.editor.isActive('taskItem') ? 'taskItem' : 'listItem')
              );
            }
            for (let level = 2; level <= 6; level += 1) {
              if (!commandMatchesShortcut(event, window.desktopApi?.appPlatform ?? 'win32', `format.heading.${level}`))
                continue;
              event.preventDefault();
              this.editor
                .chain()
                .setHeading({ level: level as 2 | 3 | 4 | 5 | 6 })
                .run();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteEmptyListLeaf(this.editor, -1),
      Delete: () => deleteEmptyListLeaf(this.editor, 1),
    };
  },
});
