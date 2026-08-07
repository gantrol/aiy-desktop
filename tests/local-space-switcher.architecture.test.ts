import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/spaces/LocalSpaceSwitcher.tsx'),
  'utf8',
);

describe('LocalSpaceSwitcher', () => {
  it('uses the v0.3 local-space API and exposes only boundary operations', () => {
    expect(source).toContain('localSpacesList()');
    expect(source).toContain('localSpacesSwitch(space.id)');
    expect(source).toContain('localSpacesCreate(normalized)');
    expect(source).toContain('localSpacesOpen()');
    expect(source).not.toContain('librariesCreateFromTemplate');
    expect(source).not.toContain('social-media');
  });

  it('does not present a current content pack as the current space', () => {
    expect(source).toContain('data-action="local-space-switcher"');
    expect(source).not.toMatch(/currentPack|activePack|selectedPack/);
  });
});
