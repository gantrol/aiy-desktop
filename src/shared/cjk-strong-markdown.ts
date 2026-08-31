export interface AdjacentCjkStrongMatch {
  raw: string;
  text: string;
  trailingWhitespace: string;
}

const adjacentCjkStrongPattern = /^\*\*(?![\s*])((?:(?!\*\*)[\s\S])*?(?![*_])\p{P})([^\S\r\n]*)\*\*(?=([\p{L}\p{N}]))/u;
const hanCharacterPattern = /\p{Script=Han}/u;

/**
 * Matches the CJK strong form that CommonMark rejects when punctuation inside
 * the mark is followed immediately by a letter or number outside it.
 */
export function matchAdjacentCjkStrongMarkdown(source: string): AdjacentCjkStrongMatch | null {
  const match = adjacentCjkStrongPattern.exec(source);
  if (!match) return null;

  const [raw, text, trailingWhitespace, followingCharacter] = match;
  if (!text || !followingCharacter) return null;
  if (!hanCharacterPattern.test(text) && !hanCharacterPattern.test(followingCharacter)) return null;

  return { raw, text, trailingWhitespace: trailingWhitespace ?? '' };
}
