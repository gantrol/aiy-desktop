interface XTextRules {
  parseTweet(text: string): { weightedLength: number; valid: boolean };
  extractUrlsWithIndices(text: string): { indices: [number, number] }[];
}

const MAX_WEIGHT = 280;

/** Both runtimes supply their pinned twitter-text rules; slices preserve URLs and graphemes. */
export function splitXText(text: string, { parseTweet, extractUrlsWithIndices }: XTextRules): string[] | null {
  if (parseTweet(text).weightedLength <= MAX_WEIGHT) return [text];
  const urls = extractUrlsWithIndices(text);
  const openingEnd = /\r?\n[\t ]*\r?\n/u.exec(text)?.index ?? text.length;
  const keepOpening = parseTweet(text.slice(0, openingEnd)).weightedLength <= MAX_WEIGHT;
  let urlIndex = 0;
  const boundaries = [0];
  for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const end = index + segment.length;
    while (urls[urlIndex] && urls[urlIndex]!.indices[1] <= index) urlIndex++;
    const url = urls[urlIndex];
    if (!url || end <= url.indices[0] || end >= url.indices[1]) boundaries.push(end);
  }
  const parts: string[] = [];
  let startIndex = 0;
  while (startIndex < boundaries.length - 1) {
    const start = boundaries[startIndex]!;
    let low = startIndex + 1;
    let high = boundaries.length - 1;
    let fit = startIndex;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (parseTweet(text.slice(start, boundaries[middle])).weightedLength <= MAX_WEIGHT) {
        fit = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (fit === startIndex) return null;
    let cut = fit;
    if (fit < boundaries.length - 1) {
      const candidates = boundaries.slice(startIndex + 1, fit + 1);
      const remainingPosts = Math.ceil(parseTweet(text.slice(start)).weightedLength / MAX_WEIGHT) - 1;
      for (const ending of [/\n\s*$/u, /[。！？.!?]["'”’）)]*\s*$/u, /\s$/u]) {
        let preferred = -1;
        for (let index = candidates.length - 1; index >= 0; index--) {
          const end = candidates[index]!;
          if (startIndex === 0 && keepOpening && end < openingEnd) continue;
          const prefix = text.slice(start, end);
          if (
            ending.test(prefix) &&
            parseTweet(prefix).weightedLength >= MAX_WEIGHT / 2 &&
            parseTweet(text.slice(end)).weightedLength <= remainingPosts * MAX_WEIGHT
          ) {
            preferred = index;
            break;
          }
        }
        if (preferred >= 0) {
          cut = startIndex + 1 + preferred;
          break;
        }
      }
    }
    const part = text.slice(start, boundaries[cut]);
    if (!parseTweet(part).valid) return null;
    parts.push(part);
    startIndex = cut;
  }
  return parts;
}
