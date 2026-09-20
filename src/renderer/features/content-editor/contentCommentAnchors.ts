import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Decoration } from '@tiptap/pm/view';
import type { ArticleEditorLocationDto, ContentCommentDto } from '@/shared/contracts';
import { isOutlineChildList } from '@/shared/outline-structure';
import { contentCommentRangeBelongsToSelf } from '@/renderer/features/content-editor/contentCommentScope';

interface CommentTextSpan {
  textFrom: number;
  textTo: number;
  from: number;
  to: number;
  linear: boolean;
}

interface CommentTextProjection {
  text: string;
  spans: CommentTextSpan[];
}

const commentTextProjectionCache = new WeakMap<ProseMirrorNode, readonly CommentTextProjection[]>();
const commentBlockPositionCache = new WeakMap<
  ProseMirrorNode,
  ReadonlyMap<string, { node: ProseMirrorNode; position: number }>
>();

function commentBlockPositions(document: ProseMirrorNode) {
  const cached = commentBlockPositionCache.get(document);
  if (cached) return cached;
  const blocks = new Map<string, { node: ProseMirrorNode; position: number }>();
  document.descendants((node, position) => {
    if (typeof node.attrs.blockId === 'string' && node.attrs.blockId) {
      blocks.set(node.attrs.blockId, { node, position });
    }
  });
  commentBlockPositionCache.set(document, blocks);
  return blocks;
}

function commentTextPositionIdentity(document: ProseMirrorNode, position: number) {
  const resolved = document.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (typeof node.attrs.blockId === 'string' && node.attrs.blockId) {
      return {
        blockId: node.attrs.blockId,
        offset: position - resolved.start(depth),
      };
    }
  }
  return null;
}

/** Nested paragraphs have stable block IDs even though article placements omit them.
 * Moving a child can shift a later Note inside its item without moving that Note's text.
 * Undefined permits legacy fallback; null means known identities cannot safely resolve.
 */
export function mapContentCommentTextRange(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  comment: ContentCommentDto,
  decoration: Decoration | undefined,
): { from: number; to: number } | null | undefined {
  if (!decoration || decoration.spec.relocated || comment.anchor.kind !== 'TEXT_RANGE') return undefined;
  const start = commentTextPositionIdentity(before, decoration.from);
  const end = commentTextPositionIdentity(before, Math.max(decoration.from, decoration.to - 1));
  if (!start || !end) return undefined;
  const blocks = commentBlockPositions(after);
  const nextStart = blocks.get(start.blockId);
  const nextEnd = blocks.get(end.blockId);
  if (!nextStart || !nextEnd) return null;
  const exactQuote = before.textBetween(decoration.from, decoration.to, ' ');
  const from = nextStart.position + 1 + start.offset;
  const to = nextEnd.position + 1 + end.offset + 1;
  if (
    start.offset <= nextStart.node.content.size &&
    end.offset + 1 <= nextEnd.node.content.size &&
    from < to &&
    after.textBetween(from, to, ' ') === exactQuote
  ) {
    return { from, to };
  }
  if (start.blockId !== end.blockId || !exactQuote) return null;
  const local = matchingContentCommentNodeRange(nextStart.node, {
    ...comment,
    anchor: {
      ...comment.anchor,
      startOffset: start.offset,
      endOffset: end.offset + 1,
      exactQuote,
      prefix: before.textBetween(Math.max(0, decoration.from - 200), decoration.from, ' ').slice(-200),
      suffix: before.textBetween(decoration.to, Math.min(before.content.size, decoration.to + 200), ' ').slice(0, 200),
    },
  });
  return local
    ? {
        from: nextStart.position + 1 + local.startOffset,
        to: nextStart.position + 1 + local.endOffset,
      }
    : null;
}

/** Preserve the live text range when saved comment coordinates lag behind editing. */
export function liveContentCommentAnchor(
  document: ProseMirrorNode,
  comment: ContentCommentDto,
  decoration: Decoration | undefined,
  locationAt: (position: number) => ArticleEditorLocationDto | null,
): ContentCommentDto | null {
  if (!decoration || decoration.spec.relocated || comment.anchor.kind !== 'TEXT_RANGE') return null;
  const start = locationAt(decoration.from);
  const end = locationAt(Math.max(decoration.from, decoration.to - 1));
  if (!start || !end) return null;
  return {
    ...comment,
    anchor: {
      ...comment.anchor,
      startElementId: start.elementId,
      endElementId: end.elementId,
      startOffset: start.relativeOffset,
      endOffset: end.relativeOffset + 1,
      startBlockIndex: start.blockIndex ?? comment.anchor.startBlockIndex,
      endBlockIndex: end.blockIndex ?? comment.anchor.endBlockIndex,
      exactQuote: document.textBetween(decoration.from, decoration.to, ' ').slice(0, 2_000),
      prefix: document.textBetween(Math.max(0, decoration.from - 200), decoration.from, ' ').slice(-200),
      suffix: document
        .textBetween(decoration.to, Math.min(document.content.size, decoration.to + 200), ' ')
        .slice(0, 200),
    },
  };
}

function commentTextProjections(node: ProseMirrorNode) {
  const cached = commentTextProjectionCache.get(node);
  if (cached) return cached;
  const projections: CommentTextProjection[] = [];
  let projection: CommentTextProjection = { text: '', spans: [] };
  let previousBlockEnd: number | null = null;
  function append(text: string, from: number, to: number, linear = false) {
    if (!text) return;
    const textFrom = projection.text.length;
    projection.text += text;
    projection.spans.push({
      textFrom,
      textTo: projection.text.length,
      from,
      to,
      linear,
    });
  }
  node.descendants((child, position, parent) => {
    if (
      node.type.name === 'listItem' &&
      parent === node &&
      isOutlineChildList({ type: child.type.name, attrs: child.attrs })
    ) {
      // A quote must not jump across a child outline into a later Note block.
      if (projection.text) projections.push(projection);
      projection = { text: '', spans: [] };
      previousBlockEnd = null;
      return false;
    }
    const text = child.isText ? child.text! : child.isLeaf ? (child.type.spec.leafText?.(child) ?? '') : '';
    if (child.isBlock && (child.isTextblock || (child.isLeaf && text))) {
      if (previousBlockEnd !== null) append(' ', previousBlockEnd, position + (child.isTextblock ? 1 : 0));
      previousBlockEnd = position + child.nodeSize - (child.isLeaf ? 0 : 1);
    }
    append(text, position, position + child.nodeSize, child.isText);
    return true;
  });
  if (projection.text) projections.push(projection);
  commentTextProjectionCache.set(node, projections);
  return projections;
}

function projectedCommentRange(projection: CommentTextProjection, from: number, to: number) {
  const start = projection.spans.find((span) => span.textFrom <= from && from < span.textTo);
  const end = projection.spans.find((span) => span.textFrom < to && to <= span.textTo);
  if (!start || !end) return null;
  return {
    startOffset: start.linear ? start.from + from - start.textFrom : start.from,
    endOffset: end.linear ? end.from + to - end.textFrom : end.to,
  };
}

/** Comment offsets count ProseMirror positions, including wrappers and inline atoms. */
export function matchingContentCommentNodeRange(node: ProseMirrorNode, comment: ContentCommentDto) {
  const { exactQuote: quote, startOffset, endOffset, prefix, suffix } = comment.anchor;
  if (!quote) return null;
  // Legacy offsets can point into a structural child while naming its ancestor.
  // A matching quote alone must not silently certify that stale owner as valid.
  if (startOffset >= 0 && startOffset < endOffset && endOffset <= node.content.size) {
    // Do not move a known descendant range onto identical text in the parent's body.
    if (!contentCommentRangeBelongsToSelf(node, startOffset, endOffset)) return null;
    const original = node.textBetween(startOffset, endOffset, ' ');
    // Capture truncates the stored quote at 2,000 characters, not the selected range.
    if (original === quote || (quote.length === 2_000 && original.length > quote.length && original.startsWith(quote)))
      return { startOffset, endOffset };
  }
  let occurrenceCount = 0;
  let contextualCount = 0;
  let onlyOccurrence: ReturnType<typeof projectedCommentRange> = null;
  let onlyContextualOccurrence: ReturnType<typeof projectedCommentRange> = null;
  for (const projection of commentTextProjections(node)) {
    const { text } = projection;
    for (let offset = text.indexOf(quote); offset >= 0; offset = text.indexOf(quote, offset + 1)) {
      occurrenceCount += 1;
      if (occurrenceCount > 256) return null;
      const range = projectedCommentRange(projection, offset, offset + quote.length);
      if (!range || node.textBetween(range.startOffset, range.endOffset, ' ') !== quote) continue;
      onlyOccurrence = range;
      const before = prefix ? text.slice(Math.max(0, offset - prefix.length), offset) : '';
      const afterOffset = offset + quote.length;
      const after = suffix ? text.slice(afterOffset, afterOffset + suffix.length) : '';
      if ((!prefix || prefix.endsWith(before)) && (!suffix || suffix.startsWith(after))) {
        contextualCount += 1;
        onlyContextualOccurrence = range;
      }
    }
  }
  return contextualCount === 1 ? onlyContextualOccurrence : occurrenceCount === 1 ? onlyOccurrence : null;
}

export function matchingContentCommentQuote(text: string, comment: ContentCommentDto) {
  const quote = comment.anchor.exactQuote;
  if (!quote) return null;
  const originalOffset = comment.anchor.startOffset;
  if (text.slice(originalOffset, originalOffset + quote.length) === quote) {
    return {
      startOffset: originalOffset,
      endOffset: originalOffset + quote.length,
    };
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
