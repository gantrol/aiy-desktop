import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural guarantee that a test run costs nothing.
 *
 * The runtime circuit breaker in `tests/support/network-guard.ts` blocks paid
 * traffic; this asserts the arrangement that makes the breaker sufficient — that
 * no lane can discover the paid script, and that no suite hard-codes a provider
 * endpoint where a stub URL belongs.
 */
const desktopRoot = path.resolve(__dirname, '..');

function readConfig(name: string) {
  return readFileSync(path.join(desktopRoot, name), 'utf8');
}

const vitestConfigs = readdirSync(desktopRoot).filter((entry) => /^vitest\..*\.ts$/.test(entry));

describe('paid provider isolation', () => {
  it('has the paid acceptance script outside every runner glob', () => {
    for (const config of vitestConfigs) {
      const source = readConfig(config);
      expect(source, config).not.toMatch(/scripts\//);
      expect(source, config).not.toMatch(/\*\*\/\*\.mjs/);
    }
    expect(readConfig('playwright.config.ts')).toContain("testMatch: '**/*.e2e.ts'");
  });

  it('gates the paid script behind two independent confirmations', () => {
    const script = readFileSync(path.join(desktopRoot, 'scripts/manual-openai-image-acceptance.mjs'), 'utf8');
    expect(script).toContain("OPENAI_LIVE_TEST !== '1'");
    expect(script).toContain('--confirm-paid');
    expect(script).toMatch(/requests:\s*1/);
    expect(script).toMatch(/quality:\s*'low'/);
    expect(script).toMatch(/partialImages:\s*0/);
    expect(script).toMatch(/retries:\s*0/);
  });

  it('installs the network guard in every lane', () => {
    expect(readConfig('vitest.shared.ts')).toContain('tests/support/network-guard.ts');
    for (const config of vitestConfigs.filter((entry) => entry !== 'vitest.shared.ts')) {
      // Every lane builds on the shared factory, so none can opt out.
      expect(readConfig(config), config).toContain('createVitestConfig');
    }
  });

  it('keeps provider endpoints out of the test suites', () => {
    const testFiles = readdirSync(path.join(desktopRoot, 'tests')).filter(
      (entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'),
    );
    for (const file of testFiles) {
      const source = readFileSync(path.join(desktopRoot, 'tests', file), 'utf8');
      const hardCoded =
        source.match(
          /https:\/\/(api\.openai\.com|api\.deepseek\.com|generativelanguage\.googleapis\.com|dashscope\.aliyuncs\.com)[^\s'"`]*/g,
        ) ?? [];
      // The guard's own test names these hosts on purpose, to prove they are blocked.
      if (file === 'network-guard.test.ts') continue;
      expect(hardCoded, file).toEqual([]);
    }
  });

  it('keeps the renderer from choosing a provider endpoint', () => {
    const adapter = readFileSync(
      path.join(desktopRoot, 'src/main/generation-models/openai-image/openai-image-adapter.ts'),
      'utf8',
    );
    // baseUrl is a main-process constructor parameter with a production default.
    // If it ever becomes part of a DTO or IPC payload, untrusted state could
    // redirect credentialed requests.
    expect(adapter).toContain('OPENAI_IMAGE_API_BASE_URL');
    expect(readFileSync(path.join(desktopRoot, 'src/shared/contracts.ts'), 'utf8')).not.toMatch(/baseUrl|baseURL/);
  });
});
