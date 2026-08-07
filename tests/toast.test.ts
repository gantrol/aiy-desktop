import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastViewport } from '../src/renderer/components/ui/toast';

describe('ToastViewport', () => {
  it('renders the head of the queue as an accessible E3 notification', () => {
    const markup = renderToStaticMarkup(
      createElement(ToastViewport, {
        messages: [
          { id: 1, message: 'Saved' },
          { id: 2, message: 'Queued' },
        ],
        label: 'Notifications',
        closeLabel: 'Close',
        onDismiss: () => undefined,
      }),
    );

    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('shadow-overlay');
    expect(markup).toContain('bg-overlay');
    expect(markup).toContain('aria-label="Close"');
    expect(markup).toContain('Saved');
    expect(markup).not.toContain('Queued');
  });
});
