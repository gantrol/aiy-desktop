import { describe, expect, it, vi } from 'vitest';
import { IntakeActionBar } from '../src/renderer/features/intake/IntakeActionBar';
import { renderComponent, screen } from './support/dom';

function renderBar(overrides: Partial<Parameters<typeof IntakeActionBar>[0]> = {}) {
  return renderComponent(
    <IntakeActionBar
      defaultIntent="START_CREATION"
      pendingIntent={null}
      favorite={false}
      onFavoriteChange={vi.fn()}
      onStartCreation={vi.fn()}
      onImport={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
    { locale: 'en' },
  );
}

describe('IntakeActionBar in a real DOM', () => {
  it('dispatches each action to its own callback', async () => {
    const onStartCreation = vi.fn();
    const onImport = vi.fn();
    const onCancel = vi.fn();
    const { user } = renderBar({ onStartCreation, onImport, onCancel });

    await user.click(screen.getByRole('button', { name: 'Start creation' }));
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onStartCreation).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('offers favoriting as a modifier instead of a competing commit action', async () => {
    const onFavoriteChange = vi.fn();
    const onImport = vi.fn();
    const { user } = renderBar({ onFavoriteChange, onImport });

    await user.click(screen.getByRole('checkbox', { name: 'Favorite' }));

    expect(onFavoriteChange).toHaveBeenCalledWith(true);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('disables every action while the selected intent is pending', () => {
    renderBar({ pendingIntent: 'IMPORT' });

    expect(screen.getByRole('button', { name: 'Start creation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
