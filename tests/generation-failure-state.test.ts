import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GenerationFailureState } from '../src/renderer/components/creator/GenerationFailureState';

describe('generation failure state', () => {
  it('keeps the actual reason and retry action together in the failed cell', () => {
    const markup = renderToStaticMarkup(
      createElement(GenerationFailureState, {
        message: 'Provider quota exceeded',
        retryLabel: 'Retry',
        disabled: false,
        onRetry: () => undefined,
      }),
    );

    expect(markup).toContain('data-generation-failure');
    expect(markup).toContain('data-variant="error"');
    expect(markup).toContain('Provider quota exceeded');
    expect(markup).toContain('Retry');
    expect(markup).toContain('<button');
  });
});
