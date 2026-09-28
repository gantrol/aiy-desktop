import type { ArticleElementNodeType } from '@/shared/contracts';

export type ArticleCheckProtectedRangeKind = 'URL' | 'APP_LINK' | 'FILE_PATH' | 'COMMAND_FLAG';

export interface ArticleCheckProtectedRange {
  startOffset: number;
  endOffset: number;
  kind: ArticleCheckProtectedRangeKind;
}

interface ProtectedPattern {
  kind: ArticleCheckProtectedRangeKind;
  expression: RegExp;
  captureGroup?: number;
  normalize?: (value: string) => string;
  trimTrailing?: boolean;
}

const protectedPatterns: readonly ProtectedPattern[] = [
  {
    kind: 'URL',
    expression: /(?:https?:\/\/|www\.|(?:github|gitlab|bitbucket)\.com\/)[^\s<>"'`，。；：！？）】》]+/giu,
    normalize: trimUrl,
  },
  {
    kind: 'APP_LINK',
    expression: /(?:codex|aiy|aiy-figure):[^\s<>"'`，。；：！？）】》]+/giu,
    trimTrailing: true,
  },
  {
    kind: 'FILE_PATH',
    expression:
      /(?:^|[\s([{])((?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/)(?:[^\s<>"'`，。；：！？）】》,;!?]+[\\/])*[^\s<>"'`，。；：！？）】》,;!?]+)/gu,
    captureGroup: 1,
    trimTrailing: true,
  },
  {
    kind: 'FILE_PATH',
    expression: /(?<![A-Za-z0-9_.@\/\\-])((?:[A-Za-z0-9_.@-]+[\\/])*\.env(?:\.[A-Za-z0-9_-]+)*)(?![A-Za-z0-9_])/gu,
    captureGroup: 1,
  },
  {
    kind: 'FILE_PATH',
    expression:
      /(?<![A-Za-z0-9_.@\/\\-])((?:[A-Za-z0-9_.@-]+[\\/])*[A-Za-z0-9_.@-]+\.(?:cjs|mjs|js|jsx|cts|mts|ts|tsx|json|jsonc|md|mdx|css|scss|less|htm|html|yml|yaml|toml|sql|sh|bash|zsh|ps1|py|rb|rs|go|java|kt|kts|swift|cs|fs|fsx|c|cc|cpp|h|hpp|lock|env|svg|png|jpg|jpeg|webp|gif|ico|pdf|doc|docx|xls|xlsx|ppt|pptx))(?![A-Za-z0-9_])/giu,
    captureGroup: 1,
    trimTrailing: true,
  },
  {
    kind: 'COMMAND_FLAG',
    expression: /(?:^|[\s([{])(--?[\p{L}\p{N}][\p{L}\p{N}_-]*)/gu,
    captureGroup: 1,
  },
];

const sentencePunctuation = new Set(['.', ',', ';', ':', '!', '?', '，', '。', '；', '：', '！', '？']);
const closingPairs = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
  ['>', '<'],
  ['）', '（'],
  ['】', '【'],
  ['》', '《'],
]);

function occurrences(value: string, character: string) {
  return [...value].filter((item) => item === character).length;
}

function trimTrailingPunctuation(value: string) {
  let end = value.length;
  while (end > 0) {
    const last = value[end - 1]!;
    if (sentencePunctuation.has(last)) {
      end -= 1;
      continue;
    }
    const opening = closingPairs.get(last);
    if (!opening) break;
    const candidate = value.slice(0, end);
    if (occurrences(candidate, last) <= occurrences(candidate, opening)) break;
    end -= 1;
  }
  return value.slice(0, end);
}

function trimUrl(value: string) {
  const trimmed = trimTrailingPunctuation(value);
  const authorityStart = /^https?:\/\//iu.test(trimmed) ? trimmed.indexOf('//') + 2 : 0;
  const authorityEnd = trimmed.slice(authorityStart).search(/[\/?#]/u);
  const authority = trimmed.slice(authorityStart, authorityEnd === -1 ? trimmed.length : authorityStart + authorityEnd);
  const firstNonAscii = authority.search(/[^\x00-\x7f]/u);
  if (firstNonAscii <= 0) return trimmed;
  const asciiAuthority = authority.slice(0, firstNonAscii);
  const completeAsciiAuthority =
    /^(?:(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]{2,63}|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9A-Fa-f:]+\]|localhost)(?::\d{1,5})?$/u;
  return completeAsciiAuthority.test(asciiAuthority) ? trimmed.slice(0, authorityStart + firstNonAscii) : trimmed;
}

export function articleCheckBlockIsEligible(nodeType: ArticleElementNodeType) {
  return nodeType !== 'codeBlock';
}

export function articleCheckProtectedRanges(text: string): ArticleCheckProtectedRange[] {
  const ranges: ArticleCheckProtectedRange[] = [];
  for (const pattern of protectedPatterns) {
    pattern.expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.expression.exec(text))) {
      const raw = pattern.captureGroup ? match[pattern.captureGroup] : match[0];
      const value = pattern.normalize
        ? pattern.normalize(raw)
        : pattern.trimTrailing
          ? trimTrailingPunctuation(raw)
          : raw;
      const relativeOffset = pattern.captureGroup ? match[0].lastIndexOf(raw) : 0;
      const startOffset = match.index + relativeOffset;
      if (value) {
        ranges.push({
          startOffset,
          endOffset: startOffset + value.length,
          kind: pattern.kind,
        });
      }
      if (value && value.length < raw.length) pattern.expression.lastIndex = startOffset + value.length;
      else if (!match[0].length) pattern.expression.lastIndex += 1;
    }
  }
  return ranges
    .sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset)
    .filter(
      (range, index, sorted) =>
        index === 0 ||
        range.startOffset !== sorted[index - 1]!.startOffset ||
        range.endOffset !== sorted[index - 1]!.endOffset,
    );
}

export function articleCheckRangeIsProtected(text: string, startOffset: number, endOffset: number) {
  if (endOffset <= startOffset) return false;
  return articleCheckProtectedRanges(text).some(
    (range) => startOffset < range.endOffset && range.startOffset < endOffset,
  );
}
