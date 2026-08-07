import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GenerationModelDto } from '../src/shared/contracts';
import { GenerationLauncher } from '../src/renderer/components/creator/GenerationLauncher';
import type { GenerationReadiness } from '../src/renderer/components/creator/generationReadiness';
import { I18nContext } from '../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './support/i18n';

function model(key: string, name: string): GenerationModelDto {
  return {
    key,
    name,
    provider: 'OpenAI',
    providerKey: 'openai',
    modelId: key,
    state: 'READY',
    availabilityReason: null,
    releaseStage: 'STABLE',
    internal: false,
    maxReferenceImages: 4,
    capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE'],
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
  };
}

const ready: GenerationReadiness = {
  ready: true,
  reason: null,
  modelName: '',
  referenceLimit: 0,
  availabilityReason: '',
};

function renderLauncher(overrides: Partial<Parameters<typeof GenerationLauncher>[0]> = {}) {
  const locale = overrides.locale ?? 'en';
  const props: Parameters<typeof GenerationLauncher>[0] = {
    locale,
    models: [model('gpt-image-2', 'GPT Image 2')],
    generationTargets: [{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }],
    generationCount: 1,
    readiness: ready,
    starting: false,
    onGenerationTargetsChange: () => undefined,
    onGenerate: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      {
        value: testI18nValue(locale),
      },
      createElement(GenerationLauncher, props),
    ),
  );
}

describe('minimal generation launcher', () => {
  it('keeps the model selector and primary generate action visible in the main row', () => {
    const markup = renderLauncher();
    expect(markup).toContain('data-generation-launcher="minimal"');
    expect(markup).toContain('data-generation-model-summary');
    expect(markup).toContain('Models:');
    expect(markup).toContain('GPT Image 2');
    expect(markup).toContain('data-action="generation-settings"');
    expect(markup).toContain('data-action="generate"');
    expect(markup).toContain('bg-generation-action');
    expect(markup).toContain('text-generation-action-foreground');
    expect(markup).not.toContain('bg-foreground');
    expect(markup).toContain('aria-label="Models: GPT Image 2"');
    expect(markup.indexOf('data-action="generation-settings"')).toBeLessThan(
      markup.indexOf('data-generation-model-label'),
    );
  });

  it('lists every selected model by name instead of using a numeric suffix', () => {
    const markup = renderLauncher({
      models: [model('gpt-image-2', 'GPT Image 2'), model('second', 'Second Model')],
      generationTargets: [
        { modelKey: 'gpt-image-2', count: 1, quality: 'high' },
        { modelKey: 'second', count: 3, quality: 'low' },
      ],
      generationCount: 4,
    });
    expect(markup).toContain('GPT Image 2 + Second Model');
    expect(markup).not.toContain('GPT Image 2 +1');
    expect(markup).toContain('Generate 4');
  });

  it('keeps routine incomplete states quiet', () => {
    const markup = renderLauncher({
      generationTargets: [],
      generationCount: 0,
      readiness: { ...ready, ready: false, reason: 'NO_MODEL' },
    });
    expect(markup).toContain('No model selected');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('aria-describedby=');
    expect(markup).not.toContain('data-generation-blocked="true"');
    expect(markup).not.toContain('Choose at least one model.');
  });

  it('still explains exceptional model failures', () => {
    const markup = renderLauncher({
      readiness: {
        ...ready,
        ready: false,
        reason: 'MODEL_UNAVAILABLE',
        modelName: 'GPT Image 2',
        availabilityReason: 'API key missing',
      },
    });
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('data-generation-blocked="true"');
    expect(markup).toContain('GPT Image 2 is not connected: API key missing');
  });

  it('labels the synchronous handoff as submitting instead of pretending the model is already generating', () => {
    const markup = renderLauncher({ starting: true });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Submitting');
    expect(markup).toContain('lucide-loader-circle');
    expect(markup).toContain('animate-spin');
    expect(markup.toLowerCase()).not.toContain('spark');
  });
});
