import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GenerationModelDto } from '../src/shared/contracts';
import { ComparisonModelHeader } from '../src/renderer/components/creator/ComparisonModelHeader';

function model(overrides: Partial<GenerationModelDto> = {}): GenerationModelDto {
  return {
    key: 'image-model',
    name: 'Image Model',
    provider: 'Provider',
    providerKey: 'provider',
    modelId: 'image-model-v2',
    state: 'READY',
    availabilityReason: null,
    releaseStage: 'STABLE',
    internal: false,
    maxReferenceImages: 4,
    capabilities: ['GENERATE'],
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
    ...overrides,
  };
}

describe('comparison model header', () => {
  it('keeps provider and unavailable state visible without relying on color alone', () => {
    const markup = renderToStaticMarkup(
      createElement(ComparisonModelHeader, {
        model: model({ state: 'UNAVAILABLE', availabilityReason: 'Disconnected' }),
        name: 'Image Model',
        previewLabel: 'Preview',
        unavailableLabel: 'Unavailable',
      }),
    );

    expect(markup).toContain('Image Model');
    expect(markup).toContain('Provider');
    expect(markup).toContain('Unavailable');
    expect(markup).toContain('lucide-lock');
    expect(markup).toContain('data-tone="locked"');
  });
});
