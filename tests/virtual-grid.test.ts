import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  getNextVirtualGridCell,
  getRestoredVirtualGridScroll,
  getVirtualRange,
  encodeVirtualGridDomKey,
  VirtualGrid,
} from '../src/renderer/components/ui/virtual-grid';

describe('VirtualGrid range projection', () => {
  it('projects only the visible window plus overscan', () => {
    expect(getVirtualRange(100, 100, 0, 250, 1)).toEqual({ start: 0, end: 3 });
    expect(getVirtualRange(100, 100, 500, 300, 1)).toEqual({ start: 4, end: 8 });
    expect(getVirtualRange(100, 100, 9_500, 600, 1)).toEqual({ start: 94, end: 99 });
  });

  it('clamps empty, single-item, and unmeasured viewports', () => {
    expect(getVirtualRange(0, 100, 0, 300, 1)).toEqual({ start: 0, end: -1 });
    expect(getVirtualRange(1, 100, 5_000, 300, 2)).toEqual({ start: 0, end: 0 });
    expect(getVirtualRange(20, 100, 0, 0, 2)).toEqual({ start: 0, end: 2 });
  });
});

describe('VirtualGrid keyboard navigation', () => {
  it('moves by logical row and column without depending on mounted DOM order', () => {
    expect(getNextVirtualGridCell({ rowIndex: 4, columnIndex: 3 }, 10, 8, 'ArrowDown')).toEqual({
      rowIndex: 5,
      columnIndex: 3,
    });
    expect(getNextVirtualGridCell({ rowIndex: 4, columnIndex: 3 }, 10, 8, 'ArrowLeft')).toEqual({
      rowIndex: 4,
      columnIndex: 2,
    });
    expect(getNextVirtualGridCell({ rowIndex: 0, columnIndex: 0 }, 10, 8, 'ArrowUp')).toEqual({
      rowIndex: 0,
      columnIndex: 0,
    });
    expect(getNextVirtualGridCell({ rowIndex: 4, columnIndex: 3 }, 10, 8, 'Home')).toEqual({
      rowIndex: 4,
      columnIndex: 0,
    });
    expect(getNextVirtualGridCell({ rowIndex: 4, columnIndex: 3 }, 10, 8, 'End')).toEqual({
      rowIndex: 4,
      columnIndex: 7,
    });
    expect(getNextVirtualGridCell({ rowIndex: 4, columnIndex: 3 }, 10, 8, 'Home', true)).toEqual({
      rowIndex: 0,
      columnIndex: 0,
    });
    expect(getNextVirtualGridCell({ rowIndex: 4, columnIndex: 3 }, 10, 8, 'End', true)).toEqual({
      rowIndex: 9,
      columnIndex: 7,
    });
    expect(getNextVirtualGridCell({ rowIndex: 4, columnIndex: 3 }, 10, 8, 'Enter')).toBeNull();
  });
});

describe('VirtualGrid logical anchor restoration', () => {
  const anchor = { rowOffset: 12, columnOffset: 7 };

  it('restores each axis independently when the other key disappeared', () => {
    expect(getRestoredVirtualGridScroll(anchor, 4, -1, 240, 288, { top: 20, left: 900 })).toEqual({
      top: 972,
      left: 900,
    });
    expect(getRestoredVirtualGridScroll(anchor, -1, 3, 240, 288, { top: 720, left: 10 })).toEqual({
      top: 720,
      left: 871,
    });
  });

  it('restores both axes when both logical keys remain', () => {
    expect(getRestoredVirtualGridScroll(anchor, 2, 5, 240, 288, { top: 0, left: 0 })).toEqual({
      top: 492,
      left: 1_447,
    });
  });
});

describe('VirtualGrid stable DOM identity', () => {
  it('encodes keys and tuples without separator collisions', () => {
    expect(encodeVirtualGridDomKey('/')).not.toBe(encodeVirtualGridDomKey('_2F'));
    const left = `${encodeVirtualGridDomKey('a-b')}-${encodeVirtualGridDomKey('c')}`;
    const right = `${encodeVirtualGridDomKey('a')}-${encodeVirtualGridDomKey('b-c')}`;
    expect(left).not.toBe(right);
  });
});

describe('VirtualGrid semantic contract', () => {
  it('renders a bounded ARIA grid and pins the stable active cell', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ key: `row-${index}` }));
    const columns = Array.from({ length: 40 }, (_, index) => ({ key: `column-${index}` }));
    const html = renderToStaticMarkup(
      React.createElement(VirtualGrid<{ key: string }, { key: string }>, {
        rows,
        columns,
        getRowKey: (row) => row.key,
        getColumnKey: (column) => column.key,
        rowHeight: 240,
        columnWidth: 288,
        rowHeaderWidth: 320,
        ariaLabel: 'Comparison matrix',
        cornerHeader: 'Prompt',
        activeCell: { rowKey: 'row-50', columnKey: 'column-20' },
        renderRowHeader: (row) => row.key,
        renderColumnHeader: (column) => column.key,
        renderCell: (row, column) => `${row.key}/${column.key}`,
        getCellLabel: (row, column) => `${row.key} / ${column.key}`,
        onActivateCell: vi.fn(),
      }),
    );

    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-rowcount="101"');
    expect(html).toContain('aria-colcount="41"');
    expect(html).toContain('data-virtual-grid-cell="row-50:column-20"');
    expect(html).toContain('aria-label="row-50 / column-20"');
    expect(html).toContain('aria-activedescendant=');
    expect(html.match(/role="gridcell"/g) ?? []).toHaveLength(7);
    expect(html).not.toContain('row-50/column-20');
    expect(html).not.toContain('row-99/column-39');
  });
});
