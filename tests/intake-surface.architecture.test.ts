import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlobalDropOverlay } from '../src/renderer/features/intake/GlobalDropOverlay';
import { IntakeSurface } from '../src/renderer/features/intake/IntakeSurface';

const intakeRoot = path.resolve(__dirname, '../src/renderer/features/intake');

function readIntakeFile(name: string) {
  return fs.readFileSync(path.join(intakeRoot, name), 'utf8');
}

describe('shared intake surfaces', () => {
  it('makes the page-level paste target named and keyboard reachable', () => {
    const markup = renderToStaticMarkup(
      React.createElement(IntakeSurface, {
        accessibleName: 'Paste or drop',
        children: React.createElement('span', null, 'content'),
      }),
    );

    expect(markup).toContain('data-slot="intake-surface"');
    expect(markup).toContain('aria-label="Paste or drop"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('focus-visible:ring-2');
    expect(markup).toContain('focus-visible:ring-inset');
    expect(markup).toContain('focus-visible:ring-ring');
  });

  it('announces only an active, supported drop target', () => {
    expect(
      renderToStaticMarkup(
        React.createElement(GlobalDropOverlay, {
          active: false,
          label: 'Paste or drop',
        }),
      ),
    ).toBe('');

    const markup = renderToStaticMarkup(
      React.createElement(GlobalDropOverlay, {
        active: true,
        label: 'Paste or drop',
      }),
    );
    expect(markup).toContain('data-slot="global-drop-overlay"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('Paste or drop');
    expect(markup).toContain('bg-overlay');
    expect(markup).toContain('shadow-overlay');
  });

  it('keeps the start screen and gallery adapter on the shared components', () => {
    for (const name of ['LibraryStartScreen.tsx', 'GalleryIntakeAdapter.tsx']) {
      const source = readIntakeFile(name);
      expect(source, name).toContain('<IntakeSurface');
      expect(source, name).toContain('<GlobalDropOverlay');
      expect(source, name).not.toContain('state.dragActive && <div');
    }
  });
});
