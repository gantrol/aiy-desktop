import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type Selection } from '@tiptap/pm/state';
import { isOutlineChildList } from '@/shared/outline-structure';

/** An item owns its body and Notes. Child items retain their own comment targets. */
export function contentCommentSelfBlocks(node: ProseMirrorNode, position: number) {
  if (node.type.name !== 'listItem') return [{ node, position }];
  const blocks: { node: ProseMirrorNode; position: number }[] = [];
  node.forEach((child, offset) => {
    if (!isOutlineChildList({ type: child.type.name, attrs: child.attrs })) {
      blocks.push({ node: child, position: position + 1 + offset });
    }
  });
  return blocks;
}

export function contentCommentSelfText(node: ProseMirrorNode) {
  return contentCommentSelfBlocks(node, 0)
    .map(({ node: block }) => block.textBetween(0, block.content.size, ' '))
    .join(' ');
}

/** Coordinates are relative to the node's content, including block wrappers. */
export function contentCommentRangeBelongsToSelf(node: ProseMirrorNode, from: number, to: number) {
  if (from < 0 || from >= to || to > node.content.size) return false;
  if (node.type.name !== 'listItem') return true;
  let includesChildren = false;
  node.forEach((child, offset) => {
    if (!isOutlineChildList({ type: child.type.name, attrs: child.attrs })) return;
    if (from < offset + child.nodeSize && to > offset) includesChildren = true;
  });
  return !includesChildren;
}

/** A menu on a parent must not reuse an unrelated selection inside its descendants. */
export function contentCommentSelectionBelongsToItem(node: ProseMirrorNode, position: number, selection: Selection) {
  return (
    selection instanceof TextSelection &&
    !selection.empty &&
    contentCommentRangeBelongsToSelf(node, selection.from - position - 1, selection.to - position - 1)
  );
}
