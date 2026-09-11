import { Bookmark, Check, Feather, Flag, Flower2, Heart, Lightbulb, Star } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';

export const petalColors: Record<PetalColor, { surface: string; ink: string; edge: string }> = {
  white: {
    surface: 'light-dark(#faf8f1,#33312c)',
    ink: 'light-dark(#514b40,#f3eee3)',
    edge: 'light-dark(#d6cfc0,#928878)',
  },
  rose: {
    surface: 'light-dark(#fce9e5,#402b30)',
    ink: 'light-dark(#633a40,#fae2e5)',
    edge: 'light-dark(#d29ba7,#a46c80)',
  },
  cream: {
    surface: 'light-dark(#fff7de,#3e3525)',
    ink: 'light-dark(#564421,#f8ebc9)',
    edge: 'light-dark(#cfb36c,#a98f58)',
  },
  sage: {
    surface: 'light-dark(#eaf1e1,#29392d)',
    ink: 'light-dark(#3f543c,#e0eedc)',
    edge: 'light-dark(#9db18c,#718e69)',
  },
  sky: {
    surface: 'light-dark(#e7eff8,#302f2c)',
    ink: 'light-dark(#35526a,#eee9dc)',
    edge: 'light-dark(#94afcc,#a49b86)',
  },
  lilac: {
    surface: 'light-dark(#f0e9f8,#302f2c)',
    ink: 'light-dark(#564265,#eee9dc)',
    edge: 'light-dark(#b49acb,#a49b86)',
  },
};
export const petalIcons = {
  feather: Feather,
  lightbulb: Lightbulb,
  heart: Heart,
  star: Star,
  bookmark: Bookmark,
  check: Check,
  flag: Flag,
  flower: Flower2,
};
export function appearanceStyle(color: PetalColor): CSSProperties {
  const palette = petalColors[color];
  return {
    '--petal-surface': palette.surface,
    '--petal-ink': palette.ink,
    '--petal-edge': palette.edge,
  } as CSSProperties;
}
export function PetalNoteIcon({ icon, className }: { icon: PetalIcon; className?: string }) {
  const Icon = petalIcons[icon];
  return <Icon className={className} aria-hidden="true" />;
}

/** A note is one paper surface, including shared inputs, toolbars and their popup menus. */
export function noteAppearanceStyle(color: PetalColor): CSSProperties {
  const paper = 'var(--petal-surface)',
    ink = 'var(--petal-ink)';
  return {
    ...appearanceStyle(color),
    '--background': paper,
    '--surface': paper,
    '--surface-sunken': paper,
    '--card': paper,
    '--popover': paper,
    '--secondary': paper,
    '--muted': paper,
    '--foreground': ink,
    '--card-foreground': ink,
    '--popover-foreground': ink,
    '--secondary-foreground': ink,
    '--foreground-secondary': `color-mix(in srgb, ${ink} 75%, transparent)`,
    '--muted-foreground': `color-mix(in srgb, ${ink} 60%, transparent)`,
    '--disabled-foreground': `color-mix(in srgb, ${ink} 40%, transparent)`,
    '--hover': `color-mix(in srgb, ${ink} 5%, ${paper})`,
    '--pressed': `color-mix(in srgb, ${ink} 9%, ${paper})`,
    '--selected': `color-mix(in srgb, ${ink} 12%, ${paper})`,
    '--selected-foreground': ink,
    '--border': `color-mix(in srgb, ${ink} 15%, transparent)`,
    '--input': `color-mix(in srgb, ${ink} 15%, transparent)`,
  } as CSSProperties;
}
