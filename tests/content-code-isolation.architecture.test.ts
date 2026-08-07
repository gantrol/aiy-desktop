import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx|sql)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe('content and code isolation', () => {
  it('keeps production content out of source control and distributable resources', () => {
    expect(existsSync(path.join(projectRoot, 'resources', 'v0.3'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'content'))).toBe(false);
    expect(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')).not.toMatch(/resources[\\/]v0\.3/);
    const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('/resources/');
    expect(gitignore).toContain('/content/');
  });

  it('does not infer content package files or content identities in runtime code', () => {
    const migrationCompatibilityBoundary = path.join(
      projectRoot,
      'src',
      'main',
      'database',
      'sql',
      '0076-facet-system-roles.sql',
    );
    const runtime = sourceFiles(path.join(projectRoot, 'src'))
      .filter((filePath) => filePath !== migrationCompatibilityBoundary)
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(runtime).not.toContain('resources/v0.3');
    expect(runtime).not.toContain('dictionary-core.v0.3.json');
    expect(runtime).not.toContain('word-palettes.v0.3.json');
    expect(runtime).not.toContain('BUILTIN_FIXTURE');
    expect(runtime).not.toContain('builtin.human-portrait');
    expect(runtime).not.toContain('builtin.social-visual');
    expect(runtime).not.toContain('builtin.web-design');
    expect(runtime).not.toMatch(/stable_key\s*=\s*'domain'/);
    expect(runtime).not.toMatch(/stable_key\s*=\s*'item_type'/);
    expect(runtime).not.toMatch(/stableKey\s*===\s*['"]domain['"]/);
    expect(runtime).not.toMatch(/stableKey\s*===\s*['"]item_type['"]/);
  });

  it('keeps application startup free of content import and reconciliation', () => {
    const startup = readFileSync(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8');
    expect(startup).not.toMatch(/\.importFixture\s*\(/);
    expect(startup).not.toMatch(/\.importContentPack\s*\(/);
    expect(startup).not.toContain('reconcileDictionaryCore');
    expect(startup).not.toContain('reconcileFixture');
  });
});
