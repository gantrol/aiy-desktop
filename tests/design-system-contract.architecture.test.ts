import { describe, expect, it } from 'vitest';
import {
  auditL1Consumption,
  auditP1InteractionContracts,
  auditRawColors,
  auditTokenArchitecture,
  findFixedTailwindPaletteUtilities,
  formatDiagnostics,
  readTokenSource,
} from './support/design-system-audit';

function primitiveHex(source: string, token: string): string {
  const value = source.match(new RegExp(`--${token}\\s*:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`Missing hex primitive: --${token}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

describe('design-system static contracts', () => {
  it('keeps raw colors inside tokens.css', () => {
    expect(formatDiagnostics(auditRawColors())).toEqual([]);
  });

  it('detects fixed Tailwind palette utilities without flagging semantic colors', () => {
    expect(
      findFixedTailwindPaletteUtilities('bg-black/35 text-white text-rose-500 bg-overlay text-foreground'),
    ).toEqual(['bg-black/35', 'text-white', 'text-rose-500']);
  });

  it('prevents L1 token consumption outside tokens.css', () => {
    expect(formatDiagnostics(auditL1Consumption())).toEqual([]);
  });

  it('keeps token files and entrypoints wired together', () => {
    expect(formatDiagnostics(auditTokenArchitecture())).toEqual([]);
  });

  it('keeps navigation flat and E3 primitives semantic, focused, and tokenized', () => {
    expect(formatDiagnostics(auditP1InteractionContracts())).toEqual([]);
  });

  it('keeps state foregrounds readable on both shell surfaces', () => {
    const source = readTokenSource();
    const surfaces = [primitiveHex(source, 'sand-50'), primitiveHex(source, 'sand-100')];
    const stateForegrounds = ['red-600', 'red-700', 'amber-700', 'green-700', 'blue-700'];
    for (const foreground of stateForegrounds) {
      for (const surface of surfaces)
        expect(contrast(primitiveHex(source, foreground), surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of surfaces)
      expect(contrast(primitiveHex(source, 'plum-600'), surface)).toBeGreaterThanOrEqual(3);
  });

  it('keeps compact metadata readable on persistent light and dark fills', () => {
    const source = readTokenSource();
    const lightMuted = primitiveHex(source, 'sand-700');
    const lightFills = ['sand-50', 'sand-100', 'sand-200', 'plum-100'];
    for (const fill of lightFills) {
      expect(contrast(lightMuted, primitiveHex(source, fill)), fill).toBeGreaterThanOrEqual(4.5);
    }

    const darkMuted = primitiveHex(source, 'sand-500');
    for (const fill of ['sand-900', 'plum-700']) {
      expect(contrast(darkMuted, primitiveHex(source, fill)), fill).toBeGreaterThanOrEqual(4.5);
    }

    expect(source.match(/--lifecycle-archived:\s*var\(--muted-foreground\);/g)).toHaveLength(2);
    expect(source).not.toContain('--lifecycle-archived: var(--disabled-foreground);');
  });

  it('keeps global primary neutral and gives generation its own domain action tokens', () => {
    const source = readTokenSource();
    const root = source.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const dark = source.match(/\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(root).toContain('--primary: var(--sand-900);');
    expect(root).toContain('--primary-foreground: var(--neutral-0);');
    expect(root).toContain('--primary-hover: var(--sand-950);');
    expect(root).toContain('--generation-action: var(--plum-600);');
    expect(root).toContain('--generation-action-foreground: var(--neutral-0);');
    expect(root).toContain('--generation-action-hover: var(--plum-700);');

    expect(dark).toContain('--primary: var(--sand-50);');
    expect(dark).toContain('--primary-foreground: var(--sand-950);');
    expect(dark).toContain('--primary-hover: var(--neutral-200);');
    expect(dark).toContain('--generation-action: var(--plum-200);');
    expect(dark).toContain('--generation-action-foreground: var(--plum-700);');
    expect(dark).toContain('--generation-action-hover: var(--plum-100);');

    expect(source).toContain('--color-generation-action: var(--generation-action);');
    expect(source).toContain('--color-generation-action-foreground: var(--generation-action-foreground);');
    expect(source).toContain('--color-generation-action-hover: var(--generation-action-hover);');
  });
});
