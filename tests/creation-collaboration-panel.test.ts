import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AssistantRunDto, CodexAssistResult } from '../src/shared/contracts';
import { CreationCollaborationPanel } from '../src/renderer/components/creator/CreationCollaborationPanel';
import { I18nContext } from '../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './support/i18n';

const suggestion: CodexAssistResult = {
  assistantMessage: 'I kept the subject and clarified the lighting.',
  optimizedPrompt: 'A quiet portrait with soft window light',
  promptEdit: {
    summary: 'Clarified the lighting while preserving the subject.',
    preserved: ['quiet portrait'],
    changes: [{ before: 'portrait', after: 'portrait with soft window light', reason: 'Makes the light testable.' }],
    removed: [],
    revisedUserInstruction: 'A quiet portrait with soft window light',
  },
  sharedConstraints: ['quiet portrait'],
  assumptions: [{ label: 'Lighting', interpretation: 'Soft window light', impact: 'Keeps contrast restrained.' }],
  directions: [
    {
      label: 'Editorial',
      prompt: 'An editorial portrait',
      rationale: 'More structure and contrast.',
      variableAxis: 'Editorial contrast',
      risk: 'May feel formal.',
    },
    {
      label: 'Cinematic',
      prompt: 'A cinematic portrait',
      rationale: 'A stronger story and atmosphere.',
      variableAxis: 'Cinematic lighting',
      risk: 'May obscure detail.',
    },
  ],
};

function assistantRun(result: CodexAssistResult): AssistantRunDto {
  return {
    id: 'assistant-run-1',
    scope: { kind: 'DRAFT', id: 'draft-1' },
    mode: 'optimize',
    status: 'SUCCEEDED',
    contextKey: 'context-1',
    contextHash: 'hash-1',
    input: {
      scope: { kind: 'DRAFT', id: 'draft-1' },
      mode: 'optimize',
      prompt: 'A quiet portrait',
      locale: 'en',
      directTerms: [],
      recipes: [],
      referenceAssets: [],
      termPromptLocale: 'en',
      canvasPresetKey: null,
      canvasWidth: null,
      canvasHeight: null,
      generationTargets: [],
      contextKey: 'context-1',
    },
    capabilityReceipt: {
      directTermCount: 0,
      recipeCount: 0,
      referenceCount: 0,
      visionAnalyzed: false,
    },
    proposal: {
      id: 'assistant-proposal-1',
      assistantRunId: 'assistant-run-1',
      status: 'READY',
      adoptedContextKey: null,
      result,
      createdAt: '2026-07-30T10:00:00.000Z',
      updatedAt: '2026-07-30T10:00:00.000Z',
    },
    errorMessage: '',
    dismissedAt: null,
    createdAt: '2026-07-30T10:00:00.000Z',
    finishedAt: '2026-07-30T10:00:01.000Z',
  };
}

function renderPanel(overrides: Partial<Parameters<typeof CreationCollaborationPanel>[0]> = {}) {
  const props: Parameters<typeof CreationCollaborationPanel>[0] = {
    prompt: 'A quiet portrait',
    basePrompt: null,
    assistantRun: null,
    busy: false,
    activeMode: null,
    error: '',
    canRequestIdeas: true,
    canBuildPrompt: true,
    onRequestIdeas: () => undefined,
    onBuildPrompt: () => undefined,
    onApply: () => undefined,
    onDismiss: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      {
        value: testI18nValue('en'),
      },
      createElement(CreationCollaborationPanel, props),
    ),
  );
}

describe('creation collaboration panel', () => {
  it('keeps only concise assistant actions in the idle creation surface', () => {
    const markup = renderPanel();
    expect(markup).toContain('data-creation-collaboration');
    expect(markup).toContain('aria-label="Creation collaboration"');
    expect(markup).toContain('Give me ideas');
    expect(markup).toContain('Let AI write');
    expect(markup).toContain('data-icon="agent-robot"');
    expect(markup).toContain('lucide-file-pen-line');
    expect(markup).not.toContain('The assistant proposes first');
    expect(markup).not.toContain('Explore a few');
    expect(markup).not.toContain('Turn the current description');
    expect(markup).not.toContain('Open full editor');
  });

  it('shows an optimized prompt as an explicit proposal', () => {
    const markup = renderPanel({ basePrompt: 'A quiet portrait', assistantRun: assistantRun(suggestion) });
    expect(markup).toContain('Prompt proposal');
    expect(markup).toContain('Apply this change');
    expect(markup).not.toContain('Apply to input');
    expect(markup).toContain('Editorial');
    expect(markup).toContain('Cinematic');
    expect(markup).toContain('Use this direction');
  });

  it('marks a persisted proposal stale when the creator context changes', () => {
    const markup = renderPanel({
      prompt: 'A newly edited portrait',
      basePrompt: 'A quiet portrait',
      assistantRun: assistantRun(suggestion),
      currentContextKey: 'context-2',
    });
    expect(markup).toContain('Based on earlier input');
    expect(markup).toContain('data-tone="warning"');
  });

  it('recognizes an explicitly applied proposal without leaving a stale warning', () => {
    const markup = renderPanel({
      prompt: suggestion.optimizedPrompt,
      basePrompt: 'A quiet portrait',
      assistantRun: assistantRun(suggestion),
    });
    expect(markup).toContain('Applied');
    expect(markup).not.toContain('Based on earlier input');
  });
});
