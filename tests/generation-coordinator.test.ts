import { describe, expect, it, vi } from 'vitest';
import type { GenerationInput } from '../src/shared/contracts';
import type { LibraryDatabase } from '../src/main/database';
import { GenerationCoordinator } from '../src/main/generation';
import {
  GenerationModelRegistry,
  type GenerationModel,
  type GenerationExecutionObserver,
  type GenerationModelResult,
  type GenerationStarted,
  type PreparedGenerationExecution,
} from '../src/main/generation-models';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const input: GenerationInput = {
  seriesId: null,
  title: '并行测试',
  manualPrompt: 'portrait',
  prompt: 'portrait',
  changeSummary: '',
  referenceAssetIds: [],
  termPromptLocale: 'en',
  termIds: [],
  wordPaletteReferences: [],
  modelKey: 'gpt-image-2',
  canvasPresetKey: 'portrait_2_3',
  width: 1024,
  height: 1536,
  quality: 'low',
};

type ExecuteGeneration = (
  runId: string,
  input: GenerationInput,
  onStarted: GenerationStarted,
  onSignal?: GenerationExecutionObserver,
) => Promise<GenerationModelResult>;

const descriptor: GenerationModel['descriptor'] = {
  key: 'gpt-image-2',
  name: 'GPT Image 2',
  provider: 'Test',
  providerKey: 'test',
  modelId: 'gpt-image-2',
  state: 'READY',
  availabilityReason: null,
  releaseStage: 'STABLE',
  internal: false,
  maxReferenceImages: 0,
  capabilities: ['GENERATE'],
  qualityMode: 'SELECTABLE',
  supportedQualities: ['low', 'medium', 'high'],
};

function modelRegistry(executeGeneration: ExecuteGeneration) {
  return new GenerationModelRegistry([
    {
      descriptor,
      prepareExecution(runId, generationInput) {
        return {
          requestSnapshot: {
            route: 'MODEL_INPUT',
            requestSchema: 'test-model-input.v1',
            actualRequest: { runId, prompt: generationInput.prompt },
          },
          execute: (onStarted, onSignal) => executeGeneration(runId, generationInput, onStarted, onSignal),
        };
      },
    },
  ]);
}

function preparedModelRegistry(prepareExecution: NonNullable<GenerationModel['prepareExecution']>) {
  return new GenerationModelRegistry([
    {
      descriptor,
      prepareExecution,
    },
  ]);
}

function coordinatorDatabase(overrides: Record<string, unknown>): LibraryDatabase {
  const promptInput = {
    userInstruction: input.manualPrompt,
    directTermPromptLocale: input.termPromptLocale ?? 'en',
    directTerms: [],
    recipes: [],
    directReferences: [],
  };
  return {
    capturePromptCommonInput: () => promptInput,
    getPromptCommonInput: () => promptInput,
    resolveGenerationInput: (generationInput: GenerationInput) => generationInput,
    freezeGenerationExecution: () => undefined,
    ...overrides,
  } as unknown as LibraryDatabase;
}

describe('generation coordinator', () => {
  it('persists a visible cancelled experiment when a later direction cannot be prepared', () => {
    const createStyleExplorationBatch = vi.fn((value) => ({
      id: 'recovered-batch',
      totalCount: value.slots.flatMap((slot: { runIds: string[] }) => slot.runIds).length,
    }));
    const markRun = vi.fn();
    let preparation = 0;
    const database = coordinatorDatabase({
      validateStyleExplorationStart: vi.fn(),
      prepareGeneration: vi.fn(() => {
        preparation += 1;
        if (preparation === 2) throw new Error('second direction rejected');
        return {
          runId: 'run-first',
          seriesId: 'series-first',
          versionId: 'version-first',
          effectiveReferenceAssetIds: [],
        };
      }),
      createStyleExplorationBatch,
      markRun,
      finishGeneration: vi.fn(),
    });
    const generate = vi.fn(() => new Promise<never>(() => undefined));
    const coordinator = new GenerationCoordinator(database, modelRegistry(generate));
    const { modelKey: _modelKey, seriesId: _seriesId, ...slotInput } = input;

    expect(() =>
      coordinator.startStyleExploration({
        scope: { kind: 'DRAFT', id: 'draft-1' },
        sourceAssistantRunId: 'assistant-1',
        commonConstraints: ['same subject'],
        targets: [{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }],
        slots: [
          {
            label: 'First',
            rationale: 'First axis',
            variableAxis: 'light',
            risk: 'contrast',
            userInstruction: 'first prompt',
            input: { ...slotInput, manualPrompt: 'first prompt', prompt: 'first prompt' },
          },
          {
            label: 'Second',
            rationale: 'Second axis',
            variableAxis: 'color',
            risk: 'cast',
            userInstruction: 'second prompt',
            input: { ...slotInput, manualPrompt: 'second prompt', prompt: 'second prompt' },
          },
        ],
      }),
    ).toThrow('second direction rejected');

    expect(markRun).toHaveBeenCalledWith('run-first', 'CANCELLED', undefined, 'EXPLORATION_SUBMISSION_ABORTED');
    expect(createStyleExplorationBatch).toHaveBeenCalledOnce();
    expect(createStyleExplorationBatch.mock.calls[0][0].slots).toEqual([
      expect.objectContaining({ label: 'First', runIds: ['run-first'] }),
    ]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('applies each target count and quality independently in a batch', () => {
    const preparedInputs: GenerationInput[] = [];
    const database = coordinatorDatabase({
      prepareGeneration: (generationInput: GenerationInput) => {
        preparedInputs.push(generationInput);
        const index = preparedInputs.length;
        return { runId: `run-${index}`, seriesId: 'series', versionId: 'version', effectiveReferenceAssetIds: [] };
      },
      markRun: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const models = modelRegistry((_runId, _generationInput, onStarted) => {
      onStarted(vi.fn());
      return new Promise<never>(() => undefined);
    });
    const coordinator = new GenerationCoordinator(database, models);

    coordinator.startBatch({
      input,
      targets: [
        { modelKey: 'gpt-image-2', count: 2, quality: 'high' },
        { modelKey: 'gpt-image-2', count: 1, quality: 'low' },
      ],
    });

    expect(preparedInputs.map(({ modelKey, quality }) => ({ modelKey, quality }))).toEqual([
      { modelKey: 'gpt-image-2', quality: 'high' },
      { modelKey: 'gpt-image-2', quality: 'high' },
      { modelKey: 'gpt-image-2', quality: 'low' },
    ]);
    coordinator.dispose();
  });

  it('starts submissions up to the application concurrency limit', async () => {
    let prepared = 0;
    const statusChanges: Array<[string, string]> = [];
    const outputs = new Map<string, ReturnType<typeof deferred<string>>>();
    let active = 0;
    let peakActive = 0;
    const database = coordinatorDatabase({
      prepareGeneration: () => {
        prepared += 1;
        return {
          runId: `run-${prepared}`,
          seriesId: `series-${prepared}`,
          versionId: `version-${prepared}`,
          effectiveReferenceAssetIds: [],
        };
      },
      markRun: (runId: string, status: string) => {
        statusChanges.push([runId, status]);
      },
      finishGeneration: vi.fn(),
    });
    const models = modelRegistry((runId: string, _generationInput: GenerationInput, onStarted) => {
      const output = deferred<string>();
      outputs.set(runId, output);
      active += 1;
      peakActive = Math.max(peakActive, active);
      onStarted(vi.fn());
      return output.promise
        .then((outputPath) => ({ kind: 'FILE' as const, outputPath }))
        .finally(() => {
          active -= 1;
        });
    });
    const coordinator = new GenerationCoordinator(database, models);

    coordinator.start(input);
    coordinator.start(input);
    coordinator.start(input);

    await vi.waitFor(() => expect(coordinator.tasks.every((task) => task.phase === 'GENERATING')).toBe(true));
    expect(coordinator.tasks.map((task) => [task.runId, task.status, task.phase, task.queuePosition])).toEqual([
      ['run-1', 'RUNNING', 'GENERATING', null],
      ['run-2', 'RUNNING', 'GENERATING', null],
      ['run-3', 'RUNNING', 'GENERATING', null],
    ]);
    expect(peakActive).toBe(3);

    outputs.get('run-1')!.resolve('one.png');
    outputs.get('run-2')!.resolve('two.png');
    outputs.get('run-3')!.resolve('three.png');
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));
    expect(database.finishGeneration).toHaveBeenCalledTimes(3);
    expect(statusChanges.filter(([, status]) => status === 'RUNNING')).toHaveLength(3);
  });

  it('keeps excess work queued and starts it when a running slot is released', async () => {
    let prepared = 0;
    const outputs = new Map<string, ReturnType<typeof deferred<string>>>();
    const database = coordinatorDatabase({
      prepareGeneration: () => {
        prepared += 1;
        return { runId: `run-${prepared}`, seriesId: 'series', versionId: 'version', effectiveReferenceAssetIds: [] };
      },
      markRun: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const models = modelRegistry((runId, _generationInput, onStarted) => {
      const output = deferred<string>();
      outputs.set(runId, output);
      onStarted(vi.fn());
      return output.promise.then((outputPath) => ({ kind: 'FILE' as const, outputPath }));
    });
    const coordinator = new GenerationCoordinator(database, models, 2);

    coordinator.start(input);
    coordinator.start(input);
    coordinator.start(input);

    await vi.waitFor(() => expect(outputs.size).toBe(2));
    expect(coordinator.tasks.map((task) => [task.runId, task.status, task.phase, task.queuePosition])).toEqual([
      ['run-1', 'RUNNING', 'GENERATING', null],
      ['run-2', 'RUNNING', 'GENERATING', null],
      ['run-3', 'QUEUED', 'QUEUED', 1],
    ]);
    expect(outputs.has('run-3')).toBe(false);

    outputs.get('run-1')!.resolve('one.png');
    await vi.waitFor(() => expect(outputs.has('run-3')).toBe(true));
    expect(coordinator.tasks.find((task) => task.runId === 'run-3')).toMatchObject({
      status: 'RUNNING',
      phase: 'GENERATING',
    });

    outputs.get('run-2')!.resolve('two.png');
    outputs.get('run-3')!.resolve('three.png');
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));
  });

  it('persists provider acceptance and reports adapter progress without inventing progress', async () => {
    const output = deferred<{ kind: 'FILE'; outputPath: string }>();
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun: vi.fn(),
      markGenerationPhase: vi.fn(),
      recordGenerationProviderAccepted: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(
      database,
      preparedModelRegistry(async () => ({
        requestSnapshot: { route: 'PROVIDER_ADAPTER', requestSchema: 'test.v1', actualRequest: {} },
        execute: async (onStarted, onSignal) => {
          onStarted(vi.fn());
          onSignal?.({ type: 'REQUEST_ACCEPTED', providerRequestId: 'provider-42' });
          onSignal?.({ type: 'PROGRESS', stage: 'UPLOADING', progress: 0.42 });
          return output.promise;
        },
      })),
    );

    coordinator.start(input);

    await vi.waitFor(() =>
      expect(coordinator.tasks[0]).toMatchObject({
        phase: 'UPLOADING',
        progress: 0.42,
      }),
    );
    expect(database.recordGenerationProviderAccepted).toHaveBeenCalledWith('run-1', {
      providerKey: 'test',
      providerRequestId: 'provider-42',
    });
    expect(database.markGenerationPhase).toHaveBeenCalledWith('run-1', 'UPLOADING', 0.42, undefined);

    output.resolve({ kind: 'FILE', outputPath: 'result.png' });
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));
  });

  it('cancels one running execution without affecting other work', async () => {
    let prepared = 0;
    const outputs = new Map<string, ReturnType<typeof deferred<string>>>();
    const cancellations = new Map<string, ReturnType<typeof vi.fn>>();
    const markRun = vi.fn();
    const database = coordinatorDatabase({
      prepareGeneration: () => {
        prepared += 1;
        return { runId: `run-${prepared}`, seriesId: 'series', versionId: 'version', effectiveReferenceAssetIds: [] };
      },
      markRun,
      finishGeneration: vi.fn(),
    });
    const models = modelRegistry((runId: string, _generationInput: GenerationInput, onStarted) => {
      const output = deferred<string>();
      const cancel = vi.fn();
      outputs.set(runId, output);
      cancellations.set(runId, cancel);
      onStarted(cancel);
      return output.promise.then((outputPath) => ({ kind: 'FILE' as const, outputPath }));
    });
    const coordinator = new GenerationCoordinator(database, models);

    coordinator.start(input);
    coordinator.start(input);
    await vi.waitFor(() => expect(cancellations.size).toBe(2));
    coordinator.cancel('run-2');

    expect(coordinator.tasks.map((task) => [task.runId, task.phase])).toEqual([
      ['run-1', 'GENERATING'],
      ['run-2', 'CANCELLING'],
    ]);
    expect(cancellations.get('run-2')).toHaveBeenCalledOnce();
    outputs.get('run-2')!.resolve('cancelled.png');
    outputs.get('run-1')!.resolve('one.png');
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));
    expect(markRun).toHaveBeenCalledWith('run-2', 'CANCELLED', undefined, 'USER_CANCELLED');
    expect(database.finishGeneration).toHaveBeenCalledTimes(1);
  });

  it('links a generic retry back to its exploration slot before launching it', () => {
    const callOrder: string[] = [];
    const linkStyleExplorationRetry = vi.fn(() => {
      callOrder.push('link');
    });
    const markRun = vi.fn((_runId: string, status: string) => {
      if (status === 'RUNNING') callOrder.push('launch');
    });
    const database = coordinatorDatabase({
      styleExplorationSlotIdForRun: vi.fn(() => 'slot-1'),
      prepareGenerationRetry: vi.fn(() => ({
        runId: 'run-retry',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
        input: { ...input, seriesId: 'series' },
      })),
      linkStyleExplorationRetry,
      markRun,
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(
      database,
      modelRegistry((_runId, _generationInput, onStarted) => {
        onStarted(vi.fn());
        return new Promise<never>(() => undefined);
      }),
    );

    expect(coordinator.retry('run-source')).toEqual({
      runId: 'run-retry',
      seriesId: 'series',
      versionId: 'version',
    });
    expect(linkStyleExplorationRetry).toHaveBeenCalledWith('slot-1', 'run-retry');
    expect(callOrder).toEqual(['link', 'launch']);
    coordinator.dispose();
  });

  it('cancels a prepared generic retry when exploration lineage cannot be linked', () => {
    const markRun = vi.fn();
    const generate = vi.fn(async () => ({ kind: 'FILE' as const, outputPath: 'unused.png' }));
    const database = coordinatorDatabase({
      styleExplorationSlotIdForRun: vi.fn(() => 'slot-1'),
      prepareGenerationRetry: vi.fn(() => ({
        runId: 'run-retry',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
        input: { ...input, seriesId: 'series' },
      })),
      linkStyleExplorationRetry: vi.fn(() => {
        throw new Error('lineage conflict');
      }),
      markRun,
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(database, modelRegistry(generate));

    expect(() => coordinator.retry('run-source')).toThrow('lineage conflict');
    expect(markRun).toHaveBeenCalledWith('run-retry', 'CANCELLED', undefined, 'EXPLORATION_RETRY_LINK_FAILED');
    expect(coordinator.tasks).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('marks unfinished work as interrupted when the service closes', async () => {
    const cancel = vi.fn();
    const markRun = vi.fn();
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun,
      finishGeneration: vi.fn(),
    });
    const models = modelRegistry((_runId: string, _generationInput: GenerationInput, onStarted) => {
      onStarted(cancel);
      return new Promise<never>(() => undefined);
    });
    const coordinator = new GenerationCoordinator(database, models);

    coordinator.start(input);
    await vi.waitFor(() => expect(coordinator.tasks[0]?.phase).toBe('GENERATING'));
    coordinator.dispose();

    expect(cancel).toHaveBeenCalledOnce();
    expect(coordinator.tasks).toEqual([]);
    expect(markRun).toHaveBeenCalledWith('run-1', 'INTERRUPTED', undefined, 'APPLICATION_CLOSED');
  });

  it('preserves an explicit cancellation when the service closes before the provider settles', () => {
    const cancel = vi.fn();
    const markRun = vi.fn();
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun,
      markGenerationPhase: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const models = modelRegistry((_runId, _generationInput, onStarted) => {
      onStarted(cancel);
      return new Promise<never>(() => undefined);
    });
    const coordinator = new GenerationCoordinator(database, models);

    coordinator.start(input);
    coordinator.cancel('run-1');
    coordinator.dispose();

    expect(markRun).toHaveBeenLastCalledWith('run-1', 'CANCELLED', undefined, 'USER_CANCELLED');
  });

  it('preserves prepared files on service shutdown for startup reconciliation', async () => {
    const execution = deferred<{ kind: 'FILE'; outputPath: string }>();
    const cleanup = vi.fn();
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(
      database,
      preparedModelRegistry(async () => ({
        requestSnapshot: { route: 'MODEL_INPUT', requestSchema: 'shutdown-recovery.v1', actualRequest: {} },
        execute: async (onStarted) => {
          onStarted(() => execution.reject(new Error('terminated')));
          return execution.promise;
        },
        cleanup,
      })),
    );

    coordinator.start(input);
    await vi.waitFor(() => expect(coordinator.tasks[0]?.phase).toBe('GENERATING'));
    coordinator.dispose();
    await vi.waitFor(() =>
      expect(database.markRun).toHaveBeenCalledWith('run-1', 'INTERRUPTED', undefined, 'APPLICATION_CLOSED'),
    );

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('releases prepared resources after execution failure', async () => {
    const cleanup = vi.fn();
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(
      database,
      preparedModelRegistry(async () => ({
        requestSnapshot: {
          route: 'MODEL_INPUT',
          requestSchema: 'cleanup-test.v1',
          actualRequest: {},
        },
        execute: async () => {
          throw new Error('provider failure');
        },
        cleanup,
      })),
    );

    coordinator.start(input);
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));

    expect(cleanup).toHaveBeenCalledOnce();
    expect(database.markRun).toHaveBeenCalledWith('run-1', 'FAILED', 'provider failure', 'GENERATION_FAILED');
  });

  it('preserves a completed file when durable ingestion fails so startup recovery can retry it', async () => {
    const cleanup = vi.fn();
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun: vi.fn(),
      finishGeneration: vi.fn(() => {
        throw new Error('database busy');
      }),
    });
    const coordinator = new GenerationCoordinator(
      database,
      preparedModelRegistry(async () => ({
        requestSnapshot: { route: 'MODEL_INPUT', requestSchema: 'save-failure.v1', actualRequest: {} },
        execute: async (onStarted) => {
          onStarted(vi.fn());
          return { kind: 'FILE' as const, outputPath: 'result.png' };
        },
        cleanup,
      })),
    );

    coordinator.start(input);
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));

    expect(cleanup).not.toHaveBeenCalled();
    expect(database.markRun).toHaveBeenCalledWith('run-1', 'INTERRUPTED', 'database busy', 'OUTPUT_COMMIT_FAILED');
  });

  it('preserves a completed file when post-provider lifecycle metadata cannot be committed', async () => {
    const cleanup = vi.fn();
    const persistenceError = Object.assign(new Error('state store unavailable'), { code: 'LOCAL_STATE' });
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun: vi.fn(),
      recordGenerationProviderAccepted: vi.fn(() => {
        throw persistenceError;
      }),
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(
      database,
      preparedModelRegistry(async () => ({
        requestSnapshot: { route: 'MODEL_INPUT', requestSchema: 'metadata-failure.v1', actualRequest: {} },
        execute: async (onStarted) => {
          onStarted(vi.fn());
          return {
            kind: 'FILE' as const,
            outputPath: 'result.png',
            providerRequestId: 'provider-1',
          };
        },
        cleanup,
      })),
    );

    coordinator.start(input);
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));

    expect(cleanup).not.toHaveBeenCalled();
    expect(database.finishGeneration).not.toHaveBeenCalled();
    expect(database.markRun).toHaveBeenCalledWith('run-1', 'INTERRUPTED', 'state store unavailable', 'LOCAL_STATE');
  });

  it('releases a prepared job without executing it when cancelled during preparation', async () => {
    const prepared = deferred<PreparedGenerationExecution>();
    const cleanup = vi.fn();
    const execute = vi.fn(async () => ({ kind: 'FILE' as const, outputPath: 'unused.png' }));
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(
      database,
      preparedModelRegistry(() => prepared.promise),
    );

    coordinator.start(input);
    coordinator.cancel('run-1');
    prepared.resolve({
      requestSnapshot: {
        route: 'MODEL_INPUT',
        requestSchema: 'cleanup-test.v1',
        actualRequest: {},
      },
      execute,
      cleanup,
    });
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));

    expect(execute).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(database.finishGeneration).not.toHaveBeenCalled();
  });

  it('releases prepared resources after a running cancellation settles', async () => {
    const execution = deferred<{ kind: 'FILE'; outputPath: string }>();
    const cleanup = vi.fn();
    const cancel = vi.fn(() => execution.reject(new Error('terminated')));
    const database = coordinatorDatabase({
      prepareGeneration: () => ({
        runId: 'run-1',
        seriesId: 'series',
        versionId: 'version',
        effectiveReferenceAssetIds: [],
      }),
      markRun: vi.fn(),
      finishGeneration: vi.fn(),
    });
    const coordinator = new GenerationCoordinator(
      database,
      preparedModelRegistry(async () => ({
        requestSnapshot: {
          route: 'MODEL_INPUT',
          requestSchema: 'cleanup-test.v1',
          actualRequest: {},
        },
        execute: async (onStarted) => {
          onStarted(cancel);
          return execution.promise;
        },
        cleanup,
      })),
    );

    coordinator.start(input);
    await vi.waitFor(() => expect(coordinator.tasks[0]?.phase).toBe('GENERATING'));
    coordinator.cancel('run-1');
    await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));

    expect(cancel).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(database.finishGeneration).not.toHaveBeenCalled();
  });
});
