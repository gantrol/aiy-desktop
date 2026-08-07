import type { DictionaryClassificationNodeDto } from '@/shared/contracts';

const ROOT_KEY = '__root__';

export interface ClassificationTreeIndex {
  byId: Map<string, DictionaryClassificationNodeDto>;
  childrenByParent: Map<string, DictionaryClassificationNodeDto[]>;
  roots: DictionaryClassificationNodeDto[];
}

export function classificationParentKey(parentId: string | null) {
  return parentId ?? ROOT_KEY;
}

export function buildClassificationTree(nodes: readonly DictionaryClassificationNodeDto[]): ClassificationTreeIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, DictionaryClassificationNodeDto[]>();
  for (const node of nodes) {
    const key = classificationParentKey(node.parentId);
    const children = childrenByParent.get(key) ?? [];
    children.push(node);
    childrenByParent.set(key, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.sortOrder - right.sortOrder || left.stableKey.localeCompare(right.stableKey));
  }
  return { byId, childrenByParent, roots: childrenByParent.get(ROOT_KEY) ?? [] };
}

export function classificationRoot(
  node: DictionaryClassificationNodeDto,
  tree: ClassificationTreeIndex,
): DictionaryClassificationNodeDto {
  const visited = new Set<string>();
  let current = node;
  while (current.parentId) {
    if (visited.has(current.id)) return current;
    visited.add(current.id);
    const parent = tree.byId.get(current.parentId);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

export function classificationAncestors(id: string, tree: ClassificationTreeIndex) {
  const ancestors: DictionaryClassificationNodeDto[] = [];
  const visited = new Set<string>();
  let current = tree.byId.get(id);
  while (current?.parentId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const parent = tree.byId.get(current.parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

export function classificationDescendantIds(id: string, tree: ClassificationTreeIndex) {
  const ids = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.shift()!;
    if (ids.has(current)) continue;
    ids.add(current);
    pending.push(...(tree.childrenByParent.get(classificationParentKey(current)) ?? []).map((node) => node.id));
  }
  return ids;
}

export function classificationSearchMatches(
  query: string,
  tree: ClassificationTreeIndex,
): { matchingIds: Set<string>; visibleIds: Set<string> } {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    const all = new Set(tree.byId.keys());
    return { matchingIds: all, visibleIds: all };
  }
  const matchingIds = new Set(
    [...tree.byId.values()]
      .filter((node) =>
        [node.name, ...node.localizations.map((localization) => localization.name), node.path, node.stableKey].some(
          (value) => value.toLocaleLowerCase().includes(normalized),
        ),
      )
      .map((node) => node.id),
  );
  const visibleIds = new Set(matchingIds);
  for (const id of matchingIds) {
    for (const ancestor of classificationAncestors(id, tree)) visibleIds.add(ancestor.id);
  }
  return { matchingIds, visibleIds };
}
