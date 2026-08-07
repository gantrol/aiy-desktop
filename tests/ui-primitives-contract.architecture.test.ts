import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '../src/renderer/components/ui/button';
import { TableCell, TableHead } from '../src/renderer/components/ui/table';

const uiRoot = path.resolve(__dirname, '../src/renderer/components/ui');

function readPrimitive(name: string): string {
  return fs.readFileSync(path.join(uiRoot, `${name}.tsx`), 'utf8');
}

describe('core UI primitive visual contracts', () => {
  it('uses an opaque two-pixel focus ring and two-pixel offset', () => {
    for (const name of ['button', 'segmented', 'checkbox', 'input', 'textarea', 'select']) {
      const source = readPrimitive(name);
      expect(source, name).toContain('focus-visible:ring-2');
      expect(source, name).toContain('focus-visible:ring-ring');
      expect(source, name).not.toMatch(/focus-visible:ring-ring\/[0-9]+/);
    }

    for (const name of ['button', 'segmented', 'checkbox', 'input', 'textarea', 'select']) {
      const source = readPrimitive(name);
      expect(source, name).toContain('focus-visible:ring-offset-2');
      expect(source, name).toContain('focus-visible:ring-offset-background');
    }
  });

  it('keeps persistent controls free of elevation', () => {
    for (const name of ['button', 'segmented', 'checkbox', 'input', 'textarea', 'table']) {
      expect(readPrimitive(name), name).not.toMatch(/(?:^|\s)shadow-(?:xs|sm|md|lg|xl|2xl)(?:\s|')/);
    }

    const select = readPrimitive('select');
    const trigger = select.slice(select.indexOf('function SelectTrigger'), select.indexOf('function SelectContent'));
    expect(trigger).not.toContain('shadow-');
    expect(select).toContain('shadow-overlay');
  });

  it('separates hover, pressed, selected, and disabled semantics', () => {
    expect(buttonVariants({ variant: 'ghost' })).toContain('hover:bg-hover');
    expect(buttonVariants({ variant: 'ghost' })).toContain('active:bg-pressed');
    expect(buttonVariants({ variant: 'default' })).toContain('hover:bg-primary-hover');
    expect(buttonVariants({ variant: 'default' })).toContain('disabled:text-disabled-foreground');

    const checkbox = readPrimitive('checkbox');
    expect(checkbox).toContain('data-[state=checked]:bg-selected-foreground');
    expect(checkbox).toContain('disabled:text-disabled-foreground');

    const segmented = readPrimitive('segmented');
    expect(segmented).toContain('data-[state=on]:bg-surface');
    expect(segmented).toContain('data-[state=on]:border-border');

    const select = readPrimitive('select');
    expect(select).toContain('data-[state=checked]:bg-selected');
    expect(select).toContain('data-[disabled]:text-disabled-foreground');
  });

  it('provides compact button sizes and dense numeric table rhythm', () => {
    expect(buttonVariants({ size: '2xs' })).toContain('h-6');
    expect(buttonVariants({ size: 'xs' })).toContain('h-7');

    const table = readPrimitive('table');
    expect(table).toContain('h-9');
    expect(table).toContain('tabular-nums');
    expect(table).toContain('data-[state=selected]:bg-selected');
  });

  it('applies numeric alignment only when a table column opts in', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        'table',
        null,
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            React.createElement(TableHead, null, 'Model'),
            React.createElement(TableHead, { numeric: true }, 'Count'),
          ),
        ),
        React.createElement(
          'tbody',
          null,
          React.createElement(
            'tr',
            null,
            React.createElement(TableCell, null, 'GPT Image'),
            React.createElement(TableCell, { numeric: true }, '12'),
          ),
        ),
      ),
    );
    const heads = markup.match(/<th\b[^>]*>/g) ?? [];
    const cells = markup.match(/<td\b[^>]*>/g) ?? [];

    expect(heads).toHaveLength(2);
    expect(heads[0]).not.toContain('tabular-nums');
    expect(heads[1]).toContain('text-right');
    expect(heads[1]).toContain('tabular-nums');
    expect(cells).toHaveLength(2);
    expect(cells[0]).not.toContain('tabular-nums');
    expect(cells[1]).toContain('text-right');
    expect(cells[1]).toContain('tabular-nums');
  });
});
