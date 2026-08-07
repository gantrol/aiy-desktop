import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StartActionBar } from '../src/renderer/features/intake/StartActionBar';

describe('empty-library start actions', () => {
  it('keeps every start action equal weight beside the paste surface', () => {
    const markup = renderToStaticMarkup(
      createElement(StartActionBar, {
        chooseLabel: 'Choose images',
        contentPackLabel: 'Import content pack',
        openLabel: 'Open library',
        openingLibrary: false,
        onChooseImages: () => undefined,
        onImportContentPack: () => undefined,
        onOpenLibrary: () => undefined,
      }),
    );

    expect(markup).toContain('data-slot="start-action-bar"');
    expect(markup.match(/<button/g)).toHaveLength(3);
    expect(markup.match(/border-input/g)).toHaveLength(3);
    expect(markup).toContain('Choose images');
    expect(markup).toContain('Import content pack');
    expect(markup).toContain('Open library');
  });

  it('routes the idle-screen file picker through the shared intake controller', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/features/intake/LibraryStartScreen.tsx'),
      'utf8',
    );
    expect(source).toContain('<StartActionBar');
    // The picker lives in StartActionBar; the screen only forwards to intake.
    expect(source).not.toContain('type="file"');
    expect(source).toContain('onChooseImages={controller.addFiles}');
  });
});
