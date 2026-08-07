import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VirtualTable } from '../src/renderer/components/ui/virtual-table';
import { sourceImportsModule } from './support/source-ast';

describe('VirtualTable one-dimensional adapter', () => {
  it('reuses VirtualGrid while exposing one logical, accessible table column', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ key: `row-${index}`, label: `Item ${index}` }));
    const html = renderToStaticMarkup(
      React.createElement(VirtualTable<(typeof rows)[number]>, {
        rows,
        getRowKey: (row) => row.key,
        getRowLabel: (row) => row.label,
        rowHeight: 36,
        columnWidth: 480,
        ariaLabel: 'Queued jobs',
        header: 'Job',
        activeRowKey: 'row-50',
        renderRow: (row) => row.label,
      }),
    );

    expect(html).toContain('data-slot="virtual-table"');
    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-label="Queued jobs"');
    expect(html).toContain('aria-rowcount="101"');
    expect(html).toContain('aria-colcount="1"');
    expect(html).not.toContain('role="rowheader"');
    expect(html).toContain('data-virtual-grid-cell="row-50:__virtual-table-row__"');
    expect(html).toContain('aria-label="Item 50"');
    expect(html).not.toContain('>Item 50<');

    const source = fs.readFileSync(path.resolve(__dirname, '../src/renderer/components/ui/virtual-table.tsx'), 'utf8');
    expect(sourceImportsModule(source, '@/renderer/components/ui/virtual-grid')).toBe(true);
    expect(source).toContain('<VirtualGrid');
    expect(source).not.toContain('ResizeObserver');
    expect(source).not.toContain('getVirtualRange');
  });
});
