import { describe, expect, it, vi } from 'vitest';
import { OutputVersionStrip } from '../src/renderer/components/creator/OutputVersionStrip';
import { makeVersionGroup } from './support/creation-output-fixtures';
import { renderComponent } from './support/dom';

/**
 * Replaces `output-version-strip.architecture.test.ts`, which asserted literal
 * JSX fragments (`'notify={notify} expanded/>'`) and exact class strings
 * (`'className="flex h-28'`). Those broke on a formatting change while proving
 * nothing about what renders — the failure that motivated this rewrite.
 *
 * The `data-output-*` attributes are the real contract, so they are asserted
 * against a rendered tree instead of against the source text.
 */
describe('OutputVersionStrip layout contract', () => {
  function renderStrip(overrides: Partial<Parameters<typeof OutputVersionStrip>[0]> = {}) {
    return renderComponent(
      <OutputVersionStrip
        groups={[makeVersionGroup('version-2', 2, ['asset-a', 'asset-b', 'asset-c'])]}
        selectedAssetId={null}
        locale="zh"
        onSelect={vi.fn()}
        onSetFailed={vi.fn().mockResolvedValue(undefined)}
        notify={vi.fn()}
        {...overrides}
      />,
    );
  }

  it('lays major-version outputs out expanded rather than stacked', () => {
    renderStrip();

    const stacks = document.querySelectorAll('[data-output-asset-stack]');
    expect(stacks.length).toBeGreaterThan(0);
    for (const stack of stacks) {
      expect(stack).toHaveAttribute('data-output-asset-layout', 'expanded');
    }
  });

  it('renders one thumbnail per output in the group', () => {
    renderStrip();

    for (const assetId of ['asset-a', 'asset-b', 'asset-c']) {
      expect(document.querySelector(`img[src="asset://${assetId}"], [data-asset-id="${assetId}"]`)).not.toBeNull();
    }
  });

  it('marks outputs as visible until they are reviewed as failed', () => {
    renderStrip();

    for (const stack of document.querySelectorAll('[data-output-asset-stack]')) {
      expect(stack).toHaveAttribute('data-output-disposition', 'visible');
    }
  });

  it('selects an output when its thumbnail is clicked', async () => {
    const onSelect = vi.fn();
    const { user } = renderStrip({ onSelect });

    const buttons = document.querySelectorAll('[data-output-asset-stack] button');
    expect(buttons.length).toBeGreaterThan(0);
    await user.click(buttons[0] as HTMLElement);

    expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/^asset-[abc]$/));
  });

  it('renders nothing but survives an empty group list', () => {
    renderStrip({ groups: [] });

    expect(document.querySelectorAll('[data-output-asset-stack]')).toHaveLength(0);
  });
});
