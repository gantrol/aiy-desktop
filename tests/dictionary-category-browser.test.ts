import { describe, expect, it } from 'vitest';
import type { TermCategoryDto, TermListItem } from '../src/shared/contracts';
import {
  buildDictionaryCategoryBrowser,
  dictionaryCategoryPathForTerm,
  selectDictionaryCategoryAtLevel,
} from '../src/renderer/components/dictionary/dictionary-category-browser';

const category = (id: string, name: string, parentId: string | null): TermCategoryDto => ({
  id,
  stableKey: id,
  name,
  path: name,
  parentId,
  primaryValueId: 'domain-clothing',
  primaryName: '衣物',
  secondaryValueId: parentId ? `type-${id}` : null,
  secondaryName: parentId ? name.split(' / ').at(-1)! : null,
  state: 'ACTIVE',
  selectable: true,
});

const categories = [
  category('clothing', '衣物', null),
  category('dress', '衣物 / 连衣裙', 'clothing'),
  category('long-dress', '衣物 / 连衣裙 / 连衣长裙', 'dress'),
  category('formal-long-dress', '衣物 / 连衣裙 / 连衣长裙 / 礼服长裙', 'long-dress'),
  category('evening-long-dress', '衣物 / 连衣裙 / 连衣长裙 / 礼服长裙 / 晚宴长裙', 'formal-long-dress'),
  category('empty-long-dress', '衣物 / 连衣裙 / 空分类', 'dress'),
];

function term(id: string, classificationId: string | null): TermListItem {
  const classification = classificationId ? categories.find((item) => item.id === classificationId)! : null;
  return {
    id,
    stableKey: id,
    title: id,
    titleLocale: 'zh',
    definition: '',
    aliases: [],
    localizations: [],
    editorialState: 'APPROVED',
    revisionNo: 1,
    termRevisionId: `${id}-revision`,
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

describe('recursive dictionary category browser', () => {
  const terms = [term('formal', 'evening-long-dress'), term('shallow', 'clothing'), term('uncategorized', null)];

  it('keeps a selected parent at that level while exposing its children and complete subtree', () => {
    const selectedRoot = selectDictionaryCategoryAtLevel([], 0, 'clothing');
    expect(selectedRoot).toEqual(['clothing']);

    const browser = buildDictionaryCategoryBrowser(categories, terms, selectedRoot, '未分类');
    expect(browser.columns).toHaveLength(2);
    expect(browser.columns[1]?.selectedId).toBeNull();
    expect(browser.visibleTerms.map((item) => item.id).sort()).toEqual(['formal', 'shallow']);
  });

  it('shows the third level after the second and continues beyond the fourth level', () => {
    const thirdLevel = buildDictionaryCategoryBrowser(categories, terms, ['clothing', 'dress'], '未分类');
    expect(thirdLevel.columns).toHaveLength(3);
    expect(thirdLevel.columns[2]?.options.map((option) => [option.id, option.count])).toEqual([
      ['long-dress', 1],
      ['empty-long-dress', 0],
    ]);
    expect(thirdLevel.visibleTerms.map((item) => item.id)).toEqual(['formal']);

    const selectedGrandchild = selectDictionaryCategoryAtLevel(thirdLevel.selectionPath, 2, 'long-dress');
    const fourthLevel = buildDictionaryCategoryBrowser(categories, terms, selectedGrandchild, '未分类');
    expect(fourthLevel.columns).toHaveLength(4);
    expect(fourthLevel.columns[3]?.options.map((option) => option.id)).toEqual(['formal-long-dress']);

    const selectedFourthLevel = selectDictionaryCategoryAtLevel(fourthLevel.selectionPath, 3, 'formal-long-dress');
    const fifthLevel = buildDictionaryCategoryBrowser(categories, terms, selectedFourthLevel, '未分类');
    expect(fifthLevel.columns).toHaveLength(5);
    expect(fifthLevel.columns[4]?.options.map((option) => option.id)).toEqual(['evening-long-dress']);
  });

  it('restores the complete classification path for a focused term', () => {
    expect(dictionaryCategoryPathForTerm(terms[0]!, categories)).toEqual([
      'clothing',
      'dress',
      'long-dress',
      'formal-long-dress',
      'evening-long-dress',
    ]);
  });
});
