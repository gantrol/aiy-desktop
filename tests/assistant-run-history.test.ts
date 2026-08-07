import { describe, expect, it } from 'vitest';
import type { AssistantRunDto } from '../src/shared/contracts';
import {
  assistantRunHistory,
  defaultExpandedAssistantRunId,
} from '../src/renderer/components/creator/assistantRunHistory';

function run(overrides: Partial<AssistantRunDto> & Pick<AssistantRunDto, 'id' | 'createdAt'>): AssistantRunDto {
  const { id, createdAt, ...rest } = overrides;
  return {
    id,
    scope: { kind: 'DRAFT', id: 'draft-1' },
    mode: 'directions',
    status: 'SUCCEEDED',
    contextKey: 'context-1',
    contextHash: `hash-${id}`,
    input: {
      scope: { kind: 'DRAFT', id: 'draft-1' },
      mode: 'directions',
      prompt: 'portrait',
      locale: 'en',
      directTerms: [],
      recipes: [],
      contextKey: 'context-1',
      referenceAssets: [],
      termPromptLocale: 'en',
      canvasPresetKey: null,
      canvasWidth: null,
      canvasHeight: null,
      generationTargets: [],
    },
    capabilityReceipt: {
      directTermCount: 0,
      recipeCount: 0,
      referenceCount: 0,
      visionAnalyzed: false,
    },
    proposal: null,
    errorMessage: '',
    dismissedAt: null,
    createdAt,
    finishedAt: createdAt,
    ...rest,
  };
}

describe('assistant run history projection', () => {
  it('retains repeated requests and orders them newest-first without duplicating refreshed rows', () => {
    const first = run({ id: 'run-1', createdAt: '2026-07-30T10:00:00.000Z' });
    const second = run({ id: 'run-2', createdAt: '2026-07-30T10:01:00.000Z' });
    const otherScope = run({
      id: 'run-other',
      createdAt: '2026-07-30T10:02:00.000Z',
      scope: { kind: 'DRAFT', id: 'draft-2' },
    });

    expect(
      assistantRunHistory({
        runs: [first, second, first, otherScope],
        scope: { kind: 'DRAFT', id: 'draft-1' },
        currentContextKey: 'context-1',
      }).map(({ id }) => id),
    ).toEqual(['run-2', 'run-1']);
  });

  it('expands active work first and otherwise the newest run matching the current editor context', () => {
    const olderCurrent = run({
      id: 'run-current',
      createdAt: '2026-07-30T10:00:00.000Z',
      contextKey: 'context-current',
    });
    const newerStale = run({
      id: 'run-stale',
      createdAt: '2026-07-30T10:01:00.000Z',
      contextKey: 'context-stale',
    });
    const running = run({
      id: 'run-running',
      createdAt: '2026-07-30T09:59:00.000Z',
      status: 'RUNNING',
      finishedAt: null,
    });
    const scope = { kind: 'DRAFT' as const, id: 'draft-1' };

    expect(
      defaultExpandedAssistantRunId({
        runs: [olderCurrent, newerStale],
        scope,
        currentContextKey: 'context-current',
      }),
    ).toBe('run-current');
    expect(
      defaultExpandedAssistantRunId({
        runs: [olderCurrent, newerStale, running],
        scope,
        currentContextKey: 'context-current',
      }),
    ).toBe('run-running');
  });

  it('keeps persistently dismissed and closed entries in the complete history', () => {
    const dismissed = run({
      id: 'run-dismissed',
      createdAt: '2026-07-30T10:02:00.000Z',
      dismissedAt: '2026-07-30T10:03:00.000Z',
    });
    const closed = run({
      id: 'run-closed',
      createdAt: '2026-07-30T10:01:00.000Z',
      proposal: {
        id: 'proposal-closed',
        assistantRunId: 'run-closed',
        status: 'CLOSED',
        adoptedContextKey: null,
        result: {
          assistantMessage: '',
          optimizedPrompt: '',
          promptEdit: { summary: '', preserved: [], changes: [], removed: [], revisedUserInstruction: '' },
          sharedConstraints: [],
          assumptions: [],
          directions: [],
        },
        createdAt: '2026-07-30T10:01:00.000Z',
        updatedAt: '2026-07-30T10:01:00.000Z',
      },
    });
    const visible = run({ id: 'run-visible', createdAt: '2026-07-30T10:00:00.000Z' });

    expect(
      assistantRunHistory({
        runs: [dismissed, closed, visible],
        scope: { kind: 'DRAFT', id: 'draft-1' },
        currentContextKey: 'context-1',
      }).map(({ id }) => id),
    ).toEqual(['run-dismissed', 'run-closed', 'run-visible']);

    expect(
      defaultExpandedAssistantRunId({
        runs: [dismissed, closed],
        scope: { kind: 'DRAFT', id: 'draft-1' },
        currentContextKey: 'context-1',
      }),
    ).toBeNull();
  });
});
