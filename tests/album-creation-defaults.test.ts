import { describe, expect, it } from 'vitest';
import {
  emptyAlbumCreationDefaults,
  normalizeAlbumCreationDefaults,
  parseAlbumCreationDefaults,
} from '../src/shared/album-creation-defaults';

describe('album creation defaults', () => {
  it('builds the canonical empty defaults', () => {
    expect(emptyAlbumCreationDefaults()).toEqual({
      schemaVersion: 1,
      recipes: [],
      dictionaryScope: {
        mode: 'ALL',
        sources: [],
        includeLocalTerms: true,
      },
    });
  });

  it('normalizes valid recipes and dictionary sources while removing duplicates', () => {
    expect(
      normalizeAlbumCreationDefaults({
        schemaVersion: 2,
        recipes: [
          {
            paletteId: 'palette-1',
            paletteRevisionId: 'palette-1-v1',
            parameterValues: { density: 'ornate', ignored: 42 },
            promptLocale: 'zh',
          },
          {
            paletteId: 'palette-1',
            paletteRevisionId: 'palette-1-v2',
            parameterValues: { density: 'flat' },
            promptLocale: 'fr',
          },
          { paletteId: 'invalid' },
        ],
        dictionaryScope: {
          mode: 'SELECTED',
          sources: [
            { packId: 'pack-1', packReleaseId: 'pack-1-v1' },
            { packId: 'pack-1', packReleaseId: 'pack-1-v2' },
            { packId: 'pack-2' },
          ],
          includeLocalTerms: false,
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      recipes: [
        {
          paletteId: 'palette-1',
          paletteRevisionId: 'palette-1-v1',
          parameterValues: { density: 'ornate' },
          promptLocale: 'zh',
        },
      ],
      dictionaryScope: {
        mode: 'SELECTED',
        sources: [{ packId: 'pack-1', packReleaseId: 'pack-1-v1' }],
        includeLocalTerms: false,
      },
    });
  });

  it('falls back to safe defaults for malformed objects', () => {
    expect(normalizeAlbumCreationDefaults(null)).toEqual(emptyAlbumCreationDefaults());
    expect(normalizeAlbumCreationDefaults({ dictionaryScope: { includeLocalTerms: false } })).toEqual({
      schemaVersion: 1,
      recipes: [],
      dictionaryScope: { mode: 'ALL', sources: [], includeLocalTerms: false },
    });
  });

  it('parses JSON and returns empty defaults when the input is invalid', () => {
    expect(
      parseAlbumCreationDefaults(
        JSON.stringify({
          recipes: [],
          dictionaryScope: { mode: 'SELECTED', sources: [], includeLocalTerms: true },
        }),
      ),
    ).toEqual({
      schemaVersion: 1,
      recipes: [],
      dictionaryScope: { mode: 'SELECTED', sources: [], includeLocalTerms: true },
    });
    expect(parseAlbumCreationDefaults('{not-json')).toEqual(emptyAlbumCreationDefaults());
  });
});
