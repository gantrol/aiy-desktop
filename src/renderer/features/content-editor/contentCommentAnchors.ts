import type { ContentCommentDto } from '@/shared/contracts';

export function matchingContentCommentQuote(text: string, comment: ContentCommentDto) {
  const quote = comment.anchor.exactQuote;
  if (!quote) return null;
  const originalOffset = comment.anchor.startOffset;
  if (text.slice(originalOffset, originalOffset + quote.length) === quote) {
    return { startOffset: originalOffset, endOffset: originalOffset + quote.length };
  }
  let occurrenceCount = 0;
  let onlyOccurrence = -1;
  let contextualCount = 0;
  let onlyContextualOccurrence = -1;
  for (let offset = text.indexOf(quote); offset >= 0; offset = text.indexOf(quote, offset + 1)) {
    occurrenceCount += 1;
    if (occurrenceCount > 256) return null;
    onlyOccurrence = offset;
    const prefix = comment.anchor.prefix;
    const suffix = comment.anchor.suffix;
    const before = prefix ? text.slice(Math.max(0, offset - prefix.length), offset) : '';
    const afterOffset = offset + quote.length;
    const after = suffix ? text.slice(afterOffset, afterOffset + suffix.length) : '';
    if ((!prefix || prefix.endsWith(before)) && (!suffix || suffix.startsWith(after))) {
      contextualCount += 1;
      onlyContextualOccurrence = offset;
    }
  }
  const offset = contextualCount === 1 ? onlyContextualOccurrence : occurrenceCount === 1 ? onlyOccurrence : -1;
  return offset < 0 ? null : { startOffset: offset, endOffset: offset + quote.length };
}
