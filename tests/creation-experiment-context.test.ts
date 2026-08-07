import { describe, expect, it } from 'vitest';
import type { PromptSeriesDto, PromptVersionDto, StyleExplorationBatchDto } from '../src/shared/contracts';
import { creationExperimentContextForSeries } from '../src/renderer/components/creator/creationExperimentContext';

function version(id: string, versionNo: number, createdAt: string): PromptVersionDto {
  return {
    id,
    parentVersionId: null,
    versionNo,
    manualPrompt: '',
    finalPrompt: '',
    isStructured: true,
    termPromptLocale: 'zh',
    termIds: [],
    wordPaletteReferences: [],
    referenceAssets: [],
    changeSummary: '',
    createdAt,
    runs: [],
    promptInputSnapshot: {
      id: `snapshot-${id}`,
      sourceKind: 'COMPOSED',
      commonInput: {
        userInstruction: '',
        directTermPromptLocale: 'zh',
        directTerms: [],
        recipes: [],
        directReferences: [],
      },
      contentHash: `hash-${id}`,
      createdAt,
    },
  };
}

function series(id: string, versions: PromptVersionDto[] = []): PromptSeriesDto {
  return {
    id,
    title: id,
    currentVersionId: versions.at(-1)?.id ?? null,
    versions,
    importedOutputs: [],
    cover: null,
  };
}

function batch(id: string, createdAt: string, childIds: string[]): StyleExplorationBatchDto {
  return {
    id,
    scope: { kind: 'SERIES', id: 'host' },
    sourceAssistantRunId: `assistant-${id}`,
    commonConstraints: [],
    status: 'SUCCEEDED',
    completedCount: childIds.length,
    failedCount: 0,
    cancelledCount: 0,
    interruptedCount: 0,
    activeCount: 0,
    totalCount: childIds.length,
    slots: childIds.map((seriesId, sortOrder) => ({
      id: `${id}-slot-${sortOrder}`,
      batchId: id,
      sortOrder,
      label: `Direction ${sortOrder + 1}`,
      rationale: '',
      variableAxis: 'camera distance',
      risk: '',
      userInstruction: '',
      seriesId,
      versionId: `${seriesId}-version`,
      runIds: [],
      status: 'SUCCEEDED',
      completedCount: 1,
      failedCount: 0,
      cancelledCount: 0,
      interruptedCount: 0,
      activeCount: 0,
      totalCount: 1,
    })),
    createdAt,
    updatedAt: createdAt,
  };
}

describe('creation experiment display coordinates', () => {
  it('labels directions as children of the frozen major version', () => {
    const allSeries = [
      series('host', [
        version('v5', 5, '2026-07-30T09:00:00.000Z'),
        version('v6', 6, '2026-07-30T10:00:00.000Z'),
        version('v7', 7, '2026-07-30T12:00:00.000Z'),
      ]),
      series('direction-a'),
      series('direction-b'),
    ];
    const experiment = batch('batch-1', '2026-07-30T11:00:00.000Z', ['direction-a', 'direction-b']);

    expect(creationExperimentContextForSeries('direction-a', allSeries, [experiment])).toMatchObject({
      directionNo: 1,
      directionCount: 2,
      versionLabel: 'V6.1',
      sourceVersion: { id: 'v6' },
    });
    expect(creationExperimentContextForSeries('direction-b', allSeries, [experiment])?.versionLabel).toBe('V6.2');
  });

  it('continues decimal coordinates across later experiments from the same version', () => {
    const allSeries = [
      series('host', [version('v6', 6, '2026-07-30T10:00:00.000Z')]),
      series('direction-a'),
      series('direction-b'),
      series('direction-c'),
    ];
    const first = batch('batch-1', '2026-07-30T11:00:00.000Z', ['direction-a', 'direction-b']);
    const second = batch('batch-2', '2026-07-30T11:30:00.000Z', ['direction-c']);

    expect(creationExperimentContextForSeries('direction-c', allSeries, [second, first])?.versionLabel).toBe('V6.3');
  });
});
