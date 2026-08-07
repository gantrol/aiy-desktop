import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../src/renderer/features/packs/PackScreen.tsx'), 'utf8');

describe('PackScreen', () => {
  it('keeps discovery, installation and space lifecycle on explicit APIs', () => {
    expect(source).toContain('packsList()');
    expect(source).toContain('packReleaseGet(selectedRelease.id)');
    expect(source).toContain('packInstallExact({');
    expect(source).toContain('packSetDisabled(');
    expect(source).toContain('packRemove(');
  });

  it('does not collapse a pack into the current local-space identity', () => {
    expect(source).not.toMatch(/currentPack|switchPack|activePack/);
    expect(source).toContain('selectedReleaseId');
    expect(source).toContain('itemCount');
    expect(source).toContain('dependencyCount');
  });

  it('renders facts and operations without instructional or welcome copy', () => {
    expect(source).not.toMatch(/help|tip|hint|welcome|learn more/i);
    expect(source).toContain('item.itemKey');
    expect(source).toContain('dependency.versionRange');
  });
});
