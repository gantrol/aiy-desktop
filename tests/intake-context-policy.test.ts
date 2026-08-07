import { describe, expect, it } from 'vitest';
import { intakeContextPolicy } from '../src/renderer/features/intake/intake-context-policy';

describe('intake context policy', () => {
  it('defaults gallery intake to a plain import and new-work intake to creation', () => {
    expect(intakeContextPolicy('GALLERY')).toEqual({
      defaultIntent: 'IMPORT',
      secondaryIntent: 'START_CREATION',
      defaultFavorite: false,
    });
    expect(intakeContextPolicy('LIBRARY_START')).toEqual({
      defaultIntent: 'START_CREATION',
      secondaryIntent: 'IMPORT',
      defaultFavorite: false,
    });
    expect(intakeContextPolicy('GLOBAL_NEW')).toEqual({
      defaultIntent: 'START_CREATION',
      secondaryIntent: 'IMPORT',
      defaultFavorite: false,
    });
  });

  it('never forces a favorite as the price of importing', () => {
    for (const context of ['GALLERY', 'LIBRARY_START', 'GLOBAL_NEW'] as const) {
      expect(intakeContextPolicy(context).defaultFavorite).toBe(false);
    }
  });
});
