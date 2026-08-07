import type { TermCategoryDto, TermListItem } from '@/shared/contracts';

export const UNCLASSIFIED_CATEGORY_ID = '__unclassified_category__';

export interface DictionaryCategoryBrowserOption {
  id: string;
  stableKey: string;
  name: string;
  count: number;
  hasChildren: boolean;
}

export interface DictionaryCategoryBrowserColumn {
  parentId: string | null;
  selectedId: string | null;
  options: DictionaryCategoryBrowserOption[];
}

export interface DictionaryCategoryBrowserModel {
  columns: DictionaryCategoryBrowserColumn[];
  selectionPath: string[];
  selectedCategoryId: string | null;
  visibleTerms: TermListItem[];
}

function availableCategories(categories: TermCategoryDto[]) {
  return categories.filter((category) => category.state !== 'DISABLED' && category.selectable !== false);
}

function childrenIndex(categories: TermCategoryDto[]) {
  const children = new Map<string | null, TermCategoryDto[]>();
  for (const category of categories) {
    const parentId = category.parentId ?? null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(category);
    children.set(parentId, siblings);
  }
  return children;
}

export function defaultDictionaryCategorySelection(categories: TermCategoryDto[]) {
  const available = availableCategories(categories);
  const children = childrenIndex(available);
  const root = children.get(null)?.[0];
  return root ? [root.id] : [];
}

export function selectDictionaryCategoryAtLevel(currentPath: string[], level: number, categoryId: string) {
  return [...currentPath.slice(0, level), categoryId];
}

export function dictionaryCategoryPathForTerm(term: TermListItem, categories: TermCategoryDto[]) {
  const available = availableCategories(categories);
  const byId = new Map(available.map((category) => [category.id, category]));
  const preferredId =
    (term.primaryDirectoryClassificationId && byId.has(term.primaryDirectoryClassificationId)
      ? term.primaryDirectoryClassificationId
      : term.classificationIds.find((id) => byId.has(id))) ?? null;
  if (!preferredId) return [UNCLASSIFIED_CATEGORY_ID];

  const path: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(preferredId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function buildDictionaryCategoryBrowser(
  categories: TermCategoryDto[],
  terms: TermListItem[],
  requestedPath: string[],
  unclassifiedLabel: string,
): DictionaryCategoryBrowserModel {
  const available = availableCategories(categories);
  const byId = new Map(available.map((category) => [category.id, category]));
  const allCategoryIds = new Set(categories.map((category) => category.id));
  const children = childrenIndex(available);
  const directTermIds = new Map<string, Set<string>>();
  const termsById = new Map(terms.map((term) => [term.id, term]));
  for (const term of terms) {
    for (const categoryId of term.classificationIds) {
      if (!byId.has(categoryId)) continue;
      const ids = directTermIds.get(categoryId) ?? new Set<string>();
      ids.add(term.id);
      directTermIds.set(categoryId, ids);
    }
  }

  const subtreeTermCache = new Map<string, Set<string>>();
  const subtreeTermIds = (categoryId: string, ancestors = new Set<string>()): Set<string> => {
    const cached = subtreeTermCache.get(categoryId);
    if (cached) return cached;
    if (ancestors.has(categoryId)) return new Set(directTermIds.get(categoryId));
    const nextAncestors = new Set(ancestors).add(categoryId);
    const ids = new Set(directTermIds.get(categoryId));
    for (const child of children.get(categoryId) ?? []) {
      for (const termId of subtreeTermIds(child.id, nextAncestors)) ids.add(termId);
    }
    subtreeTermCache.set(categoryId, ids);
    return ids;
  };

  const unclassifiedTerms = terms.filter(
    (term) => !term.classificationIds.some((categoryId) => allCategoryIds.has(categoryId)),
  );
  const optionFor = (category: TermCategoryDto): DictionaryCategoryBrowserOption => ({
    id: category.id,
    stableKey: category.stableKey,
    name: category.name.split(' / ').at(-1) ?? category.name,
    count: subtreeTermIds(category.id).size,
    hasChildren: Boolean(children.get(category.id)?.length),
  });
  const rootOptions = (children.get(null) ?? []).map(optionFor);
  if (unclassifiedTerms.length) {
    rootOptions.push({
      id: UNCLASSIFIED_CATEGORY_ID,
      stableKey: UNCLASSIFIED_CATEGORY_ID,
      name: unclassifiedLabel,
      count: unclassifiedTerms.length,
      hasChildren: false,
    });
  }

  const selectionPath: string[] = [];
  let expectedParentId: string | null = null;
  for (const categoryId of requestedPath) {
    if (categoryId === UNCLASSIFIED_CATEGORY_ID && selectionPath.length === 0 && unclassifiedTerms.length) {
      selectionPath.push(categoryId);
      break;
    }
    const category = byId.get(categoryId);
    if (!category || (category.parentId ?? null) !== expectedParentId) break;
    selectionPath.push(categoryId);
    expectedParentId = category.id;
  }
  if (!selectionPath.length && rootOptions.length) {
    const fallback = defaultDictionaryCategorySelection(available);
    selectionPath.push(...(fallback.length ? fallback : [rootOptions[0]!.id]));
  }

  const columns: DictionaryCategoryBrowserColumn[] = [
    { parentId: null, selectedId: selectionPath[0] ?? null, options: rootOptions },
  ];
  for (let level = 0; level < selectionPath.length; level += 1) {
    const selectedId = selectionPath[level];
    if (selectedId === UNCLASSIFIED_CATEGORY_ID) break;
    const childOptions = (children.get(selectedId) ?? []).map(optionFor);
    if (!childOptions.length) break;
    columns.push({
      parentId: selectedId,
      selectedId: selectionPath[level + 1] ?? null,
      options: childOptions,
    });
  }

  const deepestId = selectionPath.at(-1) ?? null;
  const selectedCategoryId = deepestId && deepestId !== UNCLASSIFIED_CATEGORY_ID ? deepestId : null;
  const visibleTermIds =
    deepestId === UNCLASSIFIED_CATEGORY_ID
      ? new Set(unclassifiedTerms.map((term) => term.id))
      : selectedCategoryId
        ? subtreeTermIds(selectedCategoryId)
        : new Set(terms.map((term) => term.id));

  return {
    columns,
    selectionPath,
    selectedCategoryId,
    visibleTerms: [...visibleTermIds]
      .map((id) => termsById.get(id))
      .filter((term): term is TermListItem => Boolean(term)),
  };
}
