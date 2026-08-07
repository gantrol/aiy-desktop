import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('VirtualGrid architecture', () => {
  it('migrates the real comparison matrix and numeric rhythm', () => {
    const comparison = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/components/creator/GenerationComparison.tsx'),
      'utf8',
    );
    const primitive = fs.readFileSync(
      path.resolve(__dirname, '../src/renderer/components/ui/virtual-grid.tsx'),
      'utf8',
    );
    expect(comparison).toContain('<VirtualGrid');
    expect(comparison).not.toContain('<table');
    expect(comparison).toContain('font-mono tabular-nums');
    expect(comparison).toContain('captureAnchor()');
    expect(comparison).toContain('comparisonVersionGroupRowId(group)');
    expect(comparison).toContain('comparisonImportedPromptRowId(promptKey)');
    expect(comparison).toContain("run?.status === 'CANCELLED'");
    expect(comparison).toContain('data-comparison-toolbar className="flex min-h-11 shrink-0 flex-wrap');
    expect(comparison).not.toContain('LoaderCircleIcon');
    expect(primitive).toContain('role="grid"');
    expect(primitive).toContain('aria-activedescendant');
    expect(primitive).toContain('focus-visible:ring-2');
    expect(primitive).toContain("event.key === 'Enter'");
    expect(primitive).not.toContain('transition-transform');
  });
});
