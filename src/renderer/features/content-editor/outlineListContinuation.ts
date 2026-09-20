import type { EditorState } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import { isOutlineChildList } from '@/shared/outline-structure';

/** Repair newly escaped root text without rewriting root blocks from an existing outline. */
export function continueOutlineLists(previous: EditorState, state: EditorState) {
  const priorRootIds = new Set<string>();
  const priorRootWithoutId = new Set<number>();
  previous.doc.forEach((node, _offset, index) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
    const id = node.attrs.blockId;
    if (typeof id === 'string' && id) priorRootIds.add(id);
    else priorRootWithoutId.add(index);
  });
  const transaction = state.tr;
  state.doc.forEach((node, offset, index) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
    const id = node.attrs.blockId;
    if ((typeof id === 'string' && priorRootIds.has(id)) || (!id && priorRootWithoutId.has(index))) return;
    const position = transaction.mapping.map(offset);
    const previous = transaction.doc.resolve(position).nodeBefore;
    const previousList = previous && isOutlineChildList({ type: previous.type.name, attrs: previous.attrs });
    if (
      previousList &&
      node.type.name === 'paragraph' &&
      !node.content.size &&
      offset + node.nodeSize === state.doc.content.size
    ) {
      transaction.delete(position, position + node.nodeSize);
      return;
    }
    if (node.type.name === 'heading') transaction.setNodeMarkup(position, state.schema.nodes.paragraph, node.attrs);
    const range = transaction.doc.resolve(position).blockRange(transaction.doc.resolve(position + node.nodeSize));
    if (!range) return;
    transaction.wrap(range, [
      {
        type: previousList ? previous.type : state.schema.nodes.bulletList,
        attrs: { ...(previousList ? previous.attrs : {}), blockId: crypto.randomUUID() },
      },
      { type: state.schema.nodes.listItem, attrs: { blockId: crypto.randomUUID() } },
    ]);
    if (previousList && canJoin(transaction.doc, position)) transaction.join(position);
  });
  // A repair must not cause StarterKit to append another paragraph or clear the repaired empty list.
  return transaction.docChanged
    ? transaction.setMeta('skipTrailingNode', true).setMeta('preventClearDocument', true)
    : null;
}
