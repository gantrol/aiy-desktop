import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AssistantRunDto,
  AssetDto,
  CodexAssistResult,
  GenerationRunDto,
  PromptSeriesDto,
  StyleExplorationBatchDto,
} from '../src/shared/contracts';
import { CreationCollaborationPanel } from '../src/renderer/components/creator/CreationCollaborationPanel';
import {
  STYLE_EXPLORATION_MAX_RUNS,
  StyleExplorationDirectionBrief,
  StyleExplorationRunLimitNotice,
  isStyleExplorationConfirmable,
} from '../src/renderer/components/creator/StyleExplorationDialog';
import { StyleExplorationPanel } from '../src/renderer/components/creator/StyleExplorationPanel';
import { I18nContext } from '../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './support/i18n';

function renderWithI18n(element: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      {
        value: testI18nValue('en'),
      },
      element,
    ),
  );
}

const assistantResult: CodexAssistResult = {
  assistantMessage: 'Three controlled directions are ready.',
  optimizedPrompt: '',
  promptEdit: {
    summary: 'Keep the subject and vary only the light.',
    preserved: ['same subject'],
    changes: [{ before: 'nice light', after: 'soft window light', reason: 'Makes the direction comparable.' }],
    removed: [],
    revisedUserInstruction: 'Portrait in soft window light',
  },
  sharedConstraints: ['same subject', 'same framing'],
  assumptions: [{ label: 'Mood', interpretation: 'Restrained', impact: 'Avoids dramatic color shifts.' }],
  directions: [
    {
      label: 'Editorial',
      prompt: 'Editorial portrait',
      rationale: 'Tests crisp contrast.',
      variableAxis: 'Contrast',
      risk: 'May feel formal.',
    },
  ],
};

const assistantRun: AssistantRunDto = {
  id: 'assistant-1',
  scope: { kind: 'DRAFT', id: 'draft-1' },
  mode: 'directions',
  status: 'SUCCEEDED',
  contextKey: 'frozen-context',
  contextHash: 'hash-1',
  input: {
    scope: { kind: 'DRAFT', id: 'draft-1' },
    mode: 'directions',
    prompt: 'Portrait',
    locale: 'en',
    directTerms: [],
    recipes: [],
    referenceAssets: [],
    termPromptLocale: 'en',
    canvasPresetKey: null,
    canvasWidth: null,
    canvasHeight: null,
    generationTargets: [],
    contextKey: 'frozen-context',
  },
  capabilityReceipt: { directTermCount: 2, recipeCount: 1, referenceCount: 1, visionAnalyzed: false },
  proposal: {
    id: 'proposal-1',
    assistantRunId: 'assistant-1',
    status: 'READY',
    adoptedContextKey: null,
    result: assistantResult,
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:00:01.000Z',
  },
  errorMessage: '',
  dismissedAt: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  finishedAt: '2026-07-30T10:00:01.000Z',
};

const asset = {
  id: 'asset-1',
  mediaUrl: 'asset://result-1.png',
  width: 1024,
  height: 1024,
} as AssetDto;

const series = [
  {
    id: 'series-1',
    versions: [
      {
        id: 'version-1',
        runs: [{ id: 'run-1', asset } as GenerationRunDto],
      },
    ],
  },
] as PromptSeriesDto[];

const batch: StyleExplorationBatchDto = {
  id: 'batch-1',
  scope: { kind: 'DRAFT', id: 'draft-1' },
  sourceAssistantRunId: 'assistant-1',
  commonConstraints: ['same subject'],
  status: 'PARTIAL',
  completedCount: 1,
  failedCount: 1,
  cancelledCount: 0,
  interruptedCount: 0,
  activeCount: 0,
  totalCount: 2,
  slots: [
    {
      id: 'slot-success',
      batchId: 'batch-1',
      sortOrder: 0,
      label: 'Editorial',
      rationale: 'Tests crisp contrast.',
      variableAxis: 'Contrast',
      risk: 'May feel formal.',
      userInstruction: 'Editorial portrait',
      seriesId: 'series-1',
      versionId: 'version-1',
      runIds: ['run-1'],
      status: 'SUCCEEDED',
      completedCount: 1,
      failedCount: 0,
      cancelledCount: 0,
      interruptedCount: 0,
      activeCount: 0,
      totalCount: 1,
    },
    {
      id: 'slot-failed',
      batchId: 'batch-1',
      sortOrder: 1,
      label: 'Cinematic',
      rationale: 'Tests a darker atmosphere.',
      variableAxis: 'Light falloff',
      risk: 'May lose detail.',
      userInstruction: 'Cinematic portrait',
      seriesId: 'series-2',
      versionId: 'version-2',
      runIds: ['run-2'],
      status: 'FAILED',
      completedCount: 0,
      failedCount: 1,
      cancelledCount: 0,
      interruptedCount: 0,
      activeCount: 0,
      totalCount: 1,
    },
  ],
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:01:00.000Z',
};

describe('agent proposal and direction experiment UI', () => {
  it('shows the frozen capability receipt, structured proposal, staleness, and multi-selection', () => {
    const markup = renderWithI18n(
      createElement(CreationCollaborationPanel, {
        prompt: 'Current edited portrait',
        basePrompt: null,
        assistantRun,
        currentContextKey: 'new-context',
        busy: false,
        activeMode: null,
        error: '',
        canRequestIdeas: true,
        canBuildPrompt: true,
        selectedDirectionIndexes: [0],
        onRequestIdeas: () => undefined,
        onBuildPrompt: () => undefined,
        onApply: () => undefined,
        onDismiss: () => undefined,
        onSelectionChange: () => undefined,
        onStartExperiment: () => undefined,
      }),
    );

    expect(markup).toContain('data-assistant-capability-receipt');
    expect(markup).toContain('Images were not analyzed');
    expect(markup).toContain('Structured changes');
    expect(markup).toContain('Keep fixed');
    expect(markup).toContain('Based on earlier input');
    expect(markup).toContain('Try 1 direction');
    expect(markup).toContain('data-direction-selected="true"');
  });

  it('recognizes the latest explicitly adopted context while applying changes one by one', () => {
    const adoptedRun: AssistantRunDto = {
      ...assistantRun,
      proposal: {
        id: 'proposal-1',
        assistantRunId: assistantRun.id,
        status: 'ADOPTED',
        adoptedContextKey: 'accepted-context',
        result: assistantResult,
        createdAt: assistantRun.createdAt,
        updatedAt: assistantRun.finishedAt!,
      },
    };
    const markup = renderWithI18n(
      createElement(CreationCollaborationPanel, {
        prompt: 'Portrait in soft window light',
        basePrompt: null,
        assistantRun: adoptedRun,
        currentContextKey: 'accepted-context',
        busy: false,
        activeMode: null,
        error: '',
        canRequestIdeas: true,
        canBuildPrompt: true,
        selectedDirectionIndexes: [0],
        onRequestIdeas: () => undefined,
        onBuildPrompt: () => undefined,
        onApply: () => undefined,
        onDismiss: () => undefined,
        onSelectionChange: () => undefined,
        onStartExperiment: () => undefined,
      }),
    );

    expect(markup).toContain('Proposal adopted');
    expect(markup).not.toContain('Based on earlier input');
    expect(markup).toContain('aria-label="Expand Agent proposal"');
    expect(markup).not.toContain('data-assistant-capability-receipt');
  });

  it('keeps successful slot results visible while exposing an independent failed-slot retry', () => {
    const markup = renderWithI18n(
      createElement(StyleExplorationPanel, {
        batches: [batch],
        series,
        onStop: () => undefined,
        onRetrySlot: () => undefined,
        onContinueDirection: () => undefined,
        onOpenAsset: () => undefined,
      }),
    );

    expect(markup).toContain('data-style-exploration-batch="batch-1"');
    expect(markup).toContain('asset://result-1.png');
    expect(markup).toContain('Continue this direction');
    expect(markup).toContain('Retry failed slot');
    expect(markup).toContain('Partially complete');
    expect(markup).toContain('aria-label="Direction experiment 1 progress"');
    expect(markup).toContain('aria-valuetext="1 of 2 complete, 1 failed"');
    expect(markup).toContain('aria-label="Editorial progress"');
    expect(markup).toContain('aria-label="Open Editorial result 1"');
    expect(markup).toContain('aria-label="Collapse experiment"');
    expect(markup).toContain('data-slot-visual="results"');
    expect(markup).toContain('data-slot-visual="failed"');
    expect(markup).toContain('data-slot-media="true"');
    expect(markup).toContain('data-slot-title-region="true"');
    expect(markup).toContain('data-slot-details="true"');
    expect(markup).toContain('object-contain');
    expect(markup).toContain('peer-hover/media:opacity-30');
    expect(markup).toContain('peer-focus-within/media:opacity-30');
    expect(markup).toContain('group-hover/title:visible');
    expect(markup).toContain('group-focus-within/title:visible');
  });

  it('uses distinct image-free transitions for queued, running, and failed directions', () => {
    const runningSlot = {
      ...batch.slots[1],
      id: 'slot-running',
      status: 'RUNNING' as const,
      failedCount: 0,
      activeCount: 1,
    };
    const queuedSlot = {
      ...runningSlot,
      id: 'slot-queued',
      status: 'QUEUED' as const,
    };
    const stateBatch: StyleExplorationBatchDto = {
      ...batch,
      id: 'batch-transition-states',
      status: 'RUNNING',
      completedCount: 0,
      failedCount: 1,
      activeCount: 2,
      totalCount: 3,
      slots: [runningSlot, queuedSlot, batch.slots[1]],
    };
    const markup = renderWithI18n(
      createElement(StyleExplorationPanel, {
        batches: [stateBatch],
        series: [],
        onStop: () => undefined,
        onRetrySlot: () => undefined,
        onContinueDirection: () => undefined,
      }),
    );

    expect(markup).toContain('data-slot-visual="running"');
    expect(markup).toContain('data-slot-visual="queued"');
    expect(markup).toContain('data-slot-visual="failed"');
    expect(markup).toContain('data-slot-media-state="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('animate-pulse');
    expect(markup).toContain('bg-destructive-surface');
  });

  it('puts the newest experiment first and collapses completed batches by default', () => {
    const older = { ...batch, id: 'batch-older', createdAt: '2026-07-30T09:00:00.000Z' };
    const newer = { ...batch, id: 'batch-newer', createdAt: '2026-07-30T11:00:00.000Z' };
    const orderedMarkup = renderWithI18n(
      createElement(StyleExplorationPanel, {
        batches: [older, newer],
        series,
        onStop: () => undefined,
        onRetrySlot: () => undefined,
        onContinueDirection: () => undefined,
      }),
    );
    expect(orderedMarkup.indexOf('batch-newer')).toBeLessThan(orderedMarkup.indexOf('batch-older'));

    const completedMarkup = renderWithI18n(
      createElement(StyleExplorationPanel, {
        batches: [{ ...batch, status: 'SUCCEEDED', completedCount: 2, failedCount: 0 }],
        series,
        onStop: () => undefined,
        onRetrySlot: () => undefined,
        onContinueDirection: () => undefined,
      }),
    );
    expect(completedMarkup).toContain('aria-label="Expand experiment"');
    expect(completedMarkup).not.toContain('asset://result-1.png');
  });

  it('makes every frozen direction prompt inspectable before authorization', () => {
    const direction = assistantResult.directions[0];
    const markup = renderWithI18n(
      createElement(StyleExplorationDirectionBrief, {
        direction,
        index: 0,
      }),
    );

    expect(markup).toContain('<details');
    expect(markup).toContain('Frozen direction prompt');
    expect(markup).toContain('aria-label="Frozen direction prompt: Editorial"');
    expect(markup).toContain('readOnly');
    expect(markup).toContain('Editorial portrait');
  });

  it('keeps cancellation distinct from failure after stopping remaining work', () => {
    const cancelledBatch: StyleExplorationBatchDto = {
      ...batch,
      status: 'CANCELLED',
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 1,
      totalCount: 1,
      slots: [
        {
          ...batch.slots[1],
          status: 'CANCELLED',
          failedCount: 0,
          cancelledCount: 1,
        },
      ],
    };
    const markup = renderWithI18n(
      createElement(StyleExplorationPanel, {
        batches: [cancelledBatch],
        series: [],
        onStop: () => undefined,
        onRetrySlot: () => undefined,
        onContinueDirection: () => undefined,
      }),
    );

    expect(markup).toContain('1 cancelled');
    expect(markup).not.toContain('1 failed');
  });

  it('shows a clear limit notice and blocks authorization above sixteen runs', () => {
    const maximumRuns = STYLE_EXPLORATION_MAX_RUNS + 1;
    const markup = renderWithI18n(createElement(StyleExplorationRunLimitNotice, { maximumRuns }));

    expect(isStyleExplorationConfirmable(2, STYLE_EXPLORATION_MAX_RUNS, false)).toBe(true);
    expect(isStyleExplorationConfirmable(2, maximumRuns, false)).toBe(false);
    expect(markup).toContain('data-style-exploration-run-limit');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('This brief would start 17 runs');
    expect(markup).toContain('16 or fewer');
  });

  it('does not add an empty experiment surface', () => {
    const markup = renderWithI18n(
      createElement(StyleExplorationPanel, {
        batches: [],
        series: [],
        onStop: () => undefined,
        onRetrySlot: () => undefined,
        onContinueDirection: () => undefined,
      }),
    );
    expect(markup).toBe('');
  });
});
