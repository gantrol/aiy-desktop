import type { Editor } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

export interface ItemLocation {
  item: ProseMirrorNode;
  itemPos: number;
  list: ProseMirrorNode;
  listPos: number;
  listDepth: number;
  index: number;
}

export function itemAt(state: EditorState, position: number): ItemLocation | null {
  const resolved = state.doc.resolve(position);
  for (let depth = resolved.depth; depth >= 2; depth -= 1) {
    if (resolved.node(depth).type.name !== 'listItem') continue;
    const listDepth = depth - 1;
    if (!['bulletList', 'orderedList', 'taskList'].includes(resolved.node(listDepth).type.name)) return null;
    for (let ancestor = 1; ancestor <= listDepth; ancestor += 1) {
      if (resolved.node(ancestor).attrs.outlineRole === 'NOTE' || resolved.node(ancestor).type.name === 'taskList')
        return null;
    }
    return {
      item: resolved.node(depth),
      itemPos: resolved.before(depth),
      list: resolved.node(listDepth),
      listPos: resolved.before(listDepth),
      listDepth,
      index: resolved.index(listDepth),
    };
  }
  return null;
}

export function itemById(state: EditorState, blockId: string): ItemLocation | null {
  let position: number | null = null;
  state.doc.descendants((node, pos) => {
    if (position === null && node.type.name === 'listItem' && node.attrs.blockId === blockId) position = pos;
  });
  return position === null ? null : itemAt(state, position + 2);
}

export function freshOutlineItem(editor: Editor, content: Fragment = Fragment.empty) {
  const paragraph = editor.schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }, content);
  return editor.schema.nodes.listItem.create({ blockId: crypto.randomUUID() }, paragraph);
}
