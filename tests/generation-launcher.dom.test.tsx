import { describe, expect, it, vi } from 'vitest';
import type { GenerationModelDto } from '../src/shared/contracts';
import { GenerationLauncher } from '../src/renderer/components/creator/GenerationLauncher';
import type { GenerationReadiness } from '../src/renderer/components/creator/generationReadiness';
import { renderComponent, screen } from './support/dom';

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
  return renderComponent(
    <GenerationLauncher
      locale="en"
      models={[model('gpt-image-2', 'GPT Image 2')]}
      generationTargets={[{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }]}
      generationCount={1}
      readiness={ready}
      starting={false}
      onGenerationTargetsChange={vi.fn()}
      onGenerate={vi.fn()}
      {...overrides}
    />,
    { locale: 'en' },
  );
}

describe('GenerationLauncher in a real DOM', () => {
  it('dispatches the primary action and exposes the selected model accessibly', async () => {
    const onGenerate = vi.fn();
    const { user } = renderLauncher({ onGenerate });

    expect(screen.getByRole('button', { name: 'Models: GPT Image 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Generate$/ }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('opens the settings table through the real state transition', async () => {
    const { user } = renderLauncher();
    const settings = screen.getByRole('button', { name: 'Model parameters' });

    expect(document.querySelector('[data-generation-model-table]')).toBeNull();
    expect(settings).toHaveAttribute('aria-expanded', 'false');

    await user.click(settings);

    expect(document.querySelector('[data-generation-model-table]')).not.toBeNull();
    expect(settings).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps generation disabled and explains exceptional model failures', () => {
    renderLauncher({
      readiness: {
        ...ready,
        ready: false,
        reason: 'MODEL_UNAVAILABLE',
        modelName: 'GPT Image 2',
        availabilityReason: 'API key missing',
      },
    });

    const generate = screen.getByRole('button', { name: /Generate$/ });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('status')).toHaveTextContent('GPT Image 2 is not connected: API key missing');
  });

  it('marks the synchronous handoff as busy and disabled', () => {
    renderLauncher({ starting: true });

    const button = screen.getByRole('button', { name: 'Submitting' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
