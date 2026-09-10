import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';

export function contentRootBlock(editor: Editor, blockId?: string) {
  const { doc, selection } = editor.state;
  let result: { node: Node; index: number; position: number } | null = null;
  doc.forEach((node, position, index) => {
    if (blockId ? node.attrs.blockId === blockId : index === selection.$from.index(0))
      result = { node, position, index };
  });
  return result as { node: Node; index: number; position: number } | null;
}
