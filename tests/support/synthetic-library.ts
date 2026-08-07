import path from 'node:path';
import type { LibraryDatabase } from '../../src/main/database';
import { fixturePath } from './fixtures';

export const syntheticFixturePath = fixturePath('library/synthetic-workbench.v0.3.json');
export const syntheticDictionaryPath = fixturePath('library/synthetic-dictionary.v0.3.json');
export const syntheticPalettePath = fixturePath('library/synthetic-palettes.v0.3.json');
export const syntheticAssetsRoot = path.dirname(path.dirname(syntheticFixturePath));

export function importSyntheticLibrary(database: LibraryDatabase) {
  database.importFixture(syntheticFixturePath, {
    assetsRoot: syntheticAssetsRoot,
    dictionaryPath: syntheticDictionaryPath,
    palettePath: syntheticPalettePath,
    facetRoles: {
      PRIMARY_CLASSIFICATION: 'test_group',
      SECONDARY_CLASSIFICATION: 'test_kind',
    },
  });
}
