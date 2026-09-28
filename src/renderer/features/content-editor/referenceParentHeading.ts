import type { Node } from '@tiptap/pm/model';

const contexts = new WeakMap<Node, { position: number; level: number }[]>();

/** One pass per immutable editor document, shared by all reference views. */
export function referenceParentHeading(document: Node, position: number) {
  let levels = contexts.get(document);
  if (!levels) {
    levels = [];
    document.descendants((node, offset) => {
      if (node.type.name === 'heading') levels!.push({ position: offset, level: Number(node.attrs.level) });
    });
    contexts.set(document, levels);
  }
  let low = 0,
    high = levels.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (levels[middle].position <= position) low = middle + 1;
    else high = middle;
  }
  return low ? levels[low - 1].level : 0;
}
