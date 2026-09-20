import type { BlockNode } from '@/shared/contracts/block-document';

const listTypes = new Set(['bulletList', 'orderedList', 'taskList']);
const childListTypes = new Set(['bulletList', 'orderedList']);

export function isOutlineChildList(node: Pick<BlockNode, 'type' | 'attrs'>): boolean {
  return childListTypes.has(node.type ?? '') && node.attrs?.outlineRole !== 'NOTE';
}

export function isOutlineNoteList(node: Pick<BlockNode, 'type' | 'attrs'>): boolean {
  return listTypes.has(node.type ?? '') && (node.type === 'taskList' || node.attrs?.outlineRole === 'NOTE');
}
