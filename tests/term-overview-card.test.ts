import { Children, createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TermListItem } from '../src/shared/contracts';
import {
  chooseTermCardOverlayTone,
  getTermCardAspectRatio,
  sampleTermCardOverlayTone,
  TermOverviewCard,
} from '../src/renderer/components/dictionary/TermOverviewCard';

function makeTerm(overrides: Partial<TermListItem> = {}): TermListItem {
  return {
    id: 'term_soft_outline',
    stableKey: 'appearance.soft_outline',
    title: '柔和轮廓',
    titleLocale: 'zh',
    definition: '轮廓转折平缓，不强调骨骼棱角。',
    aliases: [],
    localizations: [{ locale: 'en', title: 'Soft facial outline', definition: '', aliases: [] }],
    editorialState: 'APPROVED',
    revisionNo: 3,
    termRevisionId: 'term-soft-outline-revision-3',
    modelExpressions: [
      {
        id: 'term-soft-outline-expression-1',
        contextKey: 'general.default',
        modelKey: 'gpt-image-2',
        locale: 'en',
        positive: 'soft facial outline',
        negative: '',
      },
    ],
    classificationIds: ['category-appearance-outline'],
    classifications: [
      {
        id: 'category-appearance-outline',
        stableKey: 'appearance.outline',
        name: '外观 · 轮廓',
        primaryValueId: 'domain-appearance',
        primaryName: '外观',
        secondaryValueId: 'type-outline',
        secondaryName: '轮廓',
      },
    ],
    primaryDirectoryClassificationId: 'category-appearance-outline',
    hasDraft: false,
    mediaPreview: {
      totalCount: 1,
      items: [
        {
          id: 'media-soft-outline',
          role: 'COVER',
          sortOrder: 0,
          focalX: 0.25,
          focalY: 0.75,
          asset: {
            id: 'asset-soft-outline',
            kind: 'REFERENCE',
            width: 1200,
            height: 900,
            mimeType: 'image/jpeg',
            mediaUrl: 'media://soft-outline.jpg',
            createdAt: '2026-07-28T00:00:00.000Z',
          },
        },
      ],
    },
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

type ClickableElement = ReactElement<{
  children?: ReactNode;
  onClick?: () => void;
}>;

describe('TermOverviewCard', () => {
  it('renders uncropped media with persistent, tone-aware copy on the image', () => {
    const markup = renderToStaticMarkup(
      createElement(TermOverviewCard, {
        term: makeTerm(),
        selected: false,
        addLabel: '加入',
        selectedLabel: '已加入',
        openLabel: '查看词条',
        onOpen: () => undefined,
        onToggle: () => undefined,
      }),
    );

    expect(markup).toContain('data-term-overview-card');
    expect(markup).toContain('data-term-id="term_soft_outline"');
    expect(markup).toContain('data-selected="false"');
    expect(markup).toContain('data-media-frame');
    expect(markup).toContain('data-term-overlay');
    expect(markup).toContain('data-overlay-tone="light"');
    expect(markup).toContain('text-media-checker-a');
    expect(markup).not.toContain('data-term-hover-scrim');
    expect(markup).toContain('src="media://soft-outline.jpg"');
    expect(markup).toContain('object-position:25% 75%');
    expect(markup).toContain('transform-origin:25% 75%');
    expect(markup).toContain('aspect-ratio:1.3333333333333333');
    expect(markup).toContain('bg-media-surround');
    expect(markup).toContain('object-contain');
    expect(markup).not.toContain('object-cover');
    expect(markup).not.toContain('data-term-info');
    expect(markup).not.toMatch(/(?:from|via)-(?:black|white)|text-(?:black|white)|shadow-(?:xs|sm|md|lg|xl|2xl)/);
    expect(markup).toContain('transition-[color,opacity]');
    expect(markup).toContain('group-hover:duration-fast');
    expect(markup).toContain('group-hover:ease-exit');
    expect(markup).toContain('group-hover:scale-[1.015]');
    expect(markup).toContain('motion-reduce:transform-none');
    expect(markup).toContain('motion-reduce:transition-none');
    expect(markup).toContain('group-hover:opacity-0');
    expect(markup).toContain('group-has-[:focus-visible]:opacity-100');
    expect(markup).not.toContain('group-hover:opacity-100');
    expect(markup).toContain('柔和轮廓');
    expect(markup).toContain('Soft facial outline');
    expect(markup).toContain('轮廓转折平缓，不强调骨骼棱角。');
    expect(markup).toContain('aria-label="查看词条: 柔和轮廓"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('data-action="toggle-term"');
    expect(markup).toContain('bg-overlay/95');
    expect(markup).toContain('加入');
  });

  it('uses media dimensions instead of locking every card to 4:3', () => {
    const portrait = makeTerm();
    portrait.mediaPreview.items[0].asset.width = 900;
    portrait.mediaPreview.items[0].asset.height = 1200;
    const markup = renderToStaticMarkup(
      createElement(TermOverviewCard, {
        term: portrait,
        selected: false,
        addLabel: '加入',
        selectedLabel: '已加入',
        onOpen: () => undefined,
        onToggle: () => undefined,
      }),
    );

    expect(getTermCardAspectRatio(900, 1200)).toBe(0.75);
    expect(markup).toContain('data-media-aspect-ratio="0.750"');
    expect(markup).toContain('aspect-ratio:0.75');
    expect(markup).not.toContain('aspect-[4/3]');
  });

  it('preserves extreme source ratios so uncropped media does not expose a surround', () => {
    const portrait = makeTerm();
    portrait.mediaPreview.items[0].asset.width = 300;
    portrait.mediaPreview.items[0].asset.height = 1200;
    const markup = renderToStaticMarkup(
      createElement(TermOverviewCard, {
        term: portrait,
        selected: false,
        addLabel: '加入',
        selectedLabel: '已加入',
        onOpen: () => undefined,
        onToggle: () => undefined,
      }),
    );

    expect(getTermCardAspectRatio(300, 1200)).toBe(0.25);
    expect(getTermCardAspectRatio(2400, 400)).toBe(6);
    expect(getTermCardAspectRatio(0, 0)).toBe(4 / 3);
    expect(markup).toContain('data-media-aspect-ratio="0.250"');
    expect(markup).toContain('aspect-ratio:0.25');
  });

  it('chooses the overlay text tone from the sampled image region', () => {
    const bright = new Uint8ClampedArray([245, 245, 245, 255, 255, 255, 255, 255, 235, 235, 235, 255]);
    const dark = new Uint8ClampedArray([12, 18, 24, 255, 35, 42, 48, 255, 80, 72, 64, 255]);

    expect(chooseTermCardOverlayTone(bright)).toBe('dark');
    expect(chooseTermCardOverlayTone(dark)).toBe('light');
    expect(chooseTermCardOverlayTone(new Uint8ClampedArray())).toBe('light');
  });

  it('samples the lower image region occupied by the persistent copy', () => {
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray([245, 245, 245, 255, 255, 255, 255, 255, 235, 235, 235, 255]),
    }));
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage, getImageData })),
      })),
    });

    try {
      const image = { naturalWidth: 1200, naturalHeight: 900 } as HTMLImageElement;
      expect(sampleTermCardOverlayTone(image)).toBe('dark');
      expect(drawImage).toHaveBeenCalledWith(image, 0, 630, 1200, expect.any(Number), 0, 0, 32, 18);
      expect(drawImage.mock.calls[0][4]).toBeCloseTo(270);
      expect(getImageData).toHaveBeenCalledWith(0, 0, 32, 18);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders a persistent initial fallback and selected action state without media', () => {
    const markup = renderToStaticMarkup(
      createElement(TermOverviewCard, {
        term: makeTerm({
          title: '丝绒质感',
          localizations: [],
          definition: '',
          mediaPreview: { totalCount: 0, items: [] },
        }),
        selected: true,
        addLabel: '加入',
        selectedLabel: '已加入',
        onOpen: () => undefined,
        onToggle: () => undefined,
      }),
    );

    expect(markup).toContain('data-selected="true"');
    expect(markup).toContain('data-media-fallback');
    expect(markup).toContain('>丝</span>');
    expect(markup).not.toContain('—');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('已加入');
    expect(markup).not.toContain('<img');
  });

  it('keeps opening the card and toggling selection as separate actions', () => {
    const term = makeTerm();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const card = TermOverviewCard({
      term,
      selected: false,
      addLabel: '加入',
      selectedLabel: '已加入',
      onOpen,
      onToggle,
    }) as ClickableElement;
    const [openButton, toggleButton] = Children.toArray(card.props.children) as ClickableElement[];

    openButton.props.onClick?.();
    expect(onOpen).toHaveBeenCalledWith(term);
    expect(onToggle).not.toHaveBeenCalled();

    toggleButton.props.onClick?.();
    expect(onToggle).toHaveBeenCalledWith(term);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
