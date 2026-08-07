import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TermListItem } from '../src/shared/contracts';
import {
  dictionaryContextSecondaryText,
  DictionaryContextSidebar,
  type DictionaryContextSidebarCopy,
  shouldLoadNextDictionaryContextPage,
} from '../src/renderer/components/dictionary/DictionaryContextSidebar';

function makeTerm(overrides: Partial<TermListItem> = {}): TermListItem {
  return {
    id: 'term-cafe',
    stableKey: 'setting.cafe',
    title: '咖啡馆',
    titleLocale: 'zh',
    definition: '提供咖啡和简餐的公共室内空间。',
    aliases: [],
    localizations: [{ locale: 'en', title: 'Café', definition: '', aliases: [] }],
    editorialState: 'APPROVED',
    revisionNo: 2,
    termRevisionId: 'term-cafe-revision-2',
    modelExpressions: [
      {
        id: 'term-cafe-expression-1',
        contextKey: 'general.default',
        modelKey: 'gpt-image-2',
        locale: 'en',
        positive: 'inside a cozy cafe',
        negative: '',
      },
    ],
    classificationIds: ['category-place'],
    classifications: [
      {
        id: 'category-place',
        stableKey: 'setting.place',
        name: '场景环境 · 场所',
        primaryValueId: 'domain-setting',
        primaryName: '场景环境',
        secondaryValueId: 'type-place',
        secondaryName: '场所',
      },
    ],
    primaryDirectoryClassificationId: 'category-place',
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
    ...overrides,
  };
}

const copy: DictionaryContextSidebarCopy = {
  collapse: '收起同类词',
  expand: '展开同类词',
  backToOverview: '返回词汇一览',
  sameCategory: '同类词',
  initialLoading: '正在加载同类词',
  loadingMore: '正在加载更多',
  loadFailed: '加载失败',
  retry: '重试',
  scrollForMore: '下滑加载更多',
  allLoaded: '已加载全部',
  empty: '这个分类下没有其他词',
  loadedCount: (loaded, total) => `已加载 ${loaded} / ${total}`,
};

function renderSidebar(
  mode: 'expanded' | 'compact',
  overrides: Partial<Parameters<typeof DictionaryContextSidebar>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(DictionaryContextSidebar, {
      mode,
      breadcrumb: { overview: '词汇一览', path: ['场景环境', '场所'] },
      copy,
      terms: [
        makeTerm(),
        makeTerm({
          id: 'term-library',
          title: '图书馆',
          localizations: [],
          definition: '收藏图书并供人阅读的场所。',
        }),
      ],
      total: 25,
      currentTermId: 'term-cafe',
      initialLoading: false,
      loadingMore: false,
      hasMore: true,
      loadError: '',
      onModeChange: () => undefined,
      onBack: () => undefined,
      onSelect: () => undefined,
      onLoadMore: () => undefined,
      ...overrides,
    }),
  );
}

describe('DictionaryContextSidebar', () => {
  it('renders an expanded breadcrumb, count, concise rows, and pagination progress', () => {
    const markup = renderSidebar('expanded');

    expect(markup).toContain('data-dictionary-context-sidebar');
    expect(markup).toContain('data-mode="expanded"');
    expect(markup).toContain('词汇一览');
    expect(markup).toContain('场景环境');
    expect(markup).toContain('场所');
    expect(markup).toContain('咖啡馆');
    expect(markup).toContain('Café');
    expect(markup).toContain('图书馆');
    expect(markup).toContain('收藏图书并供人阅读的场所。');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('下滑加载更多 · 已加载 2 / 25');
  });

  it('renders the compact thumbnail rail without losing selection or pagination progress', () => {
    const markup = renderSidebar('compact');

    expect(markup).toContain('data-mode="compact"');
    expect(markup).toContain('w-16');
    expect(markup).toContain('aria-label="返回词汇一览"');
    expect(markup).toContain('aria-label="展开同类词"');
    expect(markup).toContain('title="咖啡馆"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('>2/25<');
  });

  it('does not repeat identical adjacent category labels in the breadcrumb', () => {
    const markup = renderSidebar('expanded', {
      breadcrumb: { overview: '词汇一览', path: ['脸型', '脸型'] },
    });

    expect(markup.match(/<span[^>]*title="脸型"[^>]*>脸型<\/span>/g)).toHaveLength(1);
  });

  it('presents initial, bottom-loading, and retry states independently', () => {
    const initial = renderSidebar('expanded', { terms: [], initialLoading: true });
    const loading = renderSidebar('expanded', { loadingMore: true });
    const failed = renderSidebar('expanded', { loadError: 'database busy' });

    expect(initial).toContain('data-dictionary-context-skeleton');
    expect(initial).toContain('正在加载同类词');
    expect(loading).toContain('正在加载更多 · 已加载 2 / 25');
    expect(failed).toContain('title="database busy"');
    expect(failed).toContain('加载失败 · 重试');
  });
});

describe('dictionary context pagination helpers', () => {
  it('requests a page only while an eligible sentinel is visible', () => {
    const ready = { hasMore: true, initialLoading: false, loadingMore: false, hasError: false };
    expect(shouldLoadNextDictionaryContextPage(true, ready)).toBe(true);
    expect(shouldLoadNextDictionaryContextPage(false, ready)).toBe(false);
    expect(shouldLoadNextDictionaryContextPage(true, { ...ready, hasMore: false })).toBe(false);
    expect(shouldLoadNextDictionaryContextPage(true, { ...ready, initialLoading: true })).toBe(false);
    expect(shouldLoadNextDictionaryContextPage(true, { ...ready, loadingMore: true })).toBe(false);
    expect(shouldLoadNextDictionaryContextPage(true, { ...ready, hasError: true })).toBe(false);
  });

  it('uses the secondary name first and falls back to a short definition', () => {
    expect(dictionaryContextSecondaryText(makeTerm())).toBe('Café');
    expect(dictionaryContextSecondaryText(makeTerm({ localizations: [], definition: '定义' }))).toBe('定义');
  });
});
