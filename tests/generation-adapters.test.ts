import { describe, expect, it, vi } from 'vitest';
import type { GenerationInput, GenerationModelCapability, GenerationModelDto } from '../src/shared/contracts';
import {
  AdapterBackedGenerationModel,
  effectiveGenerationModelDescriptor,
  GenerationAdapterError,
  validateGenerationAdapterRequest,
  type GenerationAdapter,
  type GenerationAdapterEvent,
  type GenerationAdapterResult,
  type NormalizedGenerationMedia,
  type NormalizedGenerationRequest,
} from '../src/main/generation-models/adapters';

const input: GenerationInput = {
  seriesId: null,
  title: '适配器测试',
  manualPrompt: 'portrait',
  prompt: 'portrait',
  changeSummary: '',
  referenceAssetIds: [],
  termPromptLocale: 'en',
  termIds: [],
  wordPaletteReferences: [],
  modelKey: 'test-image',
  canvasPresetKey: null,
  width: 1024,
  height: 1024,
  quality: 'medium',
};

function descriptor(
  capabilities: GenerationModelCapability[] = ['GENERATE'],
  overrides: Partial<GenerationModelDto> = {},
): GenerationModelDto {
  return {
    key: 'test-image',
    name: 'Test Image',
    provider: 'Test Provider',
    providerKey: 'test-provider',
    modelId: 'test-image-v1',
    state: 'READY',
    availabilityReason: null,
    releaseStage: 'PREVIEW',
    internal: false,
    maxReferenceImages: 8,
    capabilities,
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
    ...overrides,
  };
}

function adapter(overrides: Partial<GenerationAdapter> = {}): GenerationAdapter {
  return {
    providerKey: 'test-provider',
    capabilities: ['GENERATE'],
    maxReferenceImages: 8,
    execute: async () => ({ kind: 'FILE', outputPath: 'C:\\outputs\\image.png' }),
    ...overrides,
  };
}

function media(role: NormalizedGenerationMedia['role'], assetId = role.toLowerCase()): NormalizedGenerationMedia {
  return {
    assetId,
    role,
    localPath: `C:\\assets\\${assetId}.png`,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
  };
}

function request(overrides: Partial<NormalizedGenerationRequest> = {}): NormalizedGenerationRequest {
  return {
    runId: 'run-1',
    modelKey: 'test-image',
    providerKey: 'test-provider',
    modelId: 'test-image-v1',
    operation: 'GENERATE',
    prompt: 'A studio portrait',
    media: [],
    output: { width: 1024, height: 1024, quality: 'medium' },
    ...overrides,
  };
}

describe('generation adapter capabilities and validation', () => {
  it('exposes the ordered capability intersection and the stricter image limit', () => {
    const model = descriptor(['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT', 'MASK_EDIT'], {
      maxReferenceImages: 8,
    });
    const effective = effectiveGenerationModelDescriptor(
      model,
      adapter({
        capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'IMAGE_EDIT'],
        maxReferenceImages: 3,
      }),
    );

    expect(effective.capabilities).toEqual(['GENERATE', 'REFERENCE_IMAGE', 'IMAGE_EDIT']);
    expect(effective.maxReferenceImages).toBe(3);
    expect(effective.state).toBe('READY');
  });

  it('marks a model unavailable when its adapter cannot generate', () => {
    const effective = effectiveGenerationModelDescriptor(
      descriptor(['GENERATE', 'IMAGE_EDIT']),
      adapter({ capabilities: ['IMAGE_EDIT'] }),
    );

    expect(effective).toMatchObject({
      state: 'UNAVAILABLE',
      availabilityReason: 'ADAPTER_CAPABILITY_MISMATCH',
      capabilities: ['IMAGE_EDIT'],
    });
  });

  it('accepts an edit source plus annotation guide only when both layers support it', () => {
    const validateRequest = vi.fn();
    const implementation = adapter({
      capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT'],
      validateRequest,
    });
    const model = effectiveGenerationModelDescriptor(
      descriptor(['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT']),
      implementation,
    );
    const editRequest = request({
      operation: 'EDIT',
      media: [media('EDIT_SOURCE'), media('ANNOTATION_GUIDE')],
    });

    expect(() => validateGenerationAdapterRequest(model, implementation, editRequest)).not.toThrow();
    expect(validateRequest).toHaveBeenCalledWith(editRequest);
  });

  it('rejects a mask when MASK_EDIT exists only in the catalog layer', () => {
    const implementation = adapter({ capabilities: ['GENERATE', 'IMAGE_EDIT'] });
    const model = effectiveGenerationModelDescriptor(
      descriptor(['GENERATE', 'IMAGE_EDIT', 'MASK_EDIT']),
      implementation,
    );
    const editRequest = request({
      operation: 'EDIT',
      media: [media('EDIT_SOURCE'), media('MASK')],
    });

    expect(() => validateGenerationAdapterRequest(model, implementation, editRequest)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_CAPABILITY',
        details: expect.objectContaining({ capability: 'MASK_EDIT' }),
      }),
    );
  });

  it('counts visual inputs against the effective limit but excludes a mask', () => {
    const implementation = adapter({
      capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT', 'MASK_EDIT'],
      maxReferenceImages: 3,
    });
    const model = effectiveGenerationModelDescriptor(
      descriptor(['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT', 'MASK_EDIT']),
      implementation,
    );
    const atLimit = request({
      operation: 'EDIT',
      media: [media('EDIT_SOURCE'), media('REFERENCE', 'reference-1'), media('ANNOTATION_GUIDE'), media('MASK')],
    });

    expect(() => validateGenerationAdapterRequest(model, implementation, atLimit)).not.toThrow();
    expect(() =>
      validateGenerationAdapterRequest(model, implementation, {
        ...atLimit,
        media: [...atLimit.media, media('REFERENCE', 'reference-2')],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_CAPABILITY',
        details: expect.objectContaining({ inputImageCount: 4, maxReferenceImages: 3 }),
      }),
    );
  });

  it('rejects edit-only roles in a GENERATE request', () => {
    const implementation = adapter({
      capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE'],
    });
    const model = effectiveGenerationModelDescriptor(
      descriptor(['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE']),
      implementation,
    );

    expect(() =>
      validateGenerationAdapterRequest(
        model,
        implementation,
        request({
          media: [media('ANNOTATION_GUIDE')],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });
});

describe('AdapterBackedGenerationModel', () => {
  it('adapts a successful execution and publishes structured lifecycle events', async () => {
    const events: GenerationAdapterEvent[] = [];
    const output: GenerationAdapterResult = {
      kind: 'FILE',
      outputPath: 'C:\\outputs\\finished.png',
      mimeType: 'image/png',
      providerRequestId: 'provider-request-1',
    };
    const execute = vi.fn<GenerationAdapter['execute']>(async (_request, context) => {
      context.emit({ type: 'REQUEST_ACCEPTED', providerRequestId: 'provider-request-1' });
      context.emit({ type: 'PROGRESS', stage: 'GENERATING', progress: 0.5 });
      return output;
    });
    const model = new AdapterBackedGenerationModel({
      descriptor: descriptor(),
      adapter: adapter({ execute }),
      createRequest: ({ runId }) => request({ runId }),
      onEvent: (event) => events.push(event),
      now: () => '2026-07-29T12:00:00.000Z',
    });
    const onStarted = vi.fn();

    const prepared = await model.prepareExecution('run-1', input);
    await expect(prepared.execute(onStarted)).resolves.toEqual(output);
    expect(onStarted).toHaveBeenCalledOnce();
    expect(onStarted).toHaveBeenCalledWith(expect.any(Function));
    expect(execute).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual(['STARTED', 'REQUEST_ACCEPTED', 'PROGRESS', 'COMPLETED']);
    expect(events[1]).toMatchObject({
      runId: 'run-1',
      timestamp: '2026-07-29T12:00:00.000Z',
      providerRequestId: 'provider-request-1',
    });
  });

  it('turns an in-flight cancellation into a structured failure', async () => {
    let cancel: (() => void) | undefined;
    const events: GenerationAdapterEvent[] = [];
    const execute = vi.fn<GenerationAdapter['execute']>(
      (_request, context) =>
        new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('stopped')))),
    );
    const model = new AdapterBackedGenerationModel({
      descriptor: descriptor(),
      adapter: adapter({ execute }),
      createRequest: ({ runId }) => request({ runId }),
      onEvent: (event) => events.push(event),
    });

    const prepared = await model.prepareExecution('run-1', input);
    const generation = prepared.execute((receivedCancel) => {
      cancel = receivedCancel;
    });
    await vi.waitFor(() => expect(cancel).toEqual(expect.any(Function)));
    cancel?.();

    await expect(generation).rejects.toMatchObject({
      name: 'GenerationAdapterError',
      code: 'CANCELLED',
      retryable: false,
    });
    expect(events.at(-1)).toMatchObject({
      type: 'FAILED',
      error: { code: 'CANCELLED', retryable: false },
    });
  });

  it('fails explicitly when durable lifecycle persistence rejects provider acceptance', async () => {
    const execute = vi.fn<GenerationAdapter['execute']>(async (_request, context) => {
      context.emit({ type: 'REQUEST_ACCEPTED', providerRequestId: 'paid-request-1' });
      return {
        kind: 'FILE',
        outputPath: 'C:\\outputs\\uncommitted.png',
        mimeType: 'image/png',
      };
    });
    const model = new AdapterBackedGenerationModel({
      descriptor: descriptor(),
      adapter: adapter({ execute }),
      createRequest: ({ runId }) => request({ runId }),
    });
    const prepared = await model.prepareExecution('run-1', input);

    await expect(
      prepared.execute(vi.fn(), () => {
        throw new Error('database is read-only');
      }),
    ).rejects.toMatchObject({
      name: 'GenerationAdapterError',
      code: 'LOCAL_STATE',
      retryable: false,
      details: { signalType: 'REQUEST_ACCEPTED' },
    });
  });

  it('preserves adapter errors and isolates event-listener failures', async () => {
    const providerError = new GenerationAdapterError({
      code: 'RATE_LIMITED',
      message: 'Try again later',
      providerCode: '429',
    });
    const execute = vi.fn<GenerationAdapter['execute']>(async (_request, context) => {
      context.emit({ type: 'WARNING', code: 'DEGRADED', message: 'Slow path' });
      throw providerError;
    });
    const model = new AdapterBackedGenerationModel({
      descriptor: descriptor(),
      adapter: adapter({ execute }),
      createRequest: ({ runId }) => request({ runId }),
      onEvent: () => {
        throw new Error('telemetry failed');
      },
    });

    const prepared = await model.prepareExecution('run-1', input);
    await expect(prepared.execute(vi.fn())).rejects.toBe(providerError);
    expect(execute).toHaveBeenCalledOnce();
  });
});
