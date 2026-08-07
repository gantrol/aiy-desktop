import { describe, expect, it } from 'vitest';
import type { GenerationModelCapability, GenerationModelDto } from '../src/shared/contracts';
import { generationReadiness } from '../src/renderer/components/creator/generationReadiness';

function model(overrides: Partial<GenerationModelDto> = {}): GenerationModelDto {
  return {
    key: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'OpenAI',
    providerKey: 'openai',
    modelId: 'gpt-image-2',
    state: 'READY',
    availabilityReason: null,
    releaseStage: 'STABLE',
    internal: false,
    maxReferenceImages: 4,
    capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE'] as GenerationModelCapability[],
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
    ...overrides,
  };
}

const base = { prompt: 'a portrait', models: [model()], selectedModelKeys: ['gpt-image-2'], referenceCount: 0 };

describe('generationReadiness', () => {
  it('allows a run when the prompt, model and references all fit', () => {
    expect(generationReadiness({ ...base, referenceCount: 3 })).toMatchObject({ ready: true, reason: null });
  });

  it('reports an empty prompt before anything else', () => {
    expect(generationReadiness({ ...base, prompt: '   ', selectedModelKeys: [] }).reason).toBe('PROMPT_EMPTY');
  });

  it('reports a missing model selection', () => {
    expect(generationReadiness({ ...base, selectedModelKeys: [] }).reason).toBe('NO_MODEL');
  });

  it('carries the model name and provider explanation for an unavailable model', () => {
    const readiness = generationReadiness({
      ...base,
      models: [model({ state: 'UNAVAILABLE', availabilityReason: 'Codex CLI not signed in' })],
    });
    expect(readiness).toMatchObject({
      ready: false,
      reason: 'MODEL_UNAVAILABLE',
      modelName: 'GPT Image 2',
      availabilityReason: 'Codex CLI not signed in',
    });
  });

  it('rejects a model that cannot generate images', () => {
    expect(generationReadiness({ ...base, models: [model({ capabilities: ['IMAGE_EDIT'] })] }).reason).toBe(
      'MODEL_CANNOT_GENERATE',
    );
  });

  it('separates unsupported references from unsupported multi-reference', () => {
    const noReferences = [model({ capabilities: ['GENERATE'] })];
    expect(generationReadiness({ ...base, models: noReferences, referenceCount: 1 }).reason).toBe(
      'REFERENCE_UNSUPPORTED',
    );

    const singleReference = [model({ capabilities: ['GENERATE', 'REFERENCE_IMAGE'] })];
    expect(generationReadiness({ ...base, models: singleReference, referenceCount: 1 }).ready).toBe(true);
    expect(generationReadiness({ ...base, models: singleReference, referenceCount: 2 }).reason).toBe(
      'MULTI_REFERENCE_UNSUPPORTED',
    );
  });

  it('reports the reference budget of the model that is over its limit', () => {
    expect(generationReadiness({ ...base, referenceCount: 5 })).toMatchObject({
      reason: 'TOO_MANY_REFERENCES',
      referenceLimit: 4,
    });
  });

  it('treats a null reference budget as unlimited', () => {
    expect(
      generationReadiness({ ...base, models: [model({ maxReferenceImages: null })], referenceCount: 40 }).ready,
    ).toBe(true);
  });

  it('blames the first failing model when several are selected', () => {
    const readiness = generationReadiness({
      prompt: 'a portrait',
      models: [model(), model({ key: 'other', name: 'Other model', state: 'UNAVAILABLE' })],
      selectedModelKeys: ['gpt-image-2', 'other'],
      referenceCount: 0,
    });
    expect(readiness).toMatchObject({ reason: 'MODEL_UNAVAILABLE', modelName: 'Other model' });
  });
});
