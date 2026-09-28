import type { BlockNode } from '@/shared/contracts/block-document';

export const mathSourceLimit = 16_384;
export const isMathNode = (type: string | undefined) => type === 'inlineMath' || type === 'blockMath';

/** Dollar runs inside TeX must not close its Markdown delimiter. */
export function mathMarkdown(node: BlockNode, _helpers?: unknown, context?: { previousNode?: BlockNode | null }) {
  const latex = String(node.attrs?.latex ?? '');
  const longest = Math.max(0, ...Array.from(latex.matchAll(/\$+/gu), (match) => match[0].length));
  const delimiter = '$'.repeat(Math.max(node.type === 'blockMath' ? 2 : 1, longest + 1));
  if (node.type === 'blockMath') return `${delimiter}\n${latex}\n${delimiter}`;
  const padding = latex.startsWith('$') || latex.endsWith('$') || (latex.startsWith(' ') && latex.endsWith(' '));
  // Adjacent inline delimiters would join into a longer run and merge two formulas.
  const separator = context?.previousNode?.type === 'inlineMath' ? ' ' : '';
  return `${separator}${delimiter}${padding ? ` ${latex} ` : latex}${delimiter}`;
}
