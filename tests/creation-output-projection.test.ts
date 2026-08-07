import { describe, expect, it } from 'vitest';
import type {
  AssetDto,
  GenerationRunDto,
  PromptSeriesDto,
  PromptVersionDto,
  StyleExplorationBatchDto,
} from '../src/shared/contracts';
import {
  buildCreationOutputProjection,
  sourceVersionForExplorationBatch,
} from '../src/renderer/components/creator/creationOutputProjection';

function asset(id: string, createdAt: string): AssetDto {
  return {
    id,
    kind: 'GENERATED',
    width: 1024,
    height: 1024,
    mimeType: 'image/png',
    mediaUrl: `asset://${id}`,
    createdAt,
  };
}

function run(
  id: string,
  createdAt: string,
  output: AssetDto | null,
  retryOfRunId: string | null = null,
): GenerationRunDto {
  return {
    id,
    modelKey: 'gpt-image-2',
    status: output ? 'SUCCEEDED' : 'FAILED',
    retryOfRunId,
    canvasPresetKey: null,
    width: 1024,
    height: 1024,
    quality: 'low',
    asset: output,
    derivation: null,
    errorMessage: output ? null : 'failed',
    createdAt,
  };
}

function version(id: string, versionNo: number, createdAt: string, runs: GenerationRunDto[] = []): PromptVersionDto {
  return {
    id,
    parentVersionId: null,
    versionNo,
    manualPrompt: id,
    finalPrompt: id,
    isStructured: true,
    termPromptLocale: 'en',
    termIds: [],
    wordPaletteReferences: [],
    referenceAssets: [],
    changeSummary: id,
    createdAt,
    runs,
    promptInputSnapshot: {
      id: `snapshot-${id}`,
      sourceKind: 'COMPOSED',
      commonInput: {
        userInstruction: id,
        directTermPromptLocale: 'en',
        directTerms: [],
        recipes: [],
        directReferences: [],
      },
      contentHash: `hash-${id}`,
      createdAt,
    },
  };
}

function series(id: string, versions: PromptVersionDto[]): PromptSeriesDto {
  return {
    id,
    title: id,
    currentVersionId: [...versions].sort((left, right) => right.versionNo - left.versionNo)[0]?.id ?? null,
    versions,
    importedOutputs: [],
    cover: null,
  };
}

function batch(
  id: string,
  createdAt: string,
  directions: Array<{ id: string; seriesId: string; versionId: string; runIds: string[] }>,
): StyleExplorationBatchDto {
  return {
    id,
    scope: { kind: 'SERIES', id: 'host' },
    sourceAssistantRunId: `assistant-${id}`,
    commonConstraints: [],
    status: 'SUCCEEDED',
    completedCount: directions.length,
    failedCount: 0,
    cancelledCount: 0,
    interruptedCount: 0,
    activeCount: 0,
    totalCount: directions.length,
    slots: directions.map((direction, sortOrder) => ({
      id: direction.id,
      batchId: id,
      sortOrder,
      label: direction.id,
      rationale: '',
      variableAxis: 'lighting',
      risk: '',
      userInstruction: direction.id,
      seriesId: direction.seriesId,
      versionId: direction.versionId,
      runIds: direction.runIds,
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

describe('creation output projection', () => {
  it('stacks multiple batches beside their frozen major version with stable decimal labels', () => {
    const host = series('host', [
      version('host-v5', 5, '2026-07-30T09:00:00.000Z', [
        run('host-run-5', '2026-07-30T09:05:00.000Z', asset('host-asset-5', '2026-07-30T09:05:00.000Z')),
      ]),
      version('host-v6', 6, '2026-07-30T10:00:00.000Z', [
        run('host-run-6', '2026-07-30T10:05:00.000Z', asset('host-asset-6', '2026-07-30T10:05:00.000Z')),
      ]),
      version('host-v7', 7, '2026-07-30T13:00:00.000Z'),
    ]);
    const directionA = series('direction-a', [
      version('direction-a-v1', 1, '2026-07-30T11:00:00.000Z', [
        run('run-a', '2026-07-30T11:01:00.000Z', asset('asset-a', '2026-07-30T11:01:00.000Z')),
      ]),
    ]);
    const directionB = series('direction-b', [
      version('direction-b-v1', 1, '2026-07-30T11:10:00.000Z', [
        run('run-b', '2026-07-30T11:11:00.000Z', asset('asset-b', '2026-07-30T11:11:00.000Z')),
      ]),
    ]);
    const directionC = series('direction-c', [
      version('direction-c-v1', 1, '2026-07-30T12:00:00.000Z', [
        run('run-c', '2026-07-30T12:01:00.000Z', asset('asset-c', '2026-07-30T12:01:00.000Z')),
      ]),
    ]);
    const first = batch('batch-1', '2026-07-30T11:00:00.000Z', [
      { id: 'slot-a', seriesId: 'direction-a', versionId: 'direction-a-v1', runIds: ['run-a'] },
      { id: 'slot-b', seriesId: 'direction-b', versionId: 'direction-b-v1', runIds: ['run-b'] },
    ]);
    const second = batch('batch-2', '2026-07-30T12:00:00.000Z', [
      { id: 'slot-c', seriesId: 'direction-c', versionId: 'direction-c-v1', runIds: ['run-c'] },
    ]);

    const projection = buildCreationOutputProjection(
      host,
      [host, directionA, directionB, directionC],
      [second, first, first],
    );

    expect(projection.map((group) => group.versionLabel)).toEqual(['V7', 'V6', 'V5']);
    expect(projection.find((group) => group.version.id === 'host-v6')).toMatchObject({
      primaryAssets: [{ asset: { id: 'host-asset-6' } }],
      directionStacks: [
        { versionLabel: 'V6.1', slot: { id: 'slot-a' }, assets: [{ asset: { id: 'asset-a' } }] },
        { versionLabel: 'V6.2', slot: { id: 'slot-b' }, assets: [{ asset: { id: 'asset-b' } }] },
        { versionLabel: 'V6.3', slot: { id: 'slot-c' }, assets: [{ asset: { id: 'asset-c' } }] },
      ],
    });
    expect(projection.find((group) => group.version.id === 'host-v5')?.directionStacks).toEqual([]);
  });

  it('collapses retries and duplicate assets into one logical stack item', () => {
    const host = series('host', [version('host-v6', 6, '2026-07-30T10:00:00.000Z')]);
    const sharedAsset = asset('retry-result', '2026-07-30T11:03:00.000Z');
    const direction = series('direction-a', [
      version('direction-a-v1', 1, '2026-07-30T11:00:00.000Z', [
        run('run-root-a', '2026-07-30T11:00:00.000Z', null),
        run('run-retry-a', '2026-07-30T11:03:00.000Z', sharedAsset, 'run-root-a'),
        run('run-root-b', '2026-07-30T11:01:00.000Z', sharedAsset),
      ]),
    ]);
    const experiment = batch('batch-1', '2026-07-30T11:00:00.000Z', [
      {
        id: 'slot-a',
        seriesId: 'direction-a',
        versionId: 'direction-a-v1',
        runIds: ['run-root-a', 'run-retry-a', 'run-retry-a', 'run-root-b'],
      },
    ]);

    const [group] = buildCreationOutputProjection(host, [host, direction], [experiment]);

    expect(group.directionStacks[0].assets).toMatchObject([
      {
        asset: { id: 'retry-result' },
        run: { id: 'run-retry-a' },
        lineageRootRunId: 'run-root-a',
      },
    ]);
  });

  it('keeps historical experiments with the version that existed at batch creation', () => {
    const host = series('host', [
      version('host-v6', 6, '2026-07-30T10:00:00.000Z'),
      version('host-v7', 7, '2026-07-30T12:00:00.000Z'),
      version('host-v8', 8, '2026-07-30T14:00:00.000Z'),
    ]);
    const historical = batch('historical', '2026-07-30T11:00:00.000Z', [
      {
        id: 'slot-old',
        seriesId: 'missing-direction',
        versionId: 'missing-version',
        runIds: [],
      },
    ]);
    const later = batch('later', '2026-07-30T13:00:00.000Z', [
      {
        id: 'slot-new',
        seriesId: 'missing-direction-2',
        versionId: 'missing-version-2',
        runIds: [],
      },
    ]);

    const projection = buildCreationOutputProjection(host, [host], [later, historical]);

    expect(projection.find((group) => group.version.id === 'host-v6')?.directionStacks[0].versionLabel).toBe('V6.1');
    expect(projection.find((group) => group.version.id === 'host-v7')?.directionStacks[0].versionLabel).toBe('V7.1');
    expect(projection.find((group) => group.version.id === 'host-v8')?.directionStacks).toEqual([]);
  });

  it('anchors a draft-era batch re-homed before V1 existed to the earliest version', () => {
    const host = series('host', [
      version('host-v1', 1, '2026-07-30T10:00:00.000Z'),
      version('host-v2', 2, '2026-07-30T12:00:00.000Z'),
    ]);
    const rehomed = batch('draft-era', '2026-07-30T09:00:00.000Z', []);

    expect(sourceVersionForExplorationBatch(host, rehomed)?.id).toBe('host-v1');
  });
});
