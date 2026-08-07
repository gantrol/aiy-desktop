import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TermCategoryDto, TermDraftInput, TermEditorDto } from '../src/shared/contracts';
import { TermEditor } from '../src/renderer/components/dictionary/TermEditor';
import { testMessages } from './support/i18n';

vi.mock('../src/renderer/components/dictionary/TermMediaEditor', () => ({
  TermMediaEditor: () => createElement('div', { 'data-test-media-editor': true }),
}));

vi.mock('../src/renderer/components/dictionary/TermStateActions', () => ({
  TermStateActions: () => createElement('button', { 'data-test-state-actions': true }, 'More'),
}));

vi.mock('../src/renderer/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => createElement('div', { 'data-test-select': true }, children),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => createElement('button', props, children),
  SelectValue: ({ placeholder }: { placeholder: string }) => createElement('span', null, placeholder),
  SelectContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) =>
    createElement('span', { 'data-value': value }, children),
}));

const category: TermCategoryDto = {
  id: 'category-scene-place',
  stableKey: 'scene.place',
  name: '场景 · 场所',
  primaryValueId: 'domain-scene',
  primaryName: '场景',
  secondaryValueId: 'type-place',
  secondaryName: '场所',
};

function makeDraft(): TermDraftInput {
  return {
    termId: 'term-cafe',
    title: '咖啡馆',
    titleLocale: 'zh',
    definition: '提供咖啡与短暂停留的公共室内空间。\n\n不包括：普通餐厅。',
    aliases: ['咖啡店'],
    localizations: [
      {
        locale: 'en',
        title: 'Cafe',
        definition: 'A public interior for coffee and a short stay.',
        aliases: ['coffee shop'],
      },
      { locale: 'ja', title: 'カフェ', definition: 'コーヒーを提供する場所。', aliases: [] },
    ],
    classificationIds: [category.id],
    primaryDirectoryClassificationId: category.id,
    expressions: [
      {
        contextKey: 'general.default',
        modelKey: 'gpt-image-2',
        locale: 'en',
        positive: 'warm contemporary cafe interior',
        negative: 'restaurant dining hall',
      },
    ],
  };
}

function makeDetail(overrides: Partial<TermEditorDto> = {}): TermEditorDto {
  const draft = makeDraft();
  return {
    id: draft.termId,
    stableKey: 'term.local.cafe',
    title: draft.title,
    titleLocale: draft.titleLocale,
    definition: draft.definition,
    aliases: draft.aliases,
    localizations: draft.localizations,
    editorialState: 'DRAFT',
    revisionNo: 2,
    termRevisionId: 'term-cafe-revision-2',
    modelExpressions: draft.expressions.map((expression, index) => ({ id: `expression-${index}`, ...expression })),
    expressions: draft.expressions,
    classificationIds: [category.id],
    classifications: [category],
    primaryDirectoryClassificationId: category.id,
    hasDraft: true,
    mediaPreview: { totalCount: 0, items: [] },
    media: [],
    metrics: {
      citationCount: 8,
      distinctPromptSeries: 3,
      positiveEvidence: 4,
      negativeEvidence: 1,
      pendingIssues: 0,
      lastValidatedAt: '2026-07-28T00:00:00.000Z',
    },
    draftUpdatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

function renderEditor(detail = makeDetail()) {
  return renderToStaticMarkup(
    createElement(TermEditor, {
      copy: testMessages.zh.dictionary.editor,
      locale: 'zh',
      categories: [category],
      detail,
      draft: makeDraft(),
      dirty: true,
      busy: false,
      mediaBusy: false,
      mediaFocusKey: 0,
      availableAssets: [],
      onSet: () => undefined,
      onSave: () => undefined,
      onApprove: () => undefined,
      onWithdraw: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onAddMedia: async () => undefined,
      onImportMedia: async () => undefined,
      onSetMediaCover: async () => undefined,
      onRemoveMedia: async () => undefined,
      onReorderMedia: async () => undefined,
    }),
  );
}

describe('TermEditor', () => {
  it('keeps the editor scrollable and exposes only the necessary multilingual term fields', () => {
    const markup = renderEditor();

    expect(markup).toContain('data-term-editor');
    expect(markup).toContain('data-term-editor-scroll');
    expect(markup).toContain('data-editor-section="core"');
    expect(markup).toContain('data-editor-section="expressions"');
    expect(markup).toContain('data-editor-section="localizations"');
    expect(markup).toContain('data-action="term-add-expression"');
    expect(markup).toContain('data-action="term-add-localization"');
    expect(markup).toContain('id="term-title"');
    expect(markup).toContain('id="term-title-locale"');
    expect(markup).toContain('warm contemporary cafe interior');
    expect(markup).toContain('Cafe');
    expect(markup).toContain('カフェ');
    expect(markup).not.toContain('stableKey');
    expect(markup).not.toContain('证据状态');
    expect(markup).not.toContain('词条层级');
  });

  it('keeps media available and makes archived terms read-only', () => {
    const editable = renderEditor();
    expect(editable).toContain('data-test-media-editor');

    const archived = renderEditor(makeDetail({ editorialState: 'ARCHIVED', hasDraft: false }));
    expect(archived).toContain('<fieldset disabled=""');
    expect(archived).not.toContain('>保存草稿</button>');
    expect(archived).not.toContain('>核准版本</button>');
  });
});
