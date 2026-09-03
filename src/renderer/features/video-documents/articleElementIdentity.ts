import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type {
  ArticleCheckBlockInput,
  ArticleCommentAnchorInput,
  ArticleCommentAnchorUpdateInput,
  ArticleCommentDto,
  ArticleEditorLocationDto,
  ArticleElementNodeType,
  ArticleElementPlacementInput,
} from '@/shared/contracts';
import { articleElementTextFingerprint } from '@/shared/contracts/article';
import {
  ARTICLE_ELEMENT_ATTRIBUTE,
  articleElementNodeTypes,
  isArticleElementNodeType,
  nextArticleElementId,
  takeSavedArticleElement,
} from '@/renderer/features/video-documents/articleElementIdentityModel';

const ARTICLE_ELEMENT_IDENTITY_META = 'articleElementIdentity';
type ArticleElementIdentityOrigin = 'hydrate' | 'identity';
const ARTICLE_VIEWPORT_INSET_PX = 24;
const articleElementPluginKey = new PluginKey('articleElementIdentity');
const articleCheckNodeTypeSet = new Set<ArticleElementNodeType>([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'tableHeader',
  'tableCell',
]);

interface LocatedArticleElement {
  node: ProseMirrorNode;
  position: number;
  elementId: string;
  blockIndex: number;
  nodeType: ArticleElementNodeType;
  outlineHeadingIndex: number | null;
}

interface LocatedArticleElementIndex {
  elements: readonly LocatedArticleElement[];
  byId: ReadonlyMap<string, LocatedArticleElement>;
}

interface ArticleElementTextProjection {
  textFingerprint: string;
  preview: string;
}

const articleElementTextProjectionCache = new WeakMap<ProseMirrorNode, ArticleElementTextProjection>();

function normalizedPreview(text: string) {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 280);
}

function wholeElementAnchorKind(nodeType: ArticleElementNodeType): ArticleCommentAnchorInput['kind'] {
  if (nodeType === 'table') return 'TABLE';
  if (nodeType === 'tableRow') return 'TABLE_ROW';
  if (nodeType === 'tableCell' || nodeType === 'tableHeader') return 'TABLE_CELL';
  return 'BLOCK';
}

function elementText(node: ProseMirrorNode) {
  if (node.type.name !== 'image') return node.textContent;
  return [node.attrs.alt, node.attrs.title, node.attrs.sourcePath, node.attrs.src]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' ');
}

function articleElementTextProjection(node: ProseMirrorNode, nodeType: ArticleElementNodeType) {
  const cached = articleElementTextProjectionCache.get(node);
  if (cached) return cached;
  const text = elementText(node);
  const projection = {
    textFingerprint: articleElementTextFingerprint(nodeType, text),
    preview: normalizedPreview(text),
  };
  articleElementTextProjectionCache.set(node, projection);
  return projection;
}

function articleElementPlacement(element: LocatedArticleElement): ArticleElementPlacementInput {
  return {
    elementId: element.elementId,
    blockIndex: element.blockIndex,
    nodeType: element.nodeType,
    ...articleElementTextProjection(element.node, element.nodeType),
  };
}

function isArticleElementNode(document: ProseMirrorNode, node: ProseMirrorNode, position: number) {
  if (!isArticleElementNodeType(node.type.name)) return false;
  if (node.type.name !== 'paragraph') return true;
  return document.resolve(position).parent === document;
}

function locatedArticleElements(document: ProseMirrorNode): LocatedArticleElement[] {
  const located: LocatedArticleElement[] = [];
  let outlineHeadingIndex: number | null = null;
  document.descendants((node, position) => {
    if (!isArticleElementNode(document, node, position)) return true;
    const nodeType = node.type.name as ArticleElementNodeType;
    const level = Number(node.attrs.level);
    if (nodeType === 'heading' && level >= 2 && level <= 6) {
      outlineHeadingIndex = (outlineHeadingIndex ?? -1) + 1;
    }
    located.push({
      node,
      position,
      elementId: typeof node.attrs[ARTICLE_ELEMENT_ATTRIBUTE] === 'string' ? node.attrs[ARTICLE_ELEMENT_ATTRIBUTE] : '',
      blockIndex: located.length,
      nodeType,
      outlineHeadingIndex,
    });
    return true;
  });
  return located;
}

function locatedArticleElementIndex(document: ProseMirrorNode): LocatedArticleElementIndex {
  const elements = locatedArticleElements(document);
  const byId = new Map<string, LocatedArticleElement>();
  for (const element of elements) {
    if (element.elementId) byId.set(element.elementId, element);
  }
  return {
    elements,
    byId,
  };
}

function transactionHasCompositionOrigin(transaction: Transaction): boolean {
  if (transaction.getMeta('composition') !== undefined) return true;
  const appendedTransaction = transaction.getMeta('appendedTransaction');
  return appendedTransaction instanceof Transaction && transactionHasCompositionOrigin(appendedTransaction);
}

function identityTransaction(
  document: ProseMirrorNode,
  transaction: Transaction,
  elements: readonly LocatedArticleElement[] = locatedArticleElements(document),
) {
  const seen = new Set<string>();
  let changed = false;
  for (const located of elements) {
    const current = located.elementId;
    const elementId = current && !seen.has(current) ? current : nextArticleElementId();
    seen.add(elementId);
    if (elementId === current) continue;
    transaction.setNodeAttribute(located.position, ARTICLE_ELEMENT_ATTRIBUTE, elementId);
    changed = true;
  }
  if (!changed) return null;
  transaction.setMeta(ARTICLE_ELEMENT_IDENTITY_META, 'identity' satisfies ArticleElementIdentityOrigin);
  transaction.setMeta('addToHistory', false);
  return transaction;
}

function nearestLocatedElement(elements: readonly LocatedArticleElement[], blockIndex: number) {
  if (!elements.length) return null;
  return elements[Math.max(0, Math.min(Math.round(blockIndex), elements.length - 1))] ?? null;
}

function matchingQuoteRange(element: LocatedArticleElement, comment: ArticleCommentDto) {
  const quote = comment.anchor.exactQuote;
  if (!quote) return null;
  const text = element.node.textContent;
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

function commentDecorations(
  document: ProseMirrorNode,
  index: LocatedArticleElementIndex,
  comment: ArticleCommentDto,
  forceRelocated = false,
) {
  const { elements } = index;
  const start =
    index.byId.get(comment.anchor.startElementId) ?? nearestLocatedElement(elements, comment.anchor.startBlockIndex);
  const end =
    index.byId.get(comment.anchor.endElementId) ?? nearestLocatedElement(elements, comment.anchor.endBlockIndex);
  if (!start || !end) return [];
  let relocated =
    forceRelocated ||
    start.elementId !== comment.anchor.startElementId ||
    end.elementId !== comment.anchor.endElementId;
  let startOffset = comment.anchor.startOffset;
  let endOffset = comment.anchor.endOffset;
  if (!relocated && start === end && comment.anchor.kind === 'TEXT_RANGE' && comment.anchor.exactQuote) {
    const range = matchingQuoteRange(start, comment);
    if (range) ({ startOffset, endOffset } = range);
    else relocated = true;
  }
  const from = Math.max(0, Math.min(start.position + 1 + startOffset, start.position + start.node.nodeSize - 1));
  const to = Math.max(from, Math.min(end.position + 1 + endOffset, end.position + end.node.nodeSize - 1));
  if (!relocated && comment.anchor.kind === 'TEXT_RANGE' && comment.anchor.exactQuote && from < to) {
    const anchoredText = document.textBetween(from, to, ' ').replace(/\s+/gu, ' ').trim();
    const quote = comment.anchor.exactQuote.replace(/\s+/gu, ' ').trim();
    if (quote && anchoredText !== quote) relocated = true;
  }
  const specification = { commentId: comment.id, relocated };
  const attributes = {
    class: `box-decoration-clone bg-[var(--article-comment-background)] underline decoration-[var(--article-comment-decoration)] underline-offset-4 [text-decoration-thickness:var(--article-comment-thickness)] transition-[background-color,text-decoration-color,text-decoration-thickness] duration-fast ${relocated ? 'decoration-dashed' : 'decoration-solid'}`,
    'data-article-comment-id': comment.id,
    'data-article-comment-status': comment.status,
    style: `--article-comment-background: transparent; --article-comment-decoration: ${comment.status === 'OPEN' ? 'color-mix(in srgb, var(--warning) 70%, transparent)' : 'transparent'}; --article-comment-thickness: 1px;`,
  };
  if (relocated) {
    return [Decoration.node(start.position, start.position + start.node.nodeSize, attributes, specification)];
  }
  return comment.anchor.kind === 'TEXT_RANGE' && from < to
    ? [Decoration.inline(from, to, attributes, specification)]
    : [Decoration.node(start.position, start.position + start.node.nodeSize, attributes, specification)];
}

interface ArticleElementPluginState {
  index: LocatedArticleElementIndex;
  decorations: DecorationSet;
  decorationByCommentId: ReadonlyMap<string, Decoration>;
  resolutionByCommentId: ReadonlyMap<string, ArticleCommentDto['targetResolution']>;
  hasElements: boolean;
}

function articleElementPluginState(
  document: ProseMirrorNode,
  comments: readonly ArticleCommentDto[],
): ArticleElementPluginState {
  const index = locatedArticleElementIndex(document);
  const decorations: Decoration[] = [];
  const decorationByCommentId = new Map<string, Decoration>();
  const resolutionByCommentId = new Map<string, ArticleCommentDto['targetResolution']>();
  for (const comment of comments) {
    const decoration = commentDecorations(document, index, comment)[0];
    if (!decoration) {
      resolutionByCommentId.set(comment.id, index.elements.length ? 'RELOCATED' : 'MISSING');
      continue;
    }
    decorations.push(decoration);
    decorationByCommentId.set(comment.id, decoration);
    resolutionByCommentId.set(comment.id, decoration.spec.relocated ? 'RELOCATED' : 'AVAILABLE');
  }
  return {
    index,
    decorations: DecorationSet.create(document, decorations),
    decorationByCommentId,
    resolutionByCommentId,
    hasElements: index.elements.length > 0,
  };
}

function mapArticleElementPluginState(
  transaction: Transaction,
  current: ArticleElementPluginState,
  comments: readonly ArticleCommentDto[],
): ArticleElementPluginState {
  const index = locatedArticleElementIndex(transaction.doc);
  const mapped = current.decorations.map(transaction.mapping, transaction.doc);
  const decorations = mapped.find();
  const decorationByCommentId = new Map(
    decorations.map((decoration) => [decoration.spec.commentId as string, decoration]),
  );
  const additions: Decoration[] = [];
  for (const comment of comments) {
    if (decorationByCommentId.has(comment.id)) continue;
    const decoration = commentDecorations(transaction.doc, index, comment, true)[0];
    if (!decoration) continue;
    additions.push(decoration);
    decorationByCommentId.set(comment.id, decoration);
  }
  const resolutionByCommentId = new Map<string, ArticleCommentDto['targetResolution']>();
  for (const comment of comments) {
    const decoration = decorationByCommentId.get(comment.id);
    resolutionByCommentId.set(
      comment.id,
      decoration
        ? decoration.spec.relocated
          ? 'RELOCATED'
          : 'AVAILABLE'
        : index.elements.length
          ? 'RELOCATED'
          : 'MISSING',
    );
  }
  return {
    index,
    decorations: additions.length ? DecorationSet.create(transaction.doc, [...decorations, ...additions]) : mapped,
    decorationByCommentId,
    resolutionByCommentId,
    hasElements: index.elements.length > 0,
  };
}

function articleElementIndexForEditor(editor: Editor) {
  const state = articleElementPluginKey.getState(editor.state) as ArticleElementPluginState | undefined;
  return state?.index ?? locatedArticleElementIndex(editor.state.doc);
}

export function createArticleElementIdentityExtension(comments: () => readonly ArticleCommentDto[]) {
  return Extension.create({
    name: 'articleElementIdentity',
    addGlobalAttributes() {
      return [
        {
          types: [...articleElementNodeTypes],
          attributes: {
            [ARTICLE_ELEMENT_ATTRIBUTE]: {
              default: null,
              rendered: false,
            },
          },
        },
      ];
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: articleElementPluginKey,
          state: {
            init: (_configuration, state) => articleElementPluginState(state.doc, comments()),
            apply(transaction, state) {
              if (transaction.getMeta(articleElementPluginKey)) {
                return articleElementPluginState(transaction.doc, comments());
              }
              return transaction.docChanged ? mapArticleElementPluginState(transaction, state, comments()) : state;
            },
          },
          appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((transaction) => transaction.docChanged)) return null;
            if (transactions.some(transactionHasCompositionOrigin)) return null;
            const state = articleElementPluginKey.getState(newState) as ArticleElementPluginState | undefined;
            return identityTransaction(newState.doc, newState.tr, state?.index.elements);
          },
          props: {
            decorations: (state) =>
              (articleElementPluginKey.getState(state) as ArticleElementPluginState | undefined)?.decorations ??
              DecorationSet.empty,
          },
        }),
      ];
    },
  });
}

export function reconcileArticleElementIdentities(editor: Editor, view: EditorView = editor.view) {
  if (editor.isDestroyed || view.composing) return false;
  const transaction = identityTransaction(
    editor.state.doc,
    editor.state.tr,
    articleElementIndexForEditor(editor).elements,
  );
  if (!transaction) return false;
  view.dispatch(transaction);
  return true;
}

export function hydrateArticleElements(
  editor: Editor,
  saved: readonly ArticleElementPlacementInput[],
  view: EditorView = editor.view,
) {
  if (editor.isDestroyed || view.composing) return false;
  const located = articleElementIndexForEditor(editor).elements;
  const unused = new Map(saved.map((placement) => [placement.elementId, placement]));
  const transaction = editor.state.tr;
  let changed = false;
  for (const item of located) {
    const matching = takeSavedArticleElement(saved, unused, articleElementPlacement(item));
    const elementId = matching?.elementId ?? nextArticleElementId();
    if (item.elementId === elementId) continue;
    transaction.setNodeAttribute(item.position, ARTICLE_ELEMENT_ATTRIBUTE, elementId);
    changed = true;
  }
  if (!changed) return false;
  transaction.setMeta(ARTICLE_ELEMENT_IDENTITY_META, 'hydrate' satisfies ArticleElementIdentityOrigin);
  transaction.setMeta('addToHistory', false);
  view.dispatch(transaction);
  return true;
}

export function articleElementPlacements(editor: Editor) {
  if (editor.isDestroyed) return [];
  return articleElementIndexForEditor(editor).elements.map(articleElementPlacement);
}

export function articleCheckBlocks(editor: Editor): ArticleCheckBlockInput[] {
  if (editor.isDestroyed) return [];
  return articleElementIndexForEditor(editor).elements.flatMap(({ node, elementId, blockIndex, nodeType }) => {
    if (!articleCheckNodeTypeSet.has(nodeType)) return [];
    const text = elementText(node);
    if (!text.trim()) return [];
    return [
      {
        elementId,
        blockIndex,
        nodeType,
        text,
      },
    ];
  });
}

function activeLocatedElement(editor: Editor) {
  const selection = editor.state.selection;
  const from = selection.from;
  const candidates = articleElementIndexForEditor(editor).elements.filter(
    (located) => located.position <= from && from <= located.position + located.node.nodeSize,
  );
  return candidates[candidates.length - 1] ?? null;
}

export function activeArticleElementId(editor: Editor) {
  return activeLocatedElement(editor)?.elementId || null;
}

export function activeArticleOutlineHeadingIndex(editor: Editor) {
  if (editor.isDestroyed) return null;
  return (
    locatedElementAtPosition(editor.state.doc, articleElementIndexForEditor(editor), editor.state.selection.from)
      ?.outlineHeadingIndex ?? null
  );
}

export function captureArticleEditorLocation(editor: Editor): ArticleEditorLocationDto | null {
  if (editor.isDestroyed) return null;
  return articleEditorLocationAtPosition(editor, editor.state.selection.from);
}

export function resolveArticleOutlineHeadingLocation(editor: Editor, sourceIndex: number) {
  if (editor.isDestroyed || !Number.isInteger(sourceIndex) || sourceIndex < 0) return null;
  const heading = articleElementIndexForEditor(editor).elements.filter(({ node }) => {
    const level = Number(node.attrs.level);
    return node.type.name === 'heading' && level >= 2 && level <= 6;
  })[sourceIndex];
  if (!heading?.elementId) return null;
  return {
    elementId: heading.elementId,
    relativeOffset: 0,
    blockIndex: heading.blockIndex,
  } satisfies ArticleEditorLocationDto;
}

function locatedElementAtPosition(document: ProseMirrorNode, index: LocatedArticleElementIndex, position: number) {
  const bounded = Math.max(0, Math.min(position, document.content.size));
  const probes = [bounded, Math.min(document.content.size, bounded + 1), Math.max(0, bounded - 1)];
  for (const probe of probes) {
    const resolved = document.resolve(probe);
    for (let depth = resolved.depth; depth >= 0; depth -= 1) {
      const elementId = resolved.node(depth).attrs[ARTICLE_ELEMENT_ATTRIBUTE];
      if (typeof elementId !== 'string') continue;
      const located = index.byId.get(elementId);
      if (located && located.position <= position && position <= located.position + located.node.nodeSize) {
        return located;
      }
    }
  }
  return index.elements
    .filter((candidate) => candidate.position <= position && position <= candidate.position + candidate.node.nodeSize)
    .at(-1);
}

function articleEditorLocationAtPositionInIndex(
  document: ProseMirrorNode,
  index: LocatedArticleElementIndex,
  position: number,
): ArticleEditorLocationDto | null {
  const located = locatedElementAtPosition(document, index, position);
  if (!located?.elementId) return null;
  const relativeOffset = Math.max(0, Math.min(position - located.position - 1, located.node.content.size));
  return { elementId: located.elementId, relativeOffset, blockIndex: located.blockIndex };
}

export function articleEditorLocationAtPosition(editor: Editor, position: number): ArticleEditorLocationDto | null {
  if (editor.isDestroyed) return null;
  return articleEditorLocationAtPositionInIndex(editor.state.doc, articleElementIndexForEditor(editor), position);
}

export interface CapturedArticleCommentTarget {
  anchor: ArticleCommentAnchorInput;
  preview: string;
  rect: ArticleCommentAnchorRect;
}

export interface ArticleCommentAnchorRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

function articleCommentRectSnapshot(rect: Pick<DOMRect, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>) {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  } satisfies ArticleCommentAnchorRect;
}

function articleCommentPositionRect(editor: Editor, position: number) {
  const bounded = Math.max(0, Math.min(position, editor.state.doc.content.size));
  const coordinates = editor.view.coordsAtPos(bounded);
  return articleCommentRectSnapshot({
    bottom: coordinates.bottom,
    height: Math.max(1, coordinates.bottom - coordinates.top),
    left: coordinates.left,
    right: coordinates.right,
    top: coordinates.top,
    width: Math.max(1, coordinates.right - coordinates.left),
  });
}

function articleCommentElementRect(editor: Editor, target: LocatedArticleElement) {
  const dom = editor.view.nodeDOM(target.position);
  return dom instanceof Element
    ? articleCommentRectSnapshot(dom.getBoundingClientRect())
    : articleCommentPositionRect(editor, target.position + 1);
}

function capturedWholeElementTarget(editor: Editor, target: LocatedArticleElement): CapturedArticleCommentTarget {
  const exactQuote = target.node.textContent.slice(0, 2_000);
  const from = target.position;
  const to = target.position + target.node.nodeSize;
  return {
    anchor: {
      kind: wholeElementAnchorKind(target.nodeType),
      startElementId: target.elementId,
      startOffset: 0,
      endElementId: target.elementId,
      endOffset: target.node.content.size,
      startBlockIndex: target.blockIndex,
      endBlockIndex: target.blockIndex,
      exactQuote,
      prefix: editor.state.doc.textBetween(Math.max(0, from - 200), from, ' ').slice(-200),
      suffix: editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 200), ' ').slice(0, 200),
    },
    preview: normalizedPreview(exactQuote || elementText(target.node)),
    rect: articleCommentElementRect(editor, target),
  };
}

export function captureArticleCommentTarget(editor: Editor): CapturedArticleCommentTarget | null {
  if (editor.isDestroyed || editor.view.composing) return null;
  const elements = articleElementIndexForEditor(editor).elements;
  const selection = editor.state.selection;
  const { from, to, empty } = selection;
  const start = elements
    .filter((element) => element.position <= from && from <= element.position + element.node.nodeSize)
    .at(-1);
  const endPosition = empty ? from : Math.max(from, to - 1);
  const end = elements
    .filter((element) => element.position <= endPosition && endPosition <= element.position + element.node.nodeSize)
    .at(-1);
  if (!start || !end) return null;
  const cellSelection = selection.constructor.name === 'CellSelection';
  const wholeTarget = empty
    ? start
    : selection instanceof NodeSelection
      ? (elements.find((element) => element.position === from) ?? start)
      : cellSelection
        ? start.elementId === end.elementId
          ? start
          : elements
              .filter(
                (element) =>
                  (element.nodeType === 'tableRow' || element.nodeType === 'table') &&
                  element.position <= from &&
                  endPosition <= element.position + element.node.nodeSize,
              )
              .at(-1)
        : null;
  if (wholeTarget) return capturedWholeElementTarget(editor, wholeTarget);
  const startOffset = Math.max(0, Math.min(from - start.position - 1, start.node.content.size));
  const endOffset = Math.max(0, Math.min(to - end.position - 1, end.node.content.size));
  const exactQuote = editor.state.doc.textBetween(from, to, ' ').slice(0, 2_000);
  return {
    anchor: {
      kind: 'TEXT_RANGE',
      startElementId: start.elementId,
      startOffset,
      endElementId: end.elementId,
      endOffset,
      startBlockIndex: start.blockIndex,
      endBlockIndex: end.blockIndex,
      exactQuote,
      prefix: editor.state.doc.textBetween(Math.max(0, from - 200), from, ' ').slice(-200),
      suffix: editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 200), ' ').slice(0, 200),
    },
    preview: normalizedPreview(exactQuote || elementText(start.node)),
    rect: articleCommentPositionRect(editor, to),
  };
}

export function articleCommentAnchorRect(editor: Editor, commentId: string): ArticleCommentAnchorRect | null {
  if (editor.isDestroyed) return null;
  const element = editor.view.dom.querySelector<HTMLElement>(`[data-article-comment-id="${CSS.escape(commentId)}"]`);
  return element ? articleCommentRectSnapshot(element.getBoundingClientRect()) : null;
}

function locatedForLocation(editor: Editor, location: ArticleEditorLocationDto) {
  const elements = articleElementIndexForEditor(editor).elements;
  return (
    elements.find((candidate) => candidate.elementId === location.elementId) ??
    (location.blockIndex === undefined
      ? null
      : elements.reduce<(typeof elements)[number] | null>((closest, candidate) => {
          if (!closest) return candidate;
          return Math.abs(candidate.blockIndex - location.blockIndex!) <
            Math.abs(closest.blockIndex - location.blockIndex!)
            ? candidate
            : closest;
        }, null))
  );
}

export function captureArticleViewportLocation(editor: Editor, scrollRoot: HTMLElement) {
  if (editor.isDestroyed) return null;
  const rootRect = scrollRoot.getBoundingClientRect();
  const editorRect = editor.view.dom.getBoundingClientRect();
  const position = editor.view.posAtCoords({
    left: Math.min(editorRect.right - 1, editorRect.left + ARTICLE_VIEWPORT_INSET_PX),
    top: rootRect.top + ARTICLE_VIEWPORT_INSET_PX,
  })?.pos;
  const elements = articleElementIndexForEditor(editor).elements;
  const located =
    (position === undefined
      ? null
      : elements
          .filter(
            (candidate) => candidate.position <= position && position <= candidate.position + candidate.node.nodeSize,
          )
          .at(-1)) ??
    elements.find((candidate) => {
      const dom = editor.view.nodeDOM(candidate.position);
      return dom instanceof Element && dom.getBoundingClientRect().bottom >= rootRect.top;
    });
  if (!located) return null;
  const elementDom = editor.view.nodeDOM(located.position);
  const viewportOffset =
    elementDom instanceof Element
      ? Math.max(0, Math.round(rootRect.top + ARTICLE_VIEWPORT_INSET_PX - elementDom.getBoundingClientRect().top))
      : undefined;
  return {
    elementId: located.elementId,
    relativeOffset:
      position === undefined ? 0 : Math.max(0, Math.min(position - located.position - 1, located.node.content.size)),
    blockIndex: located.blockIndex,
    ...(viewportOffset === undefined ? {} : { viewportOffset }),
  } satisfies ArticleEditorLocationDto;
}

export function revealArticleEditorLocation(
  editor: Editor,
  location: ArticleEditorLocationDto,
  scrollRoot: HTMLElement,
) {
  if (editor.isDestroyed) return false;
  const located = locatedForLocation(editor, location);
  if (!located) return false;
  const rootRect = scrollRoot.getBoundingClientRect();
  const elementDom = editor.view.nodeDOM(located.position);
  if (location.viewportOffset !== undefined && elementDom instanceof Element) {
    const elementRect = elementDom.getBoundingClientRect();
    const offset = Math.min(location.viewportOffset, Math.max(0, Math.round(elementRect.height)));
    scrollRoot.scrollTop +=
      elementRect.top + offset - rootRect.top - Math.min(ARTICLE_VIEWPORT_INSET_PX, rootRect.height / 4);
    return true;
  }
  const position = Math.min(
    located.position + 1 + location.relativeOffset,
    located.position + Math.max(located.node.nodeSize - 1, 1),
  );
  const coords = editor.view.coordsAtPos(position);
  scrollRoot.scrollTop += coords.top - rootRect.top - rootRect.height / 2;
  return true;
}

export function restoreArticleEditorLocation(editor: Editor, location: ArticleEditorLocationDto) {
  if (editor.isDestroyed) return false;
  const located = locatedForLocation(editor, location);
  if (!located) return false;
  const selection =
    located.node.type.name === 'image'
      ? NodeSelection.create(editor.state.doc, located.position)
      : TextSelection.near(
          editor.state.doc.resolve(
            Math.min(located.position + 1 + location.relativeOffset, located.position + located.node.nodeSize - 1),
          ),
        );
  const elementDom = editor.view.nodeDOM(located.position);
  editor.view.focus();
  const transaction = editor.state.tr.setSelection(selection);
  editor.view.dispatch(elementDom instanceof Element ? transaction : transaction.scrollIntoView());
  if (elementDom instanceof Element) {
    elementDom.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
  }
  return true;
}

export function resolveArticleCommentLocation(editor: Editor, commentId: string) {
  if (editor.isDestroyed) return null;
  const state = articleElementPluginKey.getState(editor.state) as ArticleElementPluginState | undefined;
  if (!state) return null;
  const decoration = state.decorationByCommentId.get(commentId);
  if (!decoration) return null;
  return articleEditorLocationAtPositionInIndex(editor.state.doc, state.index, decoration.from);
}

export function articleCommentTargetResolution(editor: Editor, commentId: string) {
  if (editor.isDestroyed) return 'MISSING' as const;
  const state = articleElementPluginKey.getState(editor.state) as ArticleElementPluginState | undefined;
  return state?.resolutionByCommentId.get(commentId) ?? (state?.hasElements ? 'RELOCATED' : 'MISSING');
}

export function mappedArticleCommentAnchors(
  editor: Editor,
  comments: readonly ArticleCommentDto[],
): ArticleCommentAnchorUpdateInput[] {
  if (editor.isDestroyed) return [];
  const state = articleElementPluginKey.getState(editor.state) as ArticleElementPluginState | undefined;
  if (!state) return [];
  const index = state.index;
  return comments.flatMap((comment) => {
    const decoration = state.decorationByCommentId.get(comment.id);
    if (!decoration || decoration.spec.relocated) return [];
    const start = articleEditorLocationAtPositionInIndex(editor.state.doc, index, decoration.from);
    if (!start) return [];
    if (comment.anchor.kind !== 'TEXT_RANGE') {
      const located = index.byId.get(start.elementId);
      if (!located) return [];
      const exactQuote = located.node.textContent.slice(0, 2_000);
      return [
        {
          commentId: comment.id,
          anchor: {
            ...comment.anchor,
            startElementId: start.elementId,
            endElementId: start.elementId,
            startOffset: 0,
            endOffset: located.node.content.size,
            startBlockIndex: located.blockIndex,
            endBlockIndex: located.blockIndex,
            exactQuote,
          },
        },
      ];
    }
    const endPosition = Math.max(decoration.from, decoration.to - 1);
    const end = articleEditorLocationAtPositionInIndex(editor.state.doc, index, endPosition);
    if (!end) return [];
    const exactQuote = editor.state.doc.textBetween(decoration.from, decoration.to, ' ').slice(0, 2_000);
    return [
      {
        commentId: comment.id,
        anchor: {
          ...comment.anchor,
          startElementId: start.elementId,
          endElementId: end.elementId,
          startOffset: start.relativeOffset,
          endOffset: end.relativeOffset + 1,
          startBlockIndex: start.blockIndex ?? comment.anchor.startBlockIndex,
          endBlockIndex: end.blockIndex ?? comment.anchor.endBlockIndex,
          exactQuote,
          prefix: editor.state.doc.textBetween(Math.max(0, decoration.from - 200), decoration.from, ' ').slice(-200),
          suffix: editor.state.doc
            .textBetween(decoration.to, Math.min(editor.state.doc.content.size, decoration.to + 200), ' ')
            .slice(0, 200),
        },
      },
    ];
  });
}

export function focusArticleElement(editor: Editor, elementId: string) {
  return restoreArticleEditorLocation(editor, { elementId, relativeOffset: 0 });
}

export function refreshArticleElementDecorations(editor: Editor, view: EditorView = editor.view) {
  if (editor.isDestroyed || view.composing) return false;
  view.dispatch(editor.state.tr.setMeta(articleElementPluginKey, true).setMeta('addToHistory', false));
  return true;
}

export function articleElementIdentityTransaction(transaction: { getMeta(key: string): unknown }) {
  return transaction.getMeta(ARTICLE_ELEMENT_IDENTITY_META) === 'identity';
}
