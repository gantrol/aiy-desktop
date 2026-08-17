import type { MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';

export type MaterialStackTarget = { kind: 'ALBUM'; id: string } | { kind: 'CREATION'; id: string };

export interface MaterialStackDescriptor {
  key: string;
  title: string;
  target: MaterialStackTarget;
}

export interface MaterialStack {
  key: string;
  title: string | null;
  target: MaterialStackTarget | null;
  items: MaterialLibraryItem[];
}

interface HierarchyIndex<Node extends { id: string }> {
  byId: ReadonlyMap<string, Node>;
  parentById: ReadonlyMap<string, string>;
}

/** Returns the first real node below `ancestorId`; the ancestor itself never becomes a stack. */
export function immediateDescendantUnder<Node extends { id: string }>(
  leafId: string,
  ancestorId: string,
  hierarchy: HierarchyIndex<Node>,
): Node | null {
  if (leafId === ancestorId || !hierarchy.byId.has(leafId)) return null;
  let currentId = leafId;
  const visited = new Set<string>();
  while (!visited.has(currentId)) {
    visited.add(currentId);
    const parentId = hierarchy.parentById.get(currentId);
    if (!parentId) return null;
    if (parentId === ancestorId) return hierarchy.byId.get(currentId) ?? null;
    currentId = parentId;
  }
  return null;
}

/** Finds the top-most real album for an item that is being viewed outside an album root. */
export function rootAncestor<Node extends { id: string }>(
  leafId: string,
  hierarchy: HierarchyIndex<Node>,
): Node | null {
  let current = hierarchy.byId.get(leafId) ?? null;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const parentId = hierarchy.parentById.get(current.id);
    const parent = parentId ? (hierarchy.byId.get(parentId) ?? null) : null;
    if (!parent) return current;
    current = parent;
  }
  return null;
}

/**
 * Preserves the material order while folding later cursor pages into stacks
 * that have already appeared. Ungrouped/root materials remain one-item tiles.
 */
export function collectMaterialStacks(
  items: readonly MaterialLibraryItem[],
  descriptorForItem: (item: MaterialLibraryItem) => MaterialStackDescriptor | null,
): MaterialStack[] {
  const stacks: MaterialStack[] = [];
  const grouped = new Map<string, MaterialStack>();

  for (const item of items) {
    const descriptor = descriptorForItem(item);
    if (!descriptor) {
      stacks.push({ key: `material:${item.key}`, title: null, target: null, items: [item] });
      continue;
    }
    const existing = grouped.get(descriptor.key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    const stack: MaterialStack = { ...descriptor, items: [item] };
    grouped.set(descriptor.key, stack);
    stacks.push(stack);
  }

  return stacks;
}
