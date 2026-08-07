import { describe, expect, it } from 'vitest';
import type { PromptSeriesDto, StyleExplorationBatchDto } from '../src/shared/contracts';
import { buildCreationSessionProjection } from '../src/renderer/components/creator/creationSessionProjection';

function series(id: string, title: string): PromptSeriesDto {
  return {
    id,
    title,
    currentVersionId: null,
    versions: [],
    importedOutputs: [],
    cover: null,
  };
}

function batch(scope: StyleExplorationBatchDto['scope']): StyleExplorationBatchDto {
  const labels = ['贴近随拍', '牵手将成', '海风回身'];
  return {
    id: 'batch-1',
    scope,
    sourceAssistantRunId: 'assistant-1',
    commonConstraints: [],
    status: 'SUCCEEDED',
    completedCount: 3,
    failedCount: 0,
    cancelledCount: 0,
    interruptedCount: 0,
    activeCount: 0,
    totalCount: 3,
    slots: labels.map((label, index) => ({
      id: `slot-${index + 1}`,
      batchId: 'batch-1',
      sortOrder: index,
      label,
      rationale: '',
      variableAxis: 'pose',
      risk: '',
      userInstruction: label,
      seriesId: `direction-${index + 1}`,
      versionId: `version-${index + 1}`,
      runIds: [`run-${index + 1}`],
      status: 'SUCCEEDED',
      completedCount: 1,
      failedCount: 0,
      cancelledCount: 0,
      interruptedCount: 0,
      activeCount: 0,
      totalCount: 1,
    })),
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:01:00.000Z',
  };
}

describe('creation session projection', () => {
  it('collapses experiment direction series under their source creation', () => {
    const input = [
      series('direction-1', '贴近随拍'),
      series('direction-2', '牵手将成'),
      series('direction-3', '海风回身'),
      series('host', '伸手带我走'),
    ];

    const sessions = buildCreationSessionProjection(input, [batch({ kind: 'SERIES', id: 'host' })]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'series:host',
      primarySeries: { id: 'host', title: '伸手带我走' },
      directionCount: 3,
      syntheticExperimentRoot: false,
    });
    expect(sessions[0].memberSeries.map((item) => item.id)).toEqual([
      'host',
      'direction-1',
      'direction-2',
      'direction-3',
    ]);
  });

  it('also collapses historical draft-scoped directions into one synthetic session', () => {
    const input = [
      series('direction-1', '贴近随拍'),
      series('direction-2', '牵手将成'),
      series('direction-3', '海风回身'),
    ];

    const sessions = buildCreationSessionProjection(input, [batch({ kind: 'DRAFT', id: 'consumed-draft' })]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'experiment:batch-1',
      directionCount: 3,
      syntheticExperimentRoot: true,
    });
  });
});
