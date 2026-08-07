import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TermEditorDto } from '../src/shared/contracts';
import { TermDetailView } from '../src/renderer/components/dictionary/TermDetailView';
import { I18nContext } from '../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './support/i18n';

const actionHandlers = vi.hoisted(() => new Map<string, () => void>());

vi.mock('../src/renderer/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: ({
      children,
      onClick,
      variant: _variant,
      size: _size,
      ...props
    }: {
      children?: ReactNode;
      onClick?: () => void;
      variant?: string;
      size?: string;
      'data-action'?: string;
      [key: string]: unknown;
    }) => {
      const textLabel = typeof children === 'string' ? children : '';
      const action = props['data-action'] || (textLabel ? `label:${textLabel}` : '');
      if (action && onClick) actionHandlers.set(action, onClick);
      return createElement('button', props, children);
    },
  };
});

vi.mock('../src/renderer/components/media/AssetFileContextMenu', () => ({
  AssetFileContextMenu: ({ children }: { children?: ReactNode }) => children,
}));

function makeTerm(overrides: Partial<TermEditorDto> = {}): TermEditorDto {
  return {
    id: 'term_soft_outline',
    stableKey: 'appearance.soft_outline',
    title: '柔和轮廓',
    titleLocale: 'zh',
    definition: '轮廓转折平缓，不强调骨骼棱角。\n\n不包括：不等于模糊五官，也不表示没有骨骼结构。',
    aliases: ['柔和脸部线条'],
    localizations: [
      {
        locale: 'en',
        title: 'Soft facial outline',
        definition: 'A softly transitioning facial outline without pronounced bony angles.',
        aliases: ['soft face contour'],
      },
    ],
    editorialState: 'APPROVED',
    revisionNo: 3,
    termRevisionId: 'term-soft-outline-revision-3',
    modelExpressions: [
      {
        id: 'term-soft-outline-expression-1',
        contextKey: 'general.default',
        modelKey: 'gpt-image-2',
        locale: 'en',
        positive: 'soft facial outline, gentle facial contours',
        negative: 'overly angular jawline',
      },
    ],
    expressions: [
      {
        contextKey: 'general.default',
        modelKey: 'gpt-image-2',
        locale: 'en',
        positive: 'soft facial outline, gentle facial contours',
        negative: 'overly angular jawline',
      },
    ],
    classificationIds: ['category-appearance-outline'],
    classifications: [
      {
        id: 'category-appearance-outline',
        stableKey: 'appearance.outline',
        name: '外观 · 脸部轮廓',
        primaryValueId: 'domain-appearance',
        primaryName: '外观',
        secondaryValueId: 'type-outline',
        secondaryName: '脸部轮廓',
      },
    ],
    primaryDirectoryClassificationId: 'category-appearance-outline',
    hasDraft: false,
    mediaPreview: {
      totalCount: 1,
      items: [],
    },
    media: [
      {
        id: 'media-soft-outline',
        role: 'COVER',
        sortOrder: 0,
        focalX: 0.2,
        focalY: 0.6,
        asset: {
          id: 'asset-soft-outline',
          kind: 'REFERENCE',
          width: 1200,
          height: 1500,
          mimeType: 'image/jpeg',
          mediaUrl: 'media://soft-outline.jpg',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      },
    ],
    metrics: {
      citationCount: 12,
      distinctPromptSeries: 4,
      positiveEvidence: 3,
      negativeEvidence: 1,
      pendingIssues: 0,
      lastValidatedAt: '2026-07-27T00:00:00.000Z',
    },
    draftUpdatedAt: null,
    ...overrides,
  };
}

function renderDetail(props: Partial<Parameters<typeof TermDetailView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: testI18nValue('zh') },
      createElement(TermDetailView, {
        term: makeTerm(),
        locale: 'zh',
        selected: false,
        onBack: () => undefined,
        onSelectedChange: () => undefined,
        ...props,
      }),
    ),
  );
}

describe('TermDetailView', () => {
  beforeEach(() => actionHandlers.clear());

  it('shows the necessary term content, model expressions, category, and translations', () => {
    const markup = renderDetail();

    expect(markup).toContain('data-term-detail');
    expect(markup).toContain('data-term-id="term_soft_outline"');
    expect(markup).toContain('src="media://soft-outline.jpg"');
    expect(markup).toContain('柔和轮廓');
    expect(markup).toContain('轮廓转折平缓，不强调骨骼棱角。');
    expect(markup).toContain('不等于模糊五官，也不表示没有骨骼结构。');
    expect(markup).toContain('模型表达');
    expect(markup).toContain('soft facial outline, gentle facial contours');
    expect(markup).toContain('外观 · 脸部轮廓');
    expect(markup).toContain('别名');
    expect(markup).toContain('Soft facial outline');
  });

  it('preserves the source ratio for the primary reference image', () => {
    const markup = renderDetail();
    const image = markup.match(/<img[^>]*data-term-detail-media="true"[^>]*>/)?.[0];

    expect(image).toBeDefined();
    expect(image).toContain('width="1200"');
    expect(image).toContain('height="1500"');
    expect(image).toContain('h-auto');
    expect(markup).not.toContain('aspect-[4/5]');
  });

  it('wires back, selection, and edit to three independent callbacks', () => {
    const term = makeTerm();
    const onBack = vi.fn();
    const onSelectedChange = vi.fn();
    const onEdit = vi.fn();

    const markup = renderDetail({ term, onBack, onSelectedChange, onEdit });
    expect(markup).toContain('data-action="term-detail-back"');
    expect(markup).toContain('data-action="term-detail-select"');
    expect(markup).toContain('data-action="term-detail-edit"');

    actionHandlers.get('term-detail-back')?.();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();

    actionHandlers.get('term-detail-select')?.();
    expect(onSelectedChange).toHaveBeenCalledWith(true, term);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();

    actionHandlers.get('term-detail-edit')?.();
    expect(onEdit).toHaveBeenCalledWith(term);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSelectedChange).toHaveBeenCalledTimes(1);
  });

  it('renders the loading state without exposing retry prematurely', () => {
    const markup = renderDetail({ term: null, loading: true });

    expect(markup).toContain('正在打开词条…');
    expect(markup).not.toContain('词条加载失败');
    expect(markup).not.toContain('>重试</button>');
    expect(markup).toContain('data-action="term-detail-back"');
  });

  it('renders an error state and connects retry without triggering navigation', () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    const markup = renderDetail({ term: null, error: 'network timeout', onRetry, onBack });

    expect(markup).toContain('network timeout');
    expect(markup).toContain('>重试</button>');

    actionHandlers.get('label:重试')?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });
});
