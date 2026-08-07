import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AssistantRunDto, CodexAssistResult } from '../src/shared/contracts';
import { AssistantRunHistoryPanel } from '../src/renderer/components/creator/AssistantRunHistoryPanel';
import { I18nContext } from '../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './support/i18n';

function result(label: string): CodexAssistResult {
  return {
    assistantMessage: `${label} is ready.`,
    optimizedPrompt: '',
    promptEdit: { summary: '', preserved: [], changes: [], removed: [], revisedUserInstruction: '' },
    sharedConstraints: [],
    assumptions: [],
    directions: [{ label, prompt: label, rationale: label, variableAxis: 'pose', risk: '' }],
  };
}

function run(id: string, createdAt: string, label: string): AssistantRunDto {
  const proposalResult = result(label);
  return {
    id,
    scope: { kind: 'SERIES', id: 'series-1' },
    mode: 'directions',
    status: 'SUCCEEDED',
    contextKey: 'context-1',
    contextHash: `hash-${id}`,
    input: {
      scope: { kind: 'SERIES', id: 'series-1' },
      mode: 'directions',
      prompt: 'portrait',
      locale: 'zh',
      directTerms: [],
      recipes: [],
      contextKey: 'context-1',
      referenceAssets: [],
      termPromptLocale: 'zh',
      canvasPresetKey: null,
      canvasWidth: null,
      canvasHeight: null,
      generationTargets: [],
    },
    capabilityReceipt: { directTermCount: 0, recipeCount: 0, referenceCount: 0, visionAnalyzed: false },
    proposal: {
      id: `proposal-${id}`,
      assistantRunId: id,
      status: 'READY',
      adoptedContextKey: null,
      result: proposalResult,
      createdAt,
      updatedAt: createdAt,
    },
    errorMessage: '',
    dismissedAt: null,
    createdAt,
    finishedAt: createdAt,
  };
}

function renderHistory(runs: AssistantRunDto[], busy = false) {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      {
        value: testI18nValue('zh'),
      },
      createElement(AssistantRunHistoryPanel, {
        scope: { kind: 'SERIES', id: 'series-1' },
        runs,
        prompt: 'portrait',
        currentContextKey: 'context-1',
        busy,
        activeMode: busy ? 'directions' : null,
        error: '',
        canRequestIdeas: true,
        canBuildPrompt: true,
        onRequestIdeas: () => undefined,
        onBuildPrompt: () => undefined,
        onApply: () => undefined,
        onDismiss: () => undefined,
        onDismissTransient: () => undefined,
        onStartExperiment: () => undefined,
      }),
    ),
  );
}

describe('assistant history UI', () => {
  it('keeps repeated inspiration requests newest-first and expands only the newest result', () => {
    const older = run('run-older', '2026-07-30T10:00:00.000Z', '旧方向');
    const newer = run('run-newer', '2026-07-30T10:01:00.000Z', '新方向');
    const markup = renderHistory([older, newer, older]);

    expect(markup).toContain('历史记录');
    expect(markup).toContain('lucide-lightbulb');
    expect(markup.indexOf('data-assistant-run-id="run-newer"')).toBeLessThan(
      markup.indexOf('data-assistant-run-id="run-older"'),
    );
    expect(markup).toContain('新方向');
    expect(markup).not.toContain('旧方向 is ready.');
    expect(markup.match(/data-assistant-run-id="run-older"/g)).toHaveLength(1);
  });

  it('keeps prior results present but collapsed while a second request is running', () => {
    const markup = renderHistory([run('run-older', '2026-07-30T10:00:00.000Z', '旧方向')], true);

    expect(markup).toContain('历史记录');
    expect(markup).toContain('正在梳理不同创作方向');
    expect(markup).toContain('data-assistant-run-id="run-older"');
    expect(markup).not.toContain('旧方向 is ready.');
  });

  it('keeps a dismissed run visible in the complete history without reopening it', () => {
    const dismissed = {
      ...run('run-dismissed', '2026-07-30T10:00:00.000Z', '已关闭方向'),
      dismissedAt: '2026-07-30T10:01:00.000Z',
    };
    const markup = renderHistory([dismissed]);

    expect(markup).toContain('历史记录');
    expect(markup).toContain('data-assistant-run-id="run-dismissed"');
    expect(markup).not.toContain('已关闭方向 is ready.');
  });
});
