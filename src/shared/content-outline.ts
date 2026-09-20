import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import type { ReferenceScope } from '@/shared/contracts/content-source';
import { isOutlineChildList } from '@/shared/outline-structure';

export interface ContentOutlineNode {
  id: string;
  blockId: string | null;
  title: string;
  kind: string;
  position: number;
  children: ContentOutlineNode[];
}
export interface ContentOutlineRow {
  node: ContentOutlineNode;
  parentId: string | null;
  depth: number;
}
const transparent = new Set(['doc', 'bulletList', 'orderedList', 'taskList']);
const leaves = new Set(['paragraph', 'heading', 'codeBlock', 'image', 'table', 'contentReference', 'linkCard']);
const items = new Set(['listItem', 'taskItem']);

export function blockNodeText(node: BlockNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'image') return String(node.attrs?.alt ?? '');
  if (node.type === 'linkCard') return String(node.attrs?.title || node.attrs?.url || '');
  if (node.type === 'creatorTerm' || node.type === 'creatorRecipe') return String(node.attrs?.promptText ?? '');
  return (node.content ?? []).map(blockNodeText).join(items.has(node.type ?? '') ? ' ' : '');
}
function nodeSize(node: BlockNode): number {
  if (node.type === 'text') return (node.text ?? '').length;
  if (
    ['hardBreak', 'image', 'horizontalRule', 'contentReference', 'linkCard', 'creatorTerm', 'creatorRecipe'].includes(
      node.type ?? '',
    )
  )
    return 1;
  return 2 + (node.content ?? []).reduce((size, child) => size + nodeSize(child), 0);
}

/** A read-only projection of the editor document, never a second writable outline. */
export function contentOutline(root: BlockNode): ContentOutlineNode[] {
  const identities = new Set<string>();
  function visit(children: readonly BlockNode[], start: number): ContentOutlineNode[] {
    const result: ContentOutlineNode[] = [];
    const headings: { level: number; node: ContentOutlineNode }[] = [];
    let position = start;
    for (const child of children) {
      const kind = child.type ?? '';
      const rawId = child.attrs?.blockId;
      const blockId = typeof rawId === 'string' && rawId && !identities.has(rawId) ? rawId : null;
      if (blockId) identities.add(blockId);
      let projected: ContentOutlineNode[];
      if (transparent.has(kind)) projected = visit(child.content ?? [], position + 1);
      else {
        const first = items.has(kind) ? child.content?.[0] : child;
        const nested = leaves.has(kind) ? [] : visit(child.content ?? [], position + 1);
        const firstId = child.content?.[0]?.attrs?.blockId;
        projected = [
          {
            id: blockId ?? `position:${position}`,
            blockId,
            title: blockNodeText(first ?? child)
              .trim()
              .replace(/\s+/gu, ' ')
              .slice(0, 160),
            kind,
            position,
            children: items.has(kind)
              ? nested.filter((node) => (firstId ? node.blockId !== firstId : node.position !== position + 1))
              : nested,
          },
        ];
      }
      if (kind === 'heading') {
        const level = Number(child.attrs?.level) || 1;
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        (headings[headings.length - 1]?.node.children ?? result).push(...projected);
        headings.push({ level, node: projected[0] });
      } else (headings[headings.length - 1]?.node.children ?? result).push(...projected);
      position += nodeSize(child);
    }
    return result;
  }
  return visit(root.content ?? [], 0);
}

export function outlineIndex(forest: readonly ContentOutlineNode[]) {
  const nodes = new Map<string, ContentOutlineNode>();
  const parents = new Map<string, string | null>();
  const visit = (children: readonly ContentOutlineNode[], parent: string | null) => {
    for (const node of children) {
      nodes.set(node.id, node);
      parents.set(node.id, parent);
      visit(node.children, node.id);
    }
  };
  visit(forest, null);
  return { nodes, parents };
}

export function contentOutlineRows(
  forest: readonly ContentOutlineNode[],
  scope: string | null,
  collapsed: ReadonlySet<string>,
  query = '',
): ContentOutlineRow[] {
  const index = outlineIndex(forest);
  const root = scope ? index.nodes.get(scope) : null;
  const needle = query.trim().toLocaleLowerCase();
  const retained = new Set<string>();
  if (needle) {
    for (const node of index.nodes.values()) {
      if (!node.title.toLocaleLowerCase().includes(needle)) continue;
      for (let id: string | null | undefined = node.id; id; id = index.parents.get(id)) retained.add(id);
    }
  }
  const rows: ContentOutlineRow[] = [];
  const visit = (children: readonly ContentOutlineNode[], depth: number, parentId: string | null) => {
    for (const node of children) {
      if (needle && !retained.has(node.id)) continue;
      rows.push({ node, depth, parentId });
      if (!collapsed.has(node.id)) visit(node.children, depth + 1, node.id);
    }
  };
  visit(root ? [root] : forest, 1, null);
  return rows;
}

/** Fixed citations resolve exactly one persisted ID. No title matching or position fallback. */
export function selectContentBlock(
  document: BlockDocument,
  blockId: string,
  section = false,
  scope?: ReferenceScope,
  outlineMode = false,
): BlockDocument {
  const matches: { node: BlockNode; siblings: readonly BlockNode[]; index: number; parent: BlockNode | null }[] = [];
  const visit = (parent: BlockNode) => {
    const siblings = parent.content ?? [];
    siblings.forEach((node, index) => {
      if (node.attrs?.blockId === blockId) matches.push({ node, siblings, index, parent });
      visit(node);
    });
  };
  visit(document.root);
  if (matches.length !== 1) throw new Error(matches.length ? 'BLOCK_ID_AMBIGUOUS' : 'BLOCK_ID_UNAVAILABLE');
  const { node, siblings, index, parent } = matches[0];
  section = scope ? scope === 'SECTION' : section;
  if (scope === 'SUBTREE' && !items.has(node.type ?? '')) throw new Error('BLOCK_SCOPE_UNSUPPORTED');
  if (section && node.type !== 'heading') throw new Error('BLOCK_SCOPE_UNSUPPORTED');
  let selected = [node];
  if (scope === 'SELF' && items.has(node.type ?? '')) {
    selected = [
      {
        ...node,
        content: node.content?.filter((child) =>
          outlineMode ? !isOutlineChildList(child) : !transparent.has(child.type ?? ''),
        ),
      },
    ];
  }
  if (section) {
    const next = siblings
      .slice(index + 1)
      .findIndex((item) => item.type === 'heading' && Number(item.attrs?.level) <= Number(node.attrs?.level));
    selected = siblings.slice(index, next < 0 ? undefined : index + 1 + next) as BlockNode[];
  }
  if (items.has(node.type ?? '') && parent && ['bulletList', 'orderedList', 'taskList'].includes(parent.type ?? '')) {
    selected = [
      {
        ...parent,
        attrs:
          parent.type === 'orderedList'
            ? { ...parent.attrs, start: Number(parent.attrs?.start ?? 1) + index }
            : parent.attrs,
        content: selected,
      },
    ];
  } else if (['tableCell', 'tableHeader', 'tableRow'].includes(node.type ?? ''))
    throw new Error('BLOCK_SCOPE_UNSUPPORTED');
  return { ...document, root: { type: 'doc', content: selected } };
}
