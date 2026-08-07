export const runtimeTokenNames = [
  '--background',
  '--surface',
  '--surface-sunken',
  '--overlay',
  '--foreground',
  '--foreground-secondary',
  '--muted-foreground',
  '--disabled-foreground',
  '--hover',
  '--hover-strong',
  '--pressed',
  '--selected',
  '--selected-foreground',
  '--selected-border',
  '--ring',
  '--primary',
  '--primary-foreground',
  '--primary-hover',
  '--border',
  '--border-strong',
  '--input',
  '--success',
  '--success-surface',
  '--warning',
  '--warning-surface',
  '--info',
  '--info-surface',
  '--destructive',
  '--destructive-foreground',
  '--destructive-surface',
  '--destructive-hover',
  '--media-surround',
  '--media-surround-light',
  '--media-surround-dark',
  '--media-checker-a',
  '--media-checker-b',
  '--dialog-scrim',
  '--state-locked-fg',
  '--state-locked-bg',
  '--state-changed-fg',
  '--state-changed-bg',
  '--state-drift-fg',
  '--generation-action',
  '--generation-action-foreground',
  '--generation-action-hover',
  '--verdict-pass',
  '--verdict-partial',
  '--verdict-fail',
  '--verdict-unrated',
  '--lifecycle-draft',
  '--lifecycle-approved',
  '--lifecycle-archived',
  '--lifecycle-published',
  '--relation-favorited',
  '--relation-referenced',
] as const;

export type RuntimeTokenName = (typeof runtimeTokenNames)[number];

let cachedRoot: HTMLElement | null = null;
let cachedTheme = '';
const cachedValues = new Map<RuntimeTokenName, string>();

function documentRoot(): HTMLElement {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    throw new Error('Design tokens can only be read in a renderer document.');
  }
  return document.documentElement;
}

function synchronizeCache(root: HTMLElement): void {
  const theme = root.dataset.theme ?? 'light';
  if (root !== cachedRoot || theme !== cachedTheme) {
    cachedRoot = root;
    cachedTheme = theme;
    cachedValues.clear();
  }
}

export function invalidateTokenCache(): void {
  cachedRoot = null;
  cachedTheme = '';
  cachedValues.clear();
}

export function readCssToken(name: RuntimeTokenName): string {
  const root = documentRoot();
  synchronizeCache(root);

  const cached = cachedValues.get(name);
  if (cached) return cached;

  const value = getComputedStyle(root).getPropertyValue(name).trim();
  if (!value) throw new Error(`Missing design token: ${name}`);
  cachedValues.set(name, value);
  return value;
}

export function readCssTokens<const Names extends readonly RuntimeTokenName[]>(
  names: Names,
): Record<Names[number], string> {
  return Object.fromEntries(names.map((name) => [name, readCssToken(name)])) as Record<Names[number], string>;
}
