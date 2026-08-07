import { describe, expect, it } from 'vitest';
import { importedGenerationTextType } from '../src/renderer/components/creator/imageImport';

describe('imported image metadata', () => {
  it('uses prompt text only for confirmed AI-generated images', () => {
    expect(importedGenerationTextType('YES')).toBe('EXACT_PROMPT');
    expect(importedGenerationTextType('NO')).toBe('DESCRIPTION');
    expect(importedGenerationTextType('UNKNOWN')).toBe('DESCRIPTION');
  });
});
