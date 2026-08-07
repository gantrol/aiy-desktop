import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GenerationModelDto } from '../src/shared/contracts';
import { ModelGenerationSettingsTable } from '../src/renderer/components/creator/ModelGenerationSettingsTable';
import { I18nContext } from '../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './support/i18n';

const models: GenerationModelDto[] = ['GPT Image 2', 'Studio Model'].map((name, index): GenerationModelDto => ({
  key: index ? 'studio-model' : 'gpt-image-2',
  name,
  provider: index ? 'Local' : 'OpenAI',
  providerKey: index ? 'local' : 'openai',
  modelId: name,
  state: 'READY',
  availabilityReason: null,
  releaseStage: 'STABLE',
  internal: Boolean(index),
  maxReferenceImages: 4,
  capabilities: ['GENERATE'],
  qualityMode: index ? 'PROVIDER_MANAGED' : 'SELECTABLE',
  supportedQualities: index ? [] : ['low', 'medium', 'high'],
}));

describe('model generation settings table', () => {
  it('renders one semantic table row with independent parameters for every model', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        {
          value: testI18nValue('en'),
        },
        createElement(ModelGenerationSettingsTable, {
          locale: 'en',
          models,
          targets: [
            { modelKey: 'gpt-image-2', count: 2, quality: 'high' },
            { modelKey: 'studio-model', count: 1, quality: 'low' },
          ],
          onTargetsChange: () => undefined,
        }),
      ),
    );

    expect(markup).toContain('<table');
    expect(markup).toContain('<th');
    expect(markup).toContain('GPT Image 2');
    expect(markup).toContain('Studio Model');
    expect(markup).toContain('aria-label="GPT Image 2 image count"');
    expect(markup).not.toContain('aria-label="Studio Model quality"');
    expect(markup).toContain('N/A');
    expect(markup).toContain('value="2"');
    expect(markup).toContain('value="1"');
    expect(markup).toContain('title="GPT Image 2 · OpenAI"');
    const heads = markup.match(/<th\b[^>]*>/g) ?? [];
    const cells = markup.match(/<td\b[^>]*>/g) ?? [];
    expect(heads[0]).not.toContain('tabular-nums');
    expect(heads[1]).toContain('text-center');
    expect(heads[1]).toContain('tabular-nums');
    expect(heads[2]).not.toContain('tabular-nums');
    expect(heads[2]).toContain('text-center');
    expect(cells[1]).toContain('text-center');
    expect(cells[1]).toContain('tabular-nums');
    expect(cells[4]).toContain('text-center');
    expect(cells[4]).toContain('tabular-nums');
    expect(markup).not.toContain('aria-label="Models:');
    expect(markup).not.toContain('Model parameters');
    expect(markup).not.toContain('Studio Model · Local');
  });
});
