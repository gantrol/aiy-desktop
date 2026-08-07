import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidateTokenCache, readCssToken, readCssTokens } from '../src/renderer/lib/tokens';

interface FakeRoot {
  dataset: { theme?: string };
}

afterEach(() => {
  invalidateTokenCache();
  vi.unstubAllGlobals();
});

function installTokenDocument(values: Record<string, string>) {
  const root: FakeRoot = { dataset: {} };
  const getPropertyValue = vi.fn((name: string) => values[name] ?? '');
  const getComputedStyleMock = vi.fn(() => ({ getPropertyValue }));
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('getComputedStyle', getComputedStyleMock);
  return { root, getComputedStyleMock, getPropertyValue };
}

describe('runtime design tokens', () => {
  it('reads lazily and caches computed values', () => {
    const { getComputedStyleMock, getPropertyValue } = installTokenDocument({ '--primary': 'computed-primary' });
    expect(readCssToken('--primary')).toBe('computed-primary');
    expect(readCssToken('--primary')).toBe('computed-primary');
    expect(getComputedStyleMock).toHaveBeenCalledTimes(1);
    expect(getPropertyValue).toHaveBeenCalledTimes(1);
  });

  it('invalidates automatically when data-theme changes', () => {
    const { root, getComputedStyleMock } = installTokenDocument({ '--primary': 'computed-primary' });
    expect(readCssToken('--primary')).toBe('computed-primary');
    root.dataset.theme = 'dark';
    expect(readCssToken('--primary')).toBe('computed-primary');
    expect(getComputedStyleMock).toHaveBeenCalledTimes(2);
  });

  it('reads a typed group and rejects missing tokens', () => {
    installTokenDocument({ '--primary': 'primary', '--ring': 'ring', '--generation-action': 'generation' });
    expect(readCssTokens(['--primary', '--ring', '--generation-action'] as const)).toEqual({
      '--primary': 'primary',
      '--ring': 'ring',
      '--generation-action': 'generation',
    });
    expect(() => readCssToken('--warning')).toThrow('Missing design token: --warning');
  });

  it('does not access the document at module import time', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('getComputedStyle', undefined);
    expect(() => readCssToken('--primary')).toThrow('Design tokens can only be read in a renderer document.');
  });
});
