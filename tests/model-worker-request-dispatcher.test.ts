import { describe, expect, it, vi } from 'vitest';
import type { DeepSeekAssistantAdapter } from '@/main/assistant-models/deepseek';
import type { CodexAdapter } from '@/main/codex';
import type { LibraryDatabase } from '@/main/database';
import type { DeepSeekApiRuntime } from '@/main/extensions/deepseek-api/runtime';
import type { ExternalImageApiRuntime } from '@/main/extensions/external-image-api/runtime';
import type { OpenAiImageApiRuntime } from '@/main/extensions/openai-image-api/runtime';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { GenerationCoordinator } from '@/main/generation';
import {
  createModelWorkerRequestDispatcher,
  type ModelWorkerRequestDispatcherOptions,
} from '@/main/model-worker/request-dispatcher';
import type { ModelWorkerSnapshot } from '@/main/model-worker/protocol';

function dispatcherFixture(overrides: Partial<ModelWorkerRequestDispatcherOptions> = {}) {
  const snapshot: ModelWorkerSnapshot = {
    protocolVersion: 1,
    runtimeFingerprint: 'a'.repeat(64),
    workerId: 'worker-1',
    codexHealth: { state: 'ready', version: 'test', authenticated: true, message: 'ready' },
    codexPendingCount: 0,
    imageGenerationRoutes: [],
    generationTasks: [],
  };
  const options: ModelWorkerRequestDispatcherOptions = {
    database: {} as LibraryDatabase,
    generation: { hasPending: false } as GenerationCoordinator,
    codex: { hasPending: false } as CodexAdapter,
    deepSeek: {} as DeepSeekAssistantAdapter,
    extensions: {} as ExtensionRegistry,
    openAiImageApi: {} as OpenAiImageApiRuntime,
    deepSeekApi: {} as DeepSeekApiRuntime,
    externalImageApis: {} as ExternalImageApiRuntime,
    libraryRoot: 'C:\\library',
    imageTransformWorkerPath: 'C:\\workers\\image-transform.js',
    activeRequestCount: () => 1,
    beginAssistantJob: vi.fn(),
    endAssistantJob: vi.fn(),
    snapshot: () => snapshot,
    broadcast: vi.fn(),
    broadcastSnapshot: vi.fn(),
    scheduleGracefulShutdown: vi.fn(),
    scheduleShutdownWhenIdle: vi.fn(),
    scheduleForceShutdown: vi.fn(),
    ...overrides,
  };
  return { dispatch: createModelWorkerRequestDispatcher(options), options, snapshot };
}

describe('model worker request dispatcher', () => {
  it('returns the current snapshot without turning a read into a broadcast', async () => {
    const { dispatch, options, snapshot } = dispatcherFixture();

    await expect(dispatch('snapshot', [], new AbortController().signal)).resolves.toBe(snapshot);
    expect(options.broadcastSnapshot).not.toHaveBeenCalled();
  });

  it('schedules an immediate graceful shutdown only while the worker is idle', async () => {
    const scheduleGracefulShutdown = vi.fn();
    const idle = dispatcherFixture({ scheduleGracefulShutdown });

    await expect(idle.dispatch('worker.shutdown', [], new AbortController().signal)).resolves.toBeUndefined();
    expect(scheduleGracefulShutdown).toHaveBeenCalledOnce();

    const busy = dispatcherFixture({
      generation: { hasPending: true } as GenerationCoordinator,
      scheduleGracefulShutdown,
    });
    await expect(busy.dispatch('worker.shutdown', [], new AbortController().signal)).rejects.toMatchObject({
      code: 'WORKER_BUSY',
    });
    expect(scheduleGracefulShutdown).toHaveBeenCalledOnce();
  });

  it('rejects shutdown when another authenticated request has not drained', async () => {
    const scheduleGracefulShutdown = vi.fn();
    const { dispatch } = dispatcherFixture({ activeRequestCount: () => 2, scheduleGracefulShutdown });

    await expect(dispatch('worker.shutdown', [], new AbortController().signal)).rejects.toMatchObject({
      code: 'WORKER_BUSY',
    });
    expect(scheduleGracefulShutdown).not.toHaveBeenCalled();
  });
});
