import { describe, expect, it } from 'vitest';
import type { TermCategoryDto, TermListItem } from '../src/shared/contracts';
import {
  deriveDictionaryBrowseContext,
  dictionaryBrowseBreadcrumb,
  dictionaryBrowseQuery,
} from '../src/renderer/components/dictionary/dictionary-navigation';

const categories: TermCategoryDto[] = [
  {
    id: 'category-clothing',
    stableKey: 'clothing',
    name: '衣物',
    path: '衣物',
    parentId: null,
    primaryValueId: 'domain-clothing',
    primaryName: '衣物',
    secondaryValueId: null,
    secondaryName: null,
  },
  {
    id: 'category-dress',
    stableKey: 'clothing.dress',
    name: '衣物 / 连衣裙',
    path: '衣物 / 连衣裙',
    parentId: 'category-clothing',
    primaryValueId: 'domain-clothing',
    primaryName: '衣物',
    secondaryValueId: 'type-dress',
    secondaryName: '连衣裙',
  },
  {
    id: 'category-long-dress',
    stableKey: 'clothing.dress.long',
    name: '衣物 / 连衣裙 / 连衣长裙',
    path: '衣物 / 连衣裙 / 连衣长裙',
    parentId: 'category-dress',
    primaryValueId: 'domain-clothing',
    primaryName: '衣物',
    secondaryValueId: 'type-long-dress',
    secondaryName: '连衣长裙',
  },
];

function term(classificationId: string | null): TermListItem {
  const classification = classificationId ? categories.find((category) => category.id === classificationId)! : null;
  return {
    id: 'term-long-dress',
    stableKey: 'clothing.long-dress',
    title: '曳地长裙',
    titleLocale: 'zh',
    definition: '',
    aliases: [],
    localizations: [],
    editorialState: 'APPROVED',
    revisionNo: 1,
    termRevisionId: 'term-long-dress-revision-1',
    modelExpressions: [],
    classificationIds: classification ? [classification.id] : [],
    classifications: classification ? [classification] : [],
    primaryDirectoryClassificationId: classification?.id ?? null,
    hasDraft: false,
    mediaPreview: { totalCount: 0, items: [] },
    metrics: {
      citationCount: 0,
      distinctPromptSeries: 0,
      positiveEvidence: 0,
      negativeEvidence: 0,
      pendingIssues: 0,
      lastValidatedAt: null,
    },
  };
}

describe('dictionary sibling navigation context', () => {
  it('keeps the complete recursive classification path and queries its subtree', () => {
    const context = deriveDictionaryBrowseContext(term('category-long-dress'), categories);
    expect(context).toEqual({
      classificationId: 'category-long-dress',
      classificationPath: ['衣物', '连衣裙', '连衣长裙'],
      anchorTermId: 'term-long-dress',
    });
    expect(dictionaryBrowseQuery(context)).toEqual({
      facetValueIds: [],
      missingFacetSystemRoles: [],
      classificationIds: ['category-long-dress'],
      missingClassification: false,
    });
    expect(dictionaryBrowseBreadcrumb(context, categories, '未分类')).toEqual({
      path: ['衣物', '连衣裙', '连衣长裙'],
    });
  });

  it('turns an unclassified term into an explicit missing-classification query', () => {
    const context = deriveDictionaryBrowseContext(term(null), categories);
    expect(context).toEqual({ classificationId: null, classificationPath: [], anchorTermId: 'term-long-dress' });
    expect(dictionaryBrowseQuery(context)).toEqual({
      facetValueIds: [],
      missingFacetSystemRoles: [],
      classificationIds: [],
      missingClassification: true,
    });
    expect(dictionaryBrowseBreadcrumb(context, categories, '未分类')).toEqual({ path: ['未分类'] });
  });
});
