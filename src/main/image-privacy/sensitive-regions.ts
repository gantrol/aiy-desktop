import type { ImagePrivacyOptions, ImagePrivacyRegion } from '@/shared/contracts/image-privacy';
import type { OcrResult, OcrWord } from '@/main/image-privacy/windows-ocr';

type Kind = ImagePrivacyRegion['kind'];
const patterns: { kind: Kind; source: string; phone?: boolean }[] = [
  { kind: 'email', source: '[a-z0-9._%+\\-]{1,64}@[a-z0-9.\\-]{1,190}\\.[a-z]{2,24}' },
  { kind: 'phone', source: '(?<![\\d])\\+?\\d[\\d ()\\-]{8,28}\\d(?![\\d])', phone: true },
  {
    kind: 'credential',
    source:
      '\\b(?:sk-[a-z0-9_\\-]{16,200}|gh[pousr]_[a-z0-9]{20,200}|github_pat_[a-z0-9_]{20,200}|AKIA[A-Z0-9]{16})\\b',
  },
  {
    kind: 'credential',
    source: '(?:password|passwd|api[_ -]?key|access[_ -]?token|secret|密码|密钥|口令)\\s*[:=：]\\s*[^\\s]{4,256}',
  },
  { kind: 'credential', source: '\\bBearer\\s+[a-z0-9._~+/=\\-]{8,512}' },
];
const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

function lineText(words: OcrWord[], separator: string) {
  let text = '';
  const spans = words.map((word) => {
    if (text) text += separator;
    const start = text.length;
    text += normalize(word.text).replace(/\s+/gu, separator);
    return { start, end: text.length, word };
  });
  return { text, spans };
}

/** Bounding boxes include complete OCR words plus padding; partial glyph masking is unreliable. */
function regionFor(
  words: OcrWord[],
  kind: Kind,
  angle: number,
  width: number,
  height: number,
): ImagePrivacyRegion | null {
  const radians = (angle * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  const points = words
    .flatMap((word) => [
      [word.x, word.y],
      [word.x + word.width, word.y],
      [word.x, word.y + word.height],
      [word.x + word.width, word.y + word.height],
    ])
    .map(([x, y]) => ({
      x: cos * (x - width / 2) - sin * (y - height / 2) + width / 2,
      y: sin * (x - width / 2) + cos * (y - height / 2) + height / 2,
    }));
  const padding = Math.max(3, Math.ceil(Math.max(...words.map((word) => word.height)) * 0.12));
  const x = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - padding));
  const y = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - padding));
  const right = Math.min(width, Math.ceil(Math.max(...points.map((point) => point.x)) + padding));
  const bottom = Math.min(height, Math.ceil(Math.max(...points.map((point) => point.y)) + padding));
  return right > x && bottom > y ? { kind, x, y, width: right - x, height: bottom - y } : null;
}

function* sensitiveMatches(text: string, options: ImagePrivacyOptions, separator: string) {
  for (const pattern of patterns) {
    if (!options.kinds.includes(pattern.kind)) continue;
    for (const match of text.matchAll(new RegExp(pattern.source, 'giu'))) {
      if (pattern.phone) {
        const digits = match[0].replace(/\D/g, '').length;
        if (digits < 10 || digits > 15) continue;
      }
      yield { start: match.index, end: match.index + match[0].length, kind: pattern.kind };
    }
  }
  if (!options.kinds.includes('custom')) return;
  for (const term of options.terms) {
    const needle = normalize(term).replace(/\s+/gu, separator);
    if (!needle) continue;
    let start = text.indexOf(needle);
    while (start !== -1) {
      yield { start, end: start + needle.length, kind: 'custom' as const };
      start = text.indexOf(needle, start + needle.length);
    }
  }
}

export function findSensitiveRegions(
  ocr: Extract<OcrResult, { status: 'ready' }>,
  options: ImagePrivacyOptions,
  width: number,
  height: number,
): ImagePrivacyRegion[] | null {
  const regions = new Map<string, ImagePrivacyRegion>();
  for (const line of ocr.lines) {
    for (const separator of [' ', '']) {
      const { text, spans } = lineText(line.words, separator);
      for (const { start, end, kind } of sensitiveMatches(text, options, separator)) {
        const words = spans.filter((span) => span.start < end && span.end > start).map((span) => span.word);
        if (!words.length) continue;
        const region = regionFor(words, kind, ocr.angle, width, height);
        if (region) regions.set(`${region.x}:${region.y}:${region.width}:${region.height}`, region);
        if (regions.size > 300) return null;
      }
    }
  }
  return [...regions.values()];
}
