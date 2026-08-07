import type { CodexTitleInput, CodexTitleResult } from '@/shared/contracts';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';

const chineseFallbackPrefix = '视觉研究';
const temporaryTitles = new Set(['新创作', 'new creation']);

const englishNoiseWords = new Set([
  'a',
  'an',
  'and',
  'by',
  'create',
  'creates',
  'depict',
  'depicts',
  'draw',
  'for',
  'from',
  'generate',
  'generated',
  'generates',
  'image',
  'in',
  'make',
  'of',
  'on',
  'or',
  'photo',
  'photograph',
  'picture',
  'please',
  'produce',
  'render',
  'show',
  'the',
  'to',
  'with',
]);

function normalizePrompt(prompt: string) {
  return prompt.replace(/\s+/g, ' ').trim();
}

function shortPromptToken(prompt: string) {
  let hash = 2166136261;
  for (const character of prompt) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(0, 4);
}

function stripChineseLead(segment: string) {
  return segment
    .replace(/^(?:请)?(?:生成|创建|制作|绘制|设计)(?:一张|一幅|一个|一位)?/u, '')
    .replace(/^(?:请)?(?:一张|一幅|一个|一位)/u, '')
    .trim();
}

function englishWords(segment: string) {
  return (segment.match(/[A-Za-z][A-Za-z'-]*/g) ?? [])
    .map((word) => trimSurroundingCharacters(word, "-'"))
    .filter((word) => word.length > 0 && !englishNoiseWords.has(word.toLowerCase()));
}

function meaningfulSegment(prompt: string) {
  const normalized = normalizePrompt(prompt);
  const segments = normalized
    .split(/[,.!?;:\n，。！？；：]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return (
    segments.find(
      (segment) =>
        (stripChineseLead(segment).match(/[\u3400-\u9fff]/gu)?.length ?? 0) >= 2 || englishWords(segment).length >= 2,
    ) ??
    segments[0] ??
    normalized
  );
}

function fallbackChineseTitle(segment: string, token: string) {
  const chinese =
    stripChineseLead(segment)
      .match(/[\u3400-\u9fff]+/gu)
      ?.join('') ?? '';
  const chineseTitle = chinese.slice(0, 16);
  if (chinese.length >= 2 && !temporaryTitles.has(chineseTitle.toLocaleLowerCase())) return chineseTitle;
  return `${chineseFallbackPrefix} · ${token}`;
}

function retainedTitle(value: string) {
  const title = value.trim();
  return temporaryTitles.has(title.toLocaleLowerCase()) ? '' : title;
}

/**
 * Produce a local title when the text model is unavailable or returns an invalid result.
 * Fill mode preserves user input; regenerate mode derives a fresh Chinese fallback.
 */
export function fallbackTitleSuggestion(input: CodexTitleInput): CodexTitleResult {
  const suppliedTitle = input.mode === 'fill' ? retainedTitle(input.title) : '';
  if (suppliedTitle) return { title: suppliedTitle };
  const prompt = normalizePrompt(input.prompt);
  const token = shortPromptToken(prompt);
  const segment = meaningfulSegment(prompt);
  return { title: fallbackChineseTitle(segment, token) };
}
