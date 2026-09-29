import { contentMarkdownText } from '@/shared/content-markdown';

// Linguistic data, not translated UI copy. These are keywords, not POS-tagged nouns.
const stopWords = new Set(
  (
    '的 了 和 是 在 有 我 你 他 她 它 我们 你们 他们 自己 这个 那个 这些 那些 一个 一些 一种 什么 怎么 为什么 ' +
    '可以 需要 就是 不是 没有 还有 以及 或者 但是 因为 所以 如果 然后 这样 那样 这里 那里 其中 对于 通过 ' +
    '进行 使用 可能 已经 还是 时候 现在 之前 之后 这样 这种 作为 比较 非常 主要 相关 例如 比如 不要 不能 ' +
    'the a an and or but is are was were be been being to of in on at for from with as by this that these those ' +
    'it its they them their we our you your he she his her i me my do does did have has had not no yes if then ' +
    'can could will would should may might must into about also just very more most some any all each other ' +
    'than so such there here when where which who what how why using use used https http www com'
  ).split(/\s+/),
);
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function keywordText(markdown: string) {
  return contentMarkdownText(markdown, () => '', { omitReferences: true })
    .replace(/(?:https?:\/\/|file:\/\/|www\.)\S+/giu, ' ')
    .normalize('NFKC');
}

export function keywordTerms(body: string) {
  const counts = new Map<string, number>();
  for (const part of segmenter.segment(body)) {
    if (!part.isWordLike) continue;
    const term = part.segment.toLowerCase();
    if (term.length < 2 || term.length > 32 || !/\p{L}/u.test(term) || stopWords.has(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
    if (counts.size > 4_000) return null;
  }
  return counts;
}
