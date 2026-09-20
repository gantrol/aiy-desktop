import type { BlockNode } from '@/shared/contracts/block-document';
import { isOutlineChildList } from '@/shared/outline-structure';

export type OutlineDropPlacement = 'BEFORE' | 'AFTER' | 'INSIDE';

export interface OutlineItemRecord {
  node: BlockNode;
  ancestors: readonly string[];
  list: BlockNode;
  index: number;
}

function idOf(node: BlockNode): string | null {
  return typeof node.attrs?.blockId === 'string' && node.attrs.blockId ? node.attrs.blockId : null;
}

export function outlineItemRecords(root: BlockNode) {
  const records = new Map<string, OutlineItemRecord>();
  const visit = (list: BlockNode, ancestors: readonly string[]) => {
    for (const [index, item] of (list.content ?? []).entries()) {
      if (item.type !== 'listItem') continue;
      const id = idOf(item);
      if (!id) continue;
      records.set(id, { node: item, ancestors, list, index });
      for (const child of item.content ?? []) {
        if (isOutlineChildList(child)) visit(child, [...ancestors, id]);
      }
    }
  };
  for (const child of root.content ?? []) if (isOutlineChildList(child)) visit(child, []);
  return records;
}

export function outlineMoveTargets(root: BlockNode, selectedIds: readonly string[]) {
  const records = outlineItemRecords(root);
  const requested = new Set(selectedIds);
  if (!requested.size || [...requested].some((id) => !records.has(id))) return new Set<string>();
  return new Set(
    [...records.entries()]
      .filter(([targetId, target]) => !requested.has(targetId) && !target.ancestors.some((id) => requested.has(id)))
      .map(([id]) => id),
  );
}

/** Selected parents carry their descendants, so every branch is operated on once. */
export function outlineSelectionRoots(root: BlockNode, selectedIds: readonly string[]): string[] {
  const records = outlineItemRecords(root);
  const requested = new Set(selectedIds);
  if (!requested.size || [...requested].some((id) => !records.has(id))) return [];
  return [...records.entries()]
    .filter(([id, record]) => requested.has(id) && !record.ancestors.some((ancestor) => requested.has(ancestor)))
    .map(([id]) => id);
}

export function canMoveOutlineStructure(root: BlockNode, selectedIds: readonly string[], targetId: string) {
  return outlineMoveTargets(root, selectedIds).has(targetId);
}

/** Move existing items, retaining their block identities and every note/media child. */
export function moveOutlineStructure(
  root: BlockNode,
  selectedIds: readonly string[],
  targetId: string,
  placement: OutlineDropPlacement,
): BlockNode | null {
  const records = outlineItemRecords(root);
  if (!canMoveOutlineStructure(root, selectedIds, targetId)) return null;
  const requested = new Set(selectedIds);
  const moving = [...records.entries()]
    .filter(([id, record]) => requested.has(id) && !record.ancestors.some((ancestor) => requested.has(ancestor)))
    .map(([id, record]) => ({ id, ...record }));
  const target = records.get(targetId)!;
  const oneList = moving.length > 0 && moving.every((record) => record.list === moving[0].list);
  const consecutive = oneList && moving.every((record, index) => record.index === moving[0].index + index);
  if (consecutive) {
    if (
      target.list === moving[0].list &&
      ((placement === 'BEFORE' && moving.at(-1)!.index + 1 === target.index) ||
        (placement === 'AFTER' && target.index + 1 === moving[0].index))
    )
      return null;
    if (placement === 'INSIDE' && moving.at(-1)!.index === (moving[0].list.content?.length ?? 0) - 1) {
      const groups = (target.node.content ?? []).filter(isOutlineChildList);
      if (groups.at(-1) === moving[0].list && target.node.content?.at(-1) === moving[0].list) return null;
    }
  }
  const moveIds = new Set(moving.map(({ id }) => id));
  const moved = moving.map(({ node }) => node);

  const removeList = (list: BlockNode): BlockNode | null => {
    const content = (list.content ?? []).flatMap((item) => {
      if (item.type !== 'listItem') return [item];
      if (moveIds.has(idOf(item) ?? '')) return [];
      return [
        {
          ...item,
          content: (item.content ?? []).flatMap((child) => {
            if (!isOutlineChildList(child)) return [child];
            const remaining = removeList(child);
            return remaining ? [remaining] : [];
          }),
        },
      ];
    });
    return content.length ? { ...list, content } : null;
  };

  const without = {
    ...root,
    content: (root.content ?? []).flatMap((child) => {
      if (!isOutlineChildList(child)) return [child];
      const remaining = removeList(child);
      return remaining ? [remaining] : [];
    }),
  };

  let inserted = false;
  const insertList = (list: BlockNode): BlockNode => {
    const content: BlockNode[] = [];
    for (const item of list.content ?? []) {
      if (item.type !== 'listItem') {
        content.push(item);
        continue;
      }
      const id = idOf(item);
      if (id === targetId && placement === 'BEFORE') content.push(...moved);
      if (id === targetId && placement === 'INSIDE') {
        const children = [...(item.content ?? [])];
        let index = -1;
        for (let child = 0; child < children.length; child += 1) if (isOutlineChildList(children[child])) index = child;
        if (index < 0 || index !== children.length - 1) {
          children.push({
            type: list.type,
            attrs: { blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' },
            content: moved,
          });
        } else children[index] = { ...children[index], content: [...(children[index].content ?? []), ...moved] };
        content.push({ ...item, content: children });
        inserted = true;
      } else {
        content.push({
          ...item,
          content: (item.content ?? []).map((child) => (isOutlineChildList(child) ? insertList(child) : child)),
        });
      }
      if (id === targetId && placement === 'AFTER') content.push(...moved);
      if (id === targetId) inserted = true;
    }
    return { ...list, content };
  };
  const result = {
    ...without,
    content: (without.content ?? []).map((child) => (isOutlineChildList(child) ? insertList(child) : child)),
  };
  return inserted ? result : null;
}

export function deleteOutlineStructure(root: BlockNode, selectedIds: readonly string[]): BlockNode | null {
  const records = outlineItemRecords(root);
  const selected = new Set(selectedIds);
  if (!selected.size || [...selected].some((id) => !records.has(id))) return null;
  const removeList = (list: BlockNode): BlockNode | null => {
    const content = (list.content ?? []).flatMap((item) => {
      if (item.type !== 'listItem') return [item];
      if (selected.has(idOf(item) ?? '')) return [];
      return [
        {
          ...item,
          content: (item.content ?? []).flatMap((child) => {
            if (!isOutlineChildList(child)) return [child];
            const remaining = removeList(child);
            return remaining ? [remaining] : [];
          }),
        },
      ];
    });
    return content.length ? { ...list, content } : null;
  };
  const content = (root.content ?? []).flatMap((child) => {
    if (!isOutlineChildList(child)) return [child];
    const remaining = removeList(child);
    return remaining ? [remaining] : [];
  });
  if (!content.some(isOutlineChildList)) {
    content.push({
      type: 'bulletList',
      attrs: { blockId: crypto.randomUUID() },
      content: [
        {
          type: 'listItem',
          attrs: { blockId: crypto.randomUUID() },
          content: [{ type: 'paragraph', attrs: { blockId: crypto.randomUUID() } }],
        },
      ],
    });
  }
  return { ...root, content };
}
