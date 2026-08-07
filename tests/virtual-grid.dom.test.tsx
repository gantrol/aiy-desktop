import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualGrid } from '../src/renderer/components/ui/virtual-grid';
import { renderComponent, screen, scrollElement, stubElementViewport } from './support/dom';

/**
 * Reference test for the component lane.
 *
 * Every assertion here is unreachable from `renderToStaticMarkup`: mounting a
 * window requires an effect, measuring a viewport requires a ref, and keyboard
 * navigation requires an event loop. The existing `virtual-grid.test.ts` covers
 * `getVirtualRange` in isolation and cannot tell whether the component ever
 * calls it — this file closes that seam.
 */
describe('VirtualGrid in a real DOM', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({ id: `row-${index}`, label: `Row ${index}` }));
  const columns = Array.from({ length: 20 }, (_, index) => ({ id: `col-${index}`, label: `Col ${index}` }));
  let restoreViewport: () => void;

  beforeEach(() => {
    restoreViewport = stubElementViewport({ width: 600, height: 400 });
  });

  afterEach(() => {
    restoreViewport();
  });

  type Row = (typeof rows)[number];
  type Column = (typeof columns)[number];
  type GridProps = Parameters<typeof VirtualGrid<Row, Column>>[0];

  function renderGrid(overrides: Partial<GridProps> = {}) {
    return renderComponent(
      <VirtualGrid
        rows={rows}
        columns={columns}
        getRowKey={(row) => row.id}
        getColumnKey={(column) => column.id}
        rowHeight={40}
        columnWidth={120}
        rowHeaderWidth={160}
        ariaLabel="Model settings"
        cornerHeader={<span>Model</span>}
        renderRowHeader={(row) => <span>{row.label}</span>}
        renderColumnHeader={(column) => <span>{column.label}</span>}
        renderCell={(row, column) => <span>{`${row.id}/${column.id}`}</span>}
        getCellLabel={(row, column) => `${row.label} ${column.label}`}
        {...overrides}
      />,
    );
  }

  it('mounts only the visible window, not all 4,000 cells', () => {
    renderGrid();

    const mounted = document.querySelectorAll('[data-virtual-grid-cell]');
    expect(mounted.length).toBeGreaterThan(0);
    // 200 rows x 20 columns. Anything close to that means virtualization is off.
    expect(mounted.length).toBeLessThan(200);
  });

  it('recycles rows as the viewport scrolls', () => {
    renderGrid();
    const grid = screen.getByRole('grid');

    expect(document.querySelector('[data-virtual-row="row-5"]')).not.toBeNull();
    expect(document.querySelector('[data-virtual-row="row-150"]')).toBeNull();

    scrollElement(grid, { top: 150 * 40 });

    expect(document.querySelector('[data-virtual-row="row-150"]')).not.toBeNull();
    expect(document.querySelector('[data-virtual-row="row-5"]')).toBeNull();
  });

  it('keeps the active row mounted after it scrolls out of view, so focus survives', () => {
    renderGrid({ defaultActiveCell: { rowKey: 'row-0', columnKey: 'col-0' } });
    const grid = screen.getByRole('grid');

    scrollElement(grid, { top: 150 * 40 });

    // Everything around the old viewport is recycled, but the focused row is
    // pinned: unmounting it would destroy focus mid-scroll.
    expect(document.querySelector('[data-virtual-row="row-5"]')).toBeNull();
    expect(document.querySelector('[data-virtual-grid-cell="row-0:col-0"]')).toHaveAttribute('data-active', 'true');
  });

  it('moves the active cell with the keyboard and reports each move', async () => {
    const onActiveCellChange = vi.fn();
    const { user } = renderGrid({
      defaultActiveCell: { rowKey: 'row-0', columnKey: 'col-0' },
      onActiveCellChange,
    });

    const grid = screen.getByRole('grid');
    grid.focus();
    await user.keyboard('{ArrowDown}{ArrowRight}');

    expect(onActiveCellChange).toHaveBeenLastCalledWith({ rowKey: 'row-1', columnKey: 'col-1' });
    expect(document.querySelector('[data-virtual-grid-cell="row-1:col-1"]')).toHaveAttribute('data-active', 'true');
  });

  it('jumps to the last cell with Control+End and scrolls it into the window', async () => {
    const { user } = renderGrid({ defaultActiveCell: { rowKey: 'row-0', columnKey: 'col-0' } });

    const grid = screen.getByRole('grid');
    grid.focus();
    await user.keyboard('{Control>}{End}{/Control}');

    expect(document.querySelector('[data-virtual-grid-cell="row-199:col-19"]')).not.toBeNull();
  });

  it('activates the cell a pointer selected when Enter is pressed', async () => {
    const onActivateCell = vi.fn();
    const { user } = renderGrid({ onActivateCell });

    // Pointer-down selects the cell and returns focus to the grid container;
    // activation is a separate, deliberate keystroke.
    await user.click(screen.getByLabelText('Row 1 Col 1'));
    await user.keyboard('{Enter}');

    expect(onActivateCell).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1' }),
      expect.objectContaining({ id: 'col-1' }),
      { rowKey: 'row-1', columnKey: 'col-1' },
    );
  });

  it('renders an empty grid without throwing', () => {
    renderGrid({ rows: [], columns: [] });

    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-virtual-grid-cell]')).toHaveLength(0);
  });
});
