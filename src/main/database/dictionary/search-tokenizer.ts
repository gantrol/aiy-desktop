const ENGLISH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
  'without',
  'very',
  'image',
  'photo',
  'style',
]);

export function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

export function searchTokenFrequencies(value: string) {
  const normalized = normalizeSearchText(value);
  const result = new Map<string, number>();
  const add = (token: string) => result.set(token, (result.get(token) ?? 0) + 1);
  for (const token of normalized.match(/[a-z0-9]+/g) ?? []) {
    if (token.length > 1 && !ENGLISH_STOP_WORDS.has(token)) add(token);
  }
  for (const sequence of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    const characters = Array.from(sequence);
    if (characters.length === 1) add(characters[0]);
    if (characters.length <= 6) add(sequence);
    for (let index = 0; index < characters.length - 1; index += 1) {
      add(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return result;
}

export function searchTokens(value: string) {
  return new Set(searchTokenFrequencies(value).keys());
}
