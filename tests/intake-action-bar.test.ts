import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IntakeActionBar } from '../src/renderer/features/intake/IntakeActionBar';
import { I18nContext } from '../src/renderer/i18n/I18nProvider';
import { testI18nValue } from './support/i18n';

function render(defaultIntent: 'IMPORT' | 'START_CREATION', albumName?: string) {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      {
        value: testI18nValue('en'),
      },
      createElement(IntakeActionBar, {
        defaultIntent,
        pendingIntent: null,
        favorite: false,
        albumName,
        onFavoriteChange: () => undefined,
        onStartCreation: () => undefined,
        onImport: () => undefined,
        onCancel: () => undefined,
      }),
    ),
  );
}

describe('intake action bar', () => {
  it('makes Import the primary and final action in gallery context', () => {
    const markup = render('IMPORT');
    const createIndex = markup.indexOf('Start creation');
    const importIndex = markup.lastIndexOf('Import');
    expect(createIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(createIndex);
    expect(markup.slice(markup.lastIndexOf('<button', importIndex), importIndex)).toContain('bg-primary');
  });

  it('keeps Start creation primary in new-work context', () => {
    const markup = render('START_CREATION');
    const createIndex = markup.indexOf('Start creation');
    expect(markup.slice(markup.lastIndexOf('<button', createIndex), createIndex)).toContain('bg-primary');
  });

  it('names the receiving album so an import is never a silent relocation', () => {
    expect(render('IMPORT', 'Summer looks')).toContain('Import to Summer looks');
  });
});
