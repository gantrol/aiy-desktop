import { describe, expect, it, vi } from 'vitest';
import { GenerationFailureState } from '../src/renderer/components/creator/GenerationFailureState';
import { renderComponent, screen } from './support/dom';

describe('GenerationFailureState in a real DOM', () => {
  it('keeps the error message and invokes retry from the rendered button', async () => {
    const onRetry = vi.fn();
    const { user } = renderComponent(
      <GenerationFailureState
        message="Provider quota exceeded"
        retryLabel="Retry"
        disabled={false}
        onRetry={onRetry}
      />,
      { locale: 'en' },
    );

    expect(document.querySelector('[data-generation-failure]')).toHaveTextContent('Provider quota exceeded');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch retry while disabled', async () => {
    const onRetry = vi.fn();
    const { user } = renderComponent(
      <GenerationFailureState message="Provider quota exceeded" retryLabel="Retry" disabled onRetry={onRetry} />,
      { locale: 'en' },
    );

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeDisabled();
    await user.click(retry);

    expect(onRetry).not.toHaveBeenCalled();
  });
});
