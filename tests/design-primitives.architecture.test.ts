import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '../src/renderer/components/ui/field';
import { MetaText } from '../src/renderer/components/ui/meta-text';
import { QuietEmpty } from '../src/renderer/components/ui/quiet-empty';
import { StateTag } from '../src/renderer/components/ui/state-tag';
import { StatusDot, type StatusDotVariant } from '../src/renderer/components/ui/status-dot';

const rendererRoot = path.resolve(__dirname, '../src/renderer');

function readRendererFile(relativePath: string) {
  return fs.readFileSync(path.join(rendererRoot, relativePath), 'utf8');
}

describe('semantic design primitives', () => {
  it('gives every status a label and a distinct non-color shape', () => {
    const variants: StatusDotVariant[] = ['pass', 'partial', 'fail', 'unrated', 'pending', 'error'];
    const shapes = variants.map((variant) => {
      const html = renderToStaticMarkup(React.createElement(StatusDot, { variant, label: `state-${variant}` }));
      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).toContain(`state-${variant}`);
      expect(html).toContain('sr-only');
      return html.match(/data-shape="([^"]+)"/)?.[1];
    });

    expect(new Set(shapes).size).toBe(variants.length);
    expect(readRendererFile('components/ui/status-dot.tsx')).not.toContain('animate-');
  });

  it('keeps state tags compact, literal, and flat across every tone', () => {
    for (const tone of ['neutral', 'locked', 'changed', 'success', 'warning', 'danger', 'info'] as const) {
      const html = renderToStaticMarkup(
        React.createElement(StateTag, {
          tone,
          icon: React.createElement(CheckIcon),
          children: 'State label',
        }),
      );
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toContain('rounded-sm');
      expect(html).toContain('text-2xs');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('State label');
      expect(html).not.toContain('shadow-');
    }
  });

  it('standardizes metadata typography and preserves semantic elements', () => {
    const html = renderToStaticMarkup(
      React.createElement(MetaText, {
        as: 'time',
        mono: true,
        dateTime: '2026-07-29',
        children: '2026-07-29',
      }),
    );
    expect(html).toContain('<time');
    expect(html).toContain('dateTime="2026-07-29"');
    expect(html).toContain('text-xs');
    expect(html).toContain('text-muted-foreground');
    expect(html).toContain('tabular-nums');
    expect(html).toContain('font-mono');
  });

  it('binds field labels, descriptions, and errors to the control', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Field,
        { id: 'quality', invalid: true },
        React.createElement(FieldLabel, null, 'Quality'),
        React.createElement(FieldControl, null, React.createElement('input', { type: 'text' })),
        React.createElement(FieldDescription, null, 'Choose one'),
        React.createElement(FieldError, null, 'Required'),
      ),
    );

    expect(html).toContain('for="quality"');
    expect(html).toContain('id="quality"');
    expect(html).toContain('aria-labelledby="quality-label"');
    expect(html).toContain('aria-describedby="quality-description quality-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="quality-description"');
    expect(html).toContain('id="quality-error"');
    expect(html).toContain('role="alert"');

    const withoutMessage = renderToStaticMarkup(
      React.createElement(
        Field,
        { id: 'plain' },
        React.createElement(FieldLabel, null, 'Plain field'),
        React.createElement(FieldControl, null, React.createElement('input', { type: 'text' })),
        React.createElement(FieldError, null, null),
      ),
    );
    expect(withoutMessage).not.toContain('aria-describedby');
    expect(withoutMessage).not.toContain('plain-error');
  });

  it('keeps quiet empty states limited to a title and executable action', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuietEmpty, {
        title: 'Nothing here',
        actionLabel: 'Create',
        onAction: () => undefined,
      }),
    );
    expect(html).toContain('Nothing here');
    expect(html).toContain('<button');
    expect(html).toContain('Create');
    expect(html).not.toContain('<svg');

    const source = readRendererFile('components/ui/quiet-empty.tsx');
    expect(source).not.toMatch(/\b(?:children|description|illustration|icon)\??\s*:/);

    if (false) {
      React.createElement(QuietEmpty, {
        title: 'Empty',
        actionLabel: 'Create',
        onAction: () => undefined,
        // @ts-expect-error QuietEmpty deliberately rejects description content.
        description: 'Extra copy',
      });
    }
  });

  it('uses the primitives in representative workbench states', () => {
    const taskTray = readRendererFile('components/creator/GenerationTaskTray.tsx');
    expect(taskTray).toContain('<StatusDot variant="pending"');
    expect(taskTray).toContain('<StatusDot variant="error"');
    expect(taskTray).not.toContain('animate-spin');

    const termEditor = readRendererFile('components/dictionary/TermEditor.tsx');
    expect(termEditor).toContain('<StateTag');
    expect(termEditor).toContain('<FieldControl>');

    const resultLibrary = readRendererFile('components/creator/ResultLibrary.tsx');
    expect(resultLibrary).toContain('<QuietEmpty');
    expect(resultLibrary).not.toContain('l.emptyHint');

    const inspector = readRendererFile('components/gallery/MaterialInspector.tsx');
    expect(inspector).toContain('<MetaText as="dd"');
  });

  it('keeps state-specific variants out of Badge', () => {
    const badge = readRendererFile('components/ui/badge.tsx');
    for (const state of ['draft', 'approved', 'archived', 'pending', 'error']) expect(badge).not.toContain(`${state}:`);
  });
});
