import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function read(relativePath: string) {
  return fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8');
}

describe('material metadata editor actions', () => {
  it('keeps the save action in the inspector footer and submits the metadata form', () => {
    const editor = read('src/renderer/components/gallery/MaterialMetadataEditor.tsx');
    const inspector = read('src/renderer/components/gallery/MaterialInspector.tsx');

    expect(editor).toMatch(/<form\s+id=\{formId\}/);
    expect(editor).not.toContain('<Button');
    expect(inspector).toContain('form={metadataFormId}');
    expect(inspector).toContain("activeTab === 'details'");
    expect(inspector).toContain('metadataState.dirty');
    expect(inspector).toMatch(/<TabsContent\s+value="details"\s+forceMount\b/);
  });

  it('warns before closing a dirty inspector', () => {
    const inspector = read('src/renderer/components/gallery/MaterialInspector.tsx');

    expect(inspector).toContain('if (metadataState.dirty)');
    expect(inspector).toContain('<Dialog open={discardOpen}');
    expect(inspector).toContain('l.continueEditing');
    expect(inspector).toContain('l.discardChanges');
    expect(inspector).toContain('requestExit(() => onOpenResult');
    expect(inspector).toContain('requestExit(() => onOpenTerm');
    expect(inspector).toMatch(/requestExit\(\(\) => \{\s*onClose\(\);\s*onRemoveFavorite\(\);\s*\}\)/);
  });

  it('keeps ordinary primary actions neutral and reserves plum for generation', () => {
    const tokens = read('src/renderer/styles/tokens.css');
    const lightTheme = tokens.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const darkTheme = tokens.match(/\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(lightTheme).toContain('--primary: var(--sand-900);');
    expect(lightTheme).toContain('--primary-hover: var(--sand-950);');
    expect(lightTheme).toContain('--generation-action: var(--plum-600);');
    expect(darkTheme).toContain('--primary: var(--sand-50);');
    expect(darkTheme).toContain('--primary-foreground: var(--sand-950);');
    expect(darkTheme).toContain('--generation-action: var(--plum-200);');
  });
});
