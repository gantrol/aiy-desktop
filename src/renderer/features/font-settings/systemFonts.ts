import { quotedFontFamily, validFontFamily, type FontRole } from '@/renderer/features/font-settings/fontPreferences';

export const recommendedFonts = [
  {
    id: 'sourceSans',
    destination: 'FONT_SOURCE_SANS',
    roles: ['ui', 'content'],
    families: ['Source Han Sans SC', 'Source Han Sans CN', 'Source Han Sans CN VF', 'Noto Sans SC', 'Noto Sans CJK SC'],
  },
  {
    id: 'sourceSerif',
    destination: 'FONT_SOURCE_SERIF',
    roles: ['content'],
    families: [
      'Source Han Serif SC',
      'Source Han Serif CN',
      'Source Han Serif CN VF',
      'Noto Serif SC',
      'Noto Serif CJK SC',
    ],
  },
  { id: 'wenkai', destination: 'FONT_WENKAI', roles: ['content'], families: ['LXGW WenKai', 'LXGW WenKai Screen'] },
  { id: 'inter', destination: 'FONT_INTER', roles: ['ui', 'content'], families: ['Inter', 'Inter Variable'] },
  {
    id: 'jetbrains',
    destination: 'FONT_JETBRAINS',
    roles: ['mono'],
    families: ['JetBrains Mono', 'JetBrains Mono NL'],
  },
] as const;

const systemRecommendations: Record<FontRole, readonly string[]> = {
  ui: ['PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', 'Segoe UI Variable Text', 'DengXian'],
  content: ['PingFang SC', 'Songti SC', 'Kaiti SC', 'Microsoft YaHei', 'DengXian'],
  mono: ['SF Mono', 'Menlo', 'Cascadia Code', 'Cascadia Mono', 'Consolas'],
};

export function isRecommendedFont(family: string, role: FontRole) {
  return (
    systemRecommendations[role].includes(family) ||
    recommendedFonts.some(
      (font) =>
        (font.roles as readonly string[]).includes(role) && (font.families as readonly string[]).includes(family),
    )
  );
}

export interface SystemFonts {
  families: string[];
  complete: boolean;
}

let pending: Promise<SystemFonts> | undefined;

async function discover(): Promise<SystemFonts> {
  const host = window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> };
  if (host.queryLocalFonts) {
    try {
      const faces = await host.queryLocalFonts();
      const families = [...new Set(faces.map((face) => face.family).filter(validFontFamily))];
      if (families.length) return { families: families.sort((a, b) => a.localeCompare(b)), complete: true };
    } catch {
      // Older Electron builds or restricted hosts can still use known local families.
    }
  }
  const candidates = [
    ...new Set([
      ...Object.values(systemRecommendations).flat(),
      ...recommendedFonts.flatMap((font) => [...font.families]),
    ]),
  ];
  const found = await Promise.all(
    candidates.map(async (family) => {
      try {
        await new FontFace('AIY Font Availability', `local(${quotedFontFamily(family)})`).load();
        return family;
      } catch {
        return null;
      }
    }),
  );
  return {
    families: found.filter((family): family is string => family !== null).sort((a, b) => a.localeCompare(b)),
    complete: false,
  };
}

/** Call from a user gesture; only family names are retained, never font bytes. */
export function discoverSystemFonts(refresh = false) {
  if (refresh) pending = undefined;
  pending ??= discover();
  return pending;
}
