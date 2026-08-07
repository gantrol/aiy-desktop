import { describe, expect, it } from 'vitest';
import type { GenerationModelDto } from '../src/shared/contracts';
import { initialGenerationTargets } from '../src/renderer/components/creator/generationTargetDefaults';

function model(key: string, internal: boolean, state: GenerationModelDto['state'] = 'READY'): GenerationModelDto {
  return {
    key,
    name: key,
    provider: internal ? 'Internal' : 'Codex',
    providerKey: internal ? 'internal' : 'codex',
    modelId: key,
    state,
    availabilityReason: null,
    releaseStage: internal ? 'INTERNAL' : 'STABLE',
    internal,
    maxReferenceImages: 8,
    capabilities: ['GENERATE'],
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
  };
}

describe('generation target defaults', () => {
  it('prefers a ready product model over an internal replay model', () => {
    expect(
      initialGenerationTargets({
        creationDraft: null,
        generationModels: [model('internal-library-random', true), model('gpt-image-2', false)],
      }),
    ).toEqual([{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }]);
  });

  it('falls back to an internal model only when no product model is ready', () => {
    expect(
      initialGenerationTargets({
        creationDraft: null,
        generationModels: [model('internal-library-random', true), model('gpt-image-2', false, 'UNAVAILABLE')],
      })[0]?.modelKey,
    ).toBe('internal-library-random');
  });
});
