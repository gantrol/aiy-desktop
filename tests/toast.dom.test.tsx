import { describe, expect, it, vi } from 'vitest';
import { ToastViewport } from '../src/renderer/components/ui/toast';
import { renderComponent, screen } from './support/dom';

describe('ToastViewport in a real DOM', () => {
  it('shows only the head of the queue and dismisses it through the close button', async () => {
    const onDismiss = vi.fn();
    const { user } = renderComponent(
      <ToastViewport
        messages={[
          { id: 1, message: 'Saved' },
          { id: 2, message: 'Queued' },
        ]}
        label="Notifications"
        closeLabel="Close"
        onDismiss={onDismiss}
        duration={60_000}
      />,
      { locale: 'en' },
    );

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.queryByText('Queued')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('forwards the automatic expiry to the owning queue', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      renderComponent(
        <ToastViewport
          messages={[{ id: 7, message: 'Temporary' }]}
          label="Notifications"
          closeLabel="Close"
          onDismiss={onDismiss}
          duration={1_000}
        />,
        { locale: 'en' },
      );

      vi.advanceTimersByTime(1_000);
      expect(onDismiss).toHaveBeenCalledWith(7);
    } finally {
      vi.useRealTimers();
    }
  });
});
