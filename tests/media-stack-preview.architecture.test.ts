import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  path.resolve(__dirname, '../src/renderer/components/media/MediaStackPreview.tsx'),
  'utf8',
);
const baseStyles = readFileSync(path.resolve(__dirname, '../src/renderer/styles/base.css'), 'utf8');

describe('media stack preview architecture', () => {
  it('keeps one controlled spread path and the reduced-motion override', () => {
    expect(componentSource).toContain("controlledSpread ?? (expanded ? 'expanded' : 'collapsed')");
    expect(componentSource).toContain("spread === 'settled'");
    expect(baseStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition:\s*none\s*!important/);
  });
});
