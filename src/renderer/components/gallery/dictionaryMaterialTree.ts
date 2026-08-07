import type { AssetDto, FacetDefinitionDto, TermListItem } from '@/shared/contracts';
import { resolveTermTitle, termFacetValueIds } from '@/shared/term-localization';
import { OTHER_DOMAIN, OTHER_TYPE } from '@/renderer/components/dictionary/dictionary-navigation';

export interface DictionaryMaterialTermNode {
  kind: 'term';
  id: string;
  title: string;
  term: TermListItem;
  previewAssets: AssetDto[];
}

export interface DictionaryMaterialTypeNode {
  kind: 'type';
  id: string;
  title: string;
  typeId: string;
  terms: DictionaryMaterialTermNode[];
  previewAssets: AssetDto[];
}

export interface DictionaryMaterialDomainNode {
  kind: 'domain';
  id: string;
  title: string;
  domainId: string;
  types: DictionaryMaterialTypeNode[];
  previewAssets: AssetDto[];
}

export interface DictionaryMaterialTree {
  domains: DictionaryMaterialDomainNode[];
  previewAssets: AssetDto[];
}

function uniqueAssets(terms: readonly TermListItem[], limit = 5) {
  const assets: AssetDto[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    for (const media of term.mediaPreview.items) {
      if (seen.has(media.asset.id)) continue;
      seen.add(media.asset.id);
      assets.push(media.asset);
      if (assets.length === limit) return assets;
    }
  }
  return assets;
}

/**
 * The dictionary classification tree is a query projection. A term may appear
 * in more than one branch; only its media relationship remains authoritative.
 */
export function buildDictionaryMaterialTree(
  terms: readonly TermListItem[],
  facets: readonly FacetDefinitionDto[],
  uncategorizedLabel: string,
  locale: 'zh' | 'en',
): DictionaryMaterialTree {
  const domainFacet = facets.find((facet) => facet.systemRole === 'PRIMARY_CLASSIFICATION');
  const typeFacet = facets.find((facet) => facet.systemRole === 'SECONDARY_CLASSIFICATION');
  const domainValues = domainFacet?.values ?? [];
  const typeValues = typeFacet?.values ?? [];
  const domainTitle = new Map(domainValues.map((value) => [value.id, value.name]));
  const typeTitle = new Map(typeValues.map((value) => [value.id, value.name]));
  const domainOrder = new Map(domainValues.map((value, index) => [value.id, index]));
  const typeOrder = new Map(typeValues.map((value, index) => [value.id, index]));
  const activeTerms = terms.filter((term) => term.editorialState !== 'ARCHIVED' && term.mediaPreview.totalCount > 0);
  const grouped = new Map<string, Map<string, TermListItem[]>>();

  for (const term of activeTerms) {
    const facetValueIds = termFacetValueIds(term);
    const domainIds = domainValues.filter((value) => facetValueIds.includes(value.id)).map((value) => value.id);
    const typeIds = typeValues.filter((value) => facetValueIds.includes(value.id)).map((value) => value.id);
    for (const domainId of domainIds.length ? domainIds : [OTHER_DOMAIN]) {
      const byType = grouped.get(domainId) ?? new Map<string, TermListItem[]>();
      grouped.set(domainId, byType);
      for (const typeId of typeIds.length ? typeIds : [OTHER_TYPE]) {
        const branchTerms = byType.get(typeId) ?? [];
        branchTerms.push(term);
        byType.set(typeId, branchTerms);
      }
    }
  }

  const collator = new Intl.Collator(locale === 'zh' ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' });
  const domains = [...grouped.entries()]
    .sort(
      ([left], [right]) =>
        (domainOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (domainOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        collator.compare(domainTitle.get(left) ?? uncategorizedLabel, domainTitle.get(right) ?? uncategorizedLabel),
    )
    .map(([domainId, byType]): DictionaryMaterialDomainNode => {
      const types = [...byType.entries()]
        .sort(
          ([left], [right]) =>
            (typeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (typeOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
            collator.compare(typeTitle.get(left) ?? uncategorizedLabel, typeTitle.get(right) ?? uncategorizedLabel),
        )
        .map(([typeId, branchTerms]): DictionaryMaterialTypeNode => {
          const sortedTerms = [...branchTerms].sort(
            (left, right) =>
              collator.compare(resolveTermTitle(left, locale), resolveTermTitle(right, locale)) ||
              left.id.localeCompare(right.id),
          );
          return {
            kind: 'type',
            id: `dictionary-type:${domainId}:${typeId}`,
            title: typeTitle.get(typeId) ?? uncategorizedLabel,
            typeId,
            terms: sortedTerms.map((term) => ({
              kind: 'term',
              id: `dictionary-term:${domainId}:${typeId}:${term.id}`,
              title: resolveTermTitle(term, locale),
              term,
              previewAssets: uniqueAssets([term]),
            })),
            previewAssets: uniqueAssets(sortedTerms),
          };
        });
      const domainTerms = [...new Map([...byType.values()].flat().map((term) => [term.id, term])).values()];
      return {
        kind: 'domain',
        id: `dictionary-domain:${domainId}`,
        title: domainTitle.get(domainId) ?? uncategorizedLabel,
        domainId,
        types,
        previewAssets: uniqueAssets(domainTerms),
      };
    });

  return { domains, previewAssets: uniqueAssets(activeTerms) };
}
