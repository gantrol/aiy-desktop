import type { TextCoverFont } from '@/renderer/features/text-covers/textCoverPresets';

export const textCoverFontStacks: Record<TextCoverFont, string> = {
  sans: '"PingFang SC", "DengXian", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif',
  serif: '"Songti SC", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
  kai: '"LXGW WenKai", "Kaiti SC", "KaiTi", "STKaiti", "Songti SC", "SimSun", serif',
};

export const localTextCoverFonts = [
  { id: 'pingfang', family: 'PingFang SC', local: ['PingFang SC', 'PingFangSC-Regular'], fallback: 'sans' },
  { id: 'dengxian', family: 'DengXian', local: ['DengXian'], fallback: 'sans' },
  { id: 'yahei', family: 'Microsoft YaHei', local: ['Microsoft YaHei', 'MicrosoftYaHei'], fallback: 'sans' },
  { id: 'songti', family: 'Songti SC', local: ['Songti SC', 'Songti-SC-Regular'], fallback: 'serif' },
  { id: 'simsun', family: 'SimSun', local: ['SimSun'], fallback: 'serif' },
  { id: 'kaitiSc', family: 'Kaiti SC', local: ['Kaiti SC', 'Kaiti-SC-Regular'], fallback: 'kai' },
  { id: 'kaiti', family: 'KaiTi', local: ['KaiTi'], fallback: 'kai' },
  { id: 'notoSans', family: 'Noto Sans SC', local: ['Noto Sans SC', 'Noto Sans CJK SC'], fallback: 'sans' },
  { id: 'notoSerif', family: 'Noto Serif SC', local: ['Noto Serif SC', 'Noto Serif CJK SC'], fallback: 'serif' },
  { id: 'wenkai', family: 'LXGW WenKai', local: ['LXGW WenKai'], fallback: 'kai' },
] as const;

let installedFonts: Promise<string[]> | undefined;
const recommendedFonts = new Set(['pingfang', 'dengxian', 'yahei', 'songti', 'notoSans', 'notoSerif', 'wenkai']);

export function isRecommendedTextCoverFont(id: string) {
  return recommendedFonts.has(id);
}

/** Probe only this small, curated list when the user opens the cover editor. No enumeration or font download. */
export function discoverTextCoverFonts() {
  installedFonts ??= Promise.all(
    localTextCoverFonts.map(async (font) => {
      try {
        const alias = `AIY Cover ${font.id}`;
        const face = new FontFace(alias, font.local.map((name) => `local("${name}")`).join(', '));
        await face.load();
        // Probe availability only. Rendering uses the original family so its real
        // regular/medium/bold faces remain available instead of synthesizing one face.
        return font.id;
      } catch {
        return null;
      }
    }),
  ).then((ids) => ids.filter((id): id is NonNullable<typeof id> => id !== null));
  return installedFonts;
}

export function textCoverFontFamily(id: string) {
  const font = localTextCoverFonts.find((candidate) => candidate.id === id);
  return font
    ? `${font.local.map((name) => `"${name}"`).join(', ')}, ${textCoverFontStacks[font.fallback]}`
    : (textCoverFontStacks[id as TextCoverFont] ?? textCoverFontStacks.sans);
}
