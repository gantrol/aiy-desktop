import type { TermCategoryDto, TermListItem } from '@/shared/contracts';
import { primaryTermClassification } from '@/shared/term-localization';

// The compact picker can use the two configured facet columns when a recursive
// classification tree is unavailable. Dictionary overview navigation itself
// is classification-based and has no depth limit.
export const OTHER_DOMAIN = '__other_domain__';
export const OTHER_TYPE = '__other_type__';

export interface DictionaryBrowseContext {
  classificationId: string | null;
  classificationPath: string[];
  /** Fixed for the lifetime of one paginated sibling-list session. */
  anchorTermId: string;
}

export interface DictionaryBrowseQuery {
  facetValueIds: string[];
  missingFacetSystemRoles: [];
  classificationIds: string[];
  missingClassification: boolean;
}

export interface DictionaryBrowseBreadcrumb {
  path: string[];
}

function pathSegments(path: string) {
  return path
    .split(' / ')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function deriveDictionaryBrowseContext(
  term: TermListItem,
  categories: TermCategoryDto[],
): DictionaryBrowseContext {
  const classification = primaryTermClassification(term);
  const category = categories.find((item) => item.id === classification?.id);
  const classificationPath = pathSegments(
    category?.path || category?.name || classification?.path || classification?.name || '',
  );
  return {
    classificationId: category?.id ?? classification?.id ?? null,
    classificationPath,
    anchorTermId: term.id,
  };
}

export function dictionaryBrowseQuery(context: DictionaryBrowseContext): DictionaryBrowseQuery {
  return {
    facetValueIds: [],
    missingFacetSystemRoles: [],
    classificationIds: context.classificationId ? [context.classificationId] : [],
    missingClassification: !context.classificationId,
  };
}

export function dictionaryBrowseBreadcrumb(
  context: DictionaryBrowseContext,
  categories: TermCategoryDto[],
  uncategorized: string,
): DictionaryBrowseBreadcrumb {
  const category = categories.find((item) => item.id === context.classificationId);
  const path = pathSegments(category?.path || category?.name || '');
  return {
    path: path.length ? path : context.classificationPath.length ? context.classificationPath : [uncategorized],
  };
}
