import { Extension, mergeAttributes, Node, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  BookOpenIcon,
  BracesIcon,
  ChevronDownIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  ShuffleIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import type { TermListItem } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useLatestMicrotask } from '@/renderer/hooks/useLatestMicrotask';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { analyzePalettePrompt } from '@/renderer/components/palette/wordPalettePromptRecognition';
import {
  activeWordPaletteTermDrag,
  clearWordPaletteTermDrag,
  readWordPaletteTermDrag,
  writeWordPaletteTermDrag,
  type WordPaletteTermDragPayload,
} from '@/renderer/components/palette/wordPaletteInteractions';
import {
  renderPaletteOptionPrompt,
  type PaletteParameterDraft,
  type PaletteParameterOptionDraft,
} from '@/renderer/components/palette/wordPaletteOptions';
import type { PromptDocumentNode } from '@/renderer/components/palette/wordPalettePromptDocument';

const TERM_NODE = 'paletteTerm';
const CHOICE_NODE = 'paletteChoice';
const recognitionPluginKey = new PluginKey<DecorationSet>('wordPalettePromptRecognition');
let editorNodeSerial = 0;

function nextEditorKey(prefix: string) {
  editorNodeSerial += 1;
  return `${prefix}_${Date.now().toString(36)}_${editorNodeSerial.toString(36)}`;
}

interface ChoiceSnapshotOption {
  value: string;
  label: string;
  promptText: string;
}

interface ChoiceSnapshot {
  stableKey: string;
  label: string;
  options: ChoiceSnapshotOption[];
}

type ChoiceSeed = { kind: 'TERM'; term: TermListItem } | { kind: 'PROMPT'; text: string };

interface PaletteBridgeCallbacks {
  createChoice(seeds: ChoiceSeed[]): PaletteParameterDraft;
  addTermToChoice(stableKey: string, term: TermListItem): PaletteParameterDraft | null;
  setChoiceDefault(stableKey: string, optionIndex: number): PaletteParameterDraft | null;
  removeChoice(stableKey: string): void;
  requestCombine(term: TermListItem, nodeKey?: string): void;
  requestCombineSelection(text: string, sourceTerm?: TermListItem): void;
  nodesChanged(nodes: PromptDocumentNode[]): void;
  selectionChanged(text: string | null): void;
  reportChoiceIssue(reason: 'duplicate' | 'conflict'): void;
}

interface PaletteBridgeStorage {
  terms: TermListItem[];
  termsById: Map<string, TermListItem>;
  groupsByKey: Map<string, PaletteParameterDraft>;
  callbacks: PaletteBridgeCallbacks;
}

function paletteBridge(editor: Editor) {
  return (editor.storage as unknown as Record<string, PaletteBridgeStorage>).wordPaletteBridge;
}

function optionLabel(option: PaletteParameterOptionDraft, termsById: ReadonlyMap<string, TermListItem>) {
  const termNames = option.termIds.flatMap((termId) => termsById.get(termId)?.title ?? []);
  return termNames.join(' + ') || option.promptFragment.trim() || option.label;
}

function choiceSnapshot(group: PaletteParameterDraft, termsById: ReadonlyMap<string, TermListItem>): ChoiceSnapshot {
  return {
    stableKey: group.stableKey,
    label: group.name,
    options: group.options.map((option) => ({
      value: option.value,
      label: optionLabel(option, termsById),
      promptText: renderPaletteOptionPrompt(option, termsById),
    })),
  };
}

function choiceNodeAttributes(group: PaletteParameterDraft, termsById: ReadonlyMap<string, TermListItem>) {
  const snapshot = choiceSnapshot(group, termsById);
  return {
    editorKey: nextEditorKey('choice'),
    stableKey: snapshot.stableKey,
    label: snapshot.label,
    options: snapshot.options,
    promptText: snapshot.options[0]?.promptText ?? '',
  };
}

function termNodeAttributes(term: TermListItem, editorKey = nextEditorKey('term')) {
  return {
    editorKey,
    termId: term.id,
    label: term.title,
    promptText: term.modelExpressions[0]?.positive ?? term.title,
  };
}

function dragPayload(event: ReactDragEvent, term: TermListItem, nodeKey: string) {
  writeWordPaletteTermDrag(event.dataTransfer, {
    termId: term.id,
    origin: 'editor',
    nodeKey,
    plainText: term.modelExpressions[0]?.positive || term.title,
  });
}

function PaletteTermNodeView({ editor, node }: NodeViewProps) {
  const bridge = paletteBridge(editor);
  const term = bridge.termsById.get(String(node.attrs.termId));
  const nodeKey = String(node.attrs.editorKey);
  if (!term)
    return (
      <NodeViewWrapper as="span" className="rounded border px-1 text-destructive">
        {String(node.attrs.label)}
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper
      as="span"
      data-palette-term-node=""
      data-palette-term-id={term.id}
      data-palette-node-key={nodeKey}
      data-drag-handle=""
      draggable
      contentEditable={false}
      className="mx-0.5 inline-flex h-8 max-w-full cursor-grab select-none items-center gap-1.5 rounded-lg border border-success/35 bg-success-surface px-2 align-middle text-sm text-foreground active:cursor-grabbing"
      onDragStart={(event: ReactDragEvent<HTMLSpanElement>) => dragPayload(event, term, nodeKey)}
      onDragEnd={clearWordPaletteTermDrag}
      onContextMenu={(event: React.MouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        bridge.callbacks.requestCombine(term, nodeKey);
      }}
    >
      <BookOpenIcon className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{term.title}</span>
    </NodeViewWrapper>
  );
}

function snapshotOptions(value: unknown): ChoiceSnapshotOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) =>
    option &&
    typeof option === 'object' &&
    typeof (option as ChoiceSnapshotOption).value === 'string' &&
    typeof (option as ChoiceSnapshotOption).label === 'string' &&
    typeof (option as ChoiceSnapshotOption).promptText === 'string'
      ? [option as ChoiceSnapshotOption]
      : [],
  );
}

function PaletteChoiceNodeView({ editor, node, getPos }: NodeViewProps) {
  const l = useI18n().messages.recipe.editor;
  const [open, setOpen] = useState(false);
  const bridge = paletteBridge(editor);
  const stableKey = String(node.attrs.stableKey);
  const options = snapshotOptions(node.attrs.options);
  const visibleOptionLabels = options.slice(0, 2).map((option) => option.label);
  const optionSummary = `${visibleOptionLabels.join(' / ')}${options.length > 2 ? ` +${options.length - 2}` : ''}`;
  const fullOptionSummary = options.map((option) => option.label).join(' / ');

  function choose(index: number) {
    const updated = bridge.callbacks.setChoiceDefault(stableKey, index);
    if (updated) {
      const position = getPos();
      if (typeof position === 'number') {
        editor.view.dispatch(
          editor.state.tr
            .setNodeMarkup(position, undefined, {
              ...choiceNodeAttributes(updated, bridge.termsById),
              editorKey: String(node.attrs.editorKey),
            })
            .setMeta('addToHistory', false),
        );
      }
    }
    setOpen(false);
  }

  function remove() {
    bridge.callbacks.removeChoice(stableKey);
    const position = getPos();
    if (typeof position === 'number') {
      const range = atomRemovalRange(editor, position, node.nodeSize);
      editor.chain().focus().deleteRange(range).run();
    }
    setOpen(false);
  }

  return (
    <NodeViewWrapper
      as="span"
      data-palette-choice-node=""
      data-palette-choice-key={stableKey}
      data-palette-node-key={String(node.attrs.editorKey)}
      data-palette-choice-label={optionSummary || String(node.attrs.label)}
      contentEditable={false}
      className="mx-0.5 inline-flex max-w-full rounded-lg align-middle"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-8 min-w-0 max-w-full gap-1.5 rounded-lg border-warning/45 bg-warning-surface px-2 font-normal text-foreground hover:bg-warning-surface"
            onMouseDown={(event) => event.stopPropagation()}
            aria-label={`${String(node.attrs.label)}${fullOptionSummary ? `: ${fullOptionSummary}` : ''}`}
            title={fullOptionSummary || String(node.attrs.label)}
          >
            <ShuffleIcon className="size-4" />
            <span className="max-w-56 truncate">{optionSummary || String(node.attrs.label)}</span>
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1.5" onOpenAutoFocus={(event) => event.preventDefault()}>
          <div className="grid gap-1">
            {options.map((option, index) => (
              <Button
                key={option.value}
                type="button"
                variant={index === 0 ? 'secondary' : 'ghost'}
                className="h-auto min-h-8 justify-start whitespace-normal px-2 py-1.5 text-left font-normal"
                onClick={() => choose(index)}
              >
                {option.label}
              </Button>
            ))}
            <div className="mt-1 border-t pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-destructive"
                onClick={remove}
              >
                <Trash2Icon className="size-4" />
                {l.removeChoiceGroup}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

const PaletteTermNode = Node.create({
  name: TERM_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      editorKey: { default: '' },
      termId: { default: '' },
      label: { default: '' },
      promptText: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-palette-term-node]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-palette-term-node': '' })];
  },
  renderText({ node }) {
    return String(node.attrs.promptText);
  },
  addNodeView() {
    return ReactNodeViewRenderer(PaletteTermNodeView);
  },
});

const PaletteChoiceNode = Node.create({
  name: CHOICE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      editorKey: { default: '' },
      stableKey: { default: '' },
      label: { default: '' },
      options: { default: [] },
      promptText: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-palette-choice-node]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-palette-choice-node': '' })];
  },
  renderText({ node }) {
    return String(node.attrs.promptText);
  },
  addNodeView() {
    return ReactNodeViewRenderer(PaletteChoiceNodeView);
  },
});

function recognitionDecorations(editor: Editor, doc: Parameters<typeof DecorationSet.create>[0]) {
  const decorations: Decoration[] = [];
  const terms = paletteBridge(editor).terms;
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const analysis = analyzePalettePrompt(node.text, terms);
    for (const match of analysis.matches) {
      decorations.push(
        Decoration.inline(position + match.start, position + match.end, {
          class:
            match.kind === 'EXACT'
              ? 'cursor-context-menu rounded border border-success/35 bg-success-surface px-0.5'
              : 'cursor-context-menu rounded border border-dashed border-info/50 bg-info-surface px-0.5',
          'data-palette-recognition': match.kind,
          'data-palette-recognition-term-id': match.term.id,
          'data-palette-recognition-label': match.term.title,
          'data-palette-recognition-from': String(position + match.start),
          'data-palette-recognition-to': String(position + match.end),
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

const WordPaletteBridge = Extension.create({
  name: 'wordPaletteBridge',
  addStorage(): PaletteBridgeStorage {
    return {
      terms: [],
      termsById: new Map(),
      groupsByKey: new Map(),
      callbacks: {
        createChoice: () => {
          throw new Error('Word palette bridge is not ready');
        },
        addTermToChoice: () => null,
        setChoiceDefault: () => null,
        removeChoice: () => undefined,
        requestCombine: () => undefined,
        requestCombineSelection: () => undefined,
        nodesChanged: () => undefined,
        selectionChanged: () => undefined,
        reportChoiceIssue: () => undefined,
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<DecorationSet>({
        key: recognitionPluginKey,
        state: {
          init: (_, state) => recognitionDecorations(editor, state.doc),
          apply: (transaction, current) =>
            transaction.docChanged || transaction.getMeta(recognitionPluginKey)
              ? recognitionDecorations(editor, transaction.doc)
              : current.map(transaction.mapping, transaction.doc),
        },
        props: { decorations: (state) => recognitionPluginKey.getState(state) },
      }),
    ];
  },
});

function editorJsonFromDocument(
  nodes: readonly PromptDocumentNode[],
  termsById: ReadonlyMap<string, TermListItem>,
  groupsByKey: ReadonlyMap<string, PaletteParameterDraft>,
) {
  const paragraphs: Array<{ type: 'paragraph'; content: Array<Record<string, unknown>> }> = [
    { type: 'paragraph', content: [] },
  ];
  const paragraph = () => paragraphs.at(-1)!;
  const appendText = (value: string) => {
    const lines = value.split('\n');
    lines.forEach((line, index) => {
      if (line) {
        const last = paragraph().content.at(-1);
        if (last?.type === 'text') last.text = `${String(last.text ?? '')}${line}`;
        else paragraph().content.push({ type: 'text', text: line });
      }
      if (index < lines.length - 1) paragraphs.push({ type: 'paragraph', content: [] });
    });
  };
  for (const node of nodes) {
    if (node.kind === 'TEXT') {
      appendText(node.promptFragment);
      continue;
    }
    if (node.kind === 'TERM') {
      const term = termsById.get(node.termId);
      if (term) paragraph().content.push({ type: TERM_NODE, attrs: termNodeAttributes(term, node.editorKey) });
      continue;
    }
    const group = groupsByKey.get(node.stableKey);
    if (group)
      paragraph().content.push({
        type: CHOICE_NODE,
        attrs: { ...choiceNodeAttributes(group, termsById), editorKey: node.editorKey },
      });
  }
  return { type: 'doc', content: paragraphs };
}

function documentFromEditor(editor: Editor): PromptDocumentNode[] {
  const nodes: PromptDocumentNode[] = [];
  const appendText = (value: string) => {
    if (!value) return;
    const previous = nodes.at(-1);
    if (previous?.kind === 'TEXT') previous.promptFragment += value;
    else nodes.push({ kind: 'TEXT', editorKey: nextEditorKey('text'), promptFragment: value });
  };
  const json = editor.getJSON();
  for (const [paragraphIndex, paragraph] of (json.content ?? []).entries()) {
    if (paragraphIndex > 0) appendText('\n');
    for (const rawChild of paragraph.content ?? []) {
      const child = rawChild as { type?: string; text?: string; attrs?: Record<string, unknown> };
      if (child.type === 'text') appendText(child.text ?? '');
      else if (child.type === 'hardBreak') appendText('\n');
      else if (child.type === TERM_NODE)
        nodes.push({
          kind: 'TERM',
          editorKey: String(child.attrs?.editorKey ?? nextEditorKey('term')),
          termId: String(child.attrs?.termId ?? ''),
        });
      else if (child.type === CHOICE_NODE)
        nodes.push({
          kind: 'SLOT',
          editorKey: String(child.attrs?.editorKey ?? nextEditorKey('choice')),
          stableKey: String(child.attrs?.stableKey ?? ''),
        });
    }
  }
  return nodes.length ? nodes : [{ kind: 'TEXT', editorKey: nextEditorKey('text'), promptFragment: '' }];
}

function findNodePosition(editor: Editor, editorKey: string) {
  let found = -1;
  editor.state.doc.descendants((node, position) => {
    if (found >= 0) return false;
    if (
      (node.type.name === TERM_NODE || node.type.name === CHOICE_NODE) &&
      String(node.attrs.editorKey) === editorKey
    ) {
      found = position;
      return false;
    }
    return undefined;
  });
  return found;
}

function findTermPosition(editor: Editor, termId: string, excludedEditorKey?: string) {
  let found = -1;
  editor.state.doc.descendants((node, position) => {
    if (found >= 0) return false;
    if (
      node.type.name === TERM_NODE &&
      String(node.attrs.termId) === termId &&
      String(node.attrs.editorKey) !== excludedEditorKey
    ) {
      found = position;
      return false;
    }
    return undefined;
  });
  return found;
}

function atomRemovalRange(editor: Editor, position: number, nodeSize: number, towardPosition?: number) {
  const before = editor.state.doc.resolve(position).nodeBefore;
  const after = editor.state.doc.resolve(position + nodeSize).nodeAfter;
  const beforeIsSeparator = Boolean(before?.isText && /^\s*[,，;；|]\s*$/.test(before.text ?? ''));
  const afterIsSeparator = Boolean(after?.isText && /^\s*[,，;；|]\s*$/.test(after.text ?? ''));
  const preferAfter = towardPosition === undefined || position < towardPosition;
  if (preferAfter && afterIsSeparator) return { from: position, to: position + nodeSize + (after?.nodeSize ?? 0) };
  if (!preferAfter && beforeIsSeparator) return { from: position - (before?.nodeSize ?? 0), to: position + nodeSize };
  if (afterIsSeparator) return { from: position, to: position + nodeSize + (after?.nodeSize ?? 0) };
  if (beforeIsSeparator) return { from: position - (before?.nodeSize ?? 0), to: position + nodeSize };
  return { from: position, to: position + nodeSize };
}

function mergedRanges(ranges: Array<{ from: number; to: number }>) {
  const merged: Array<{ from: number; to: number }> = [];
  for (const range of ranges.sort((left, right) => left.from - right.from || left.to - right.to)) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function selectedPlainText(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  let containsAtom = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === TERM_NODE || node.type.name === CHOICE_NODE) containsAtom = true;
  });
  if (containsAtom) return null;
  const text = editor.state.doc.textBetween(from, to, '\n').trim();
  return text || null;
}

function replaceSelectionWithChoice(editor: Editor, term: TermListItem, sourceTerm?: TermListItem) {
  const text = selectedPlainText(editor);
  if (!text) return false;
  const group = paletteBridge(editor).callbacks.createChoice([
    sourceTerm ? { kind: 'TERM', term: sourceTerm } : { kind: 'PROMPT', text },
    { kind: 'TERM', term },
  ]);
  editor
    .chain()
    .focus()
    .insertContent({
      type: CHOICE_NODE,
      attrs: choiceNodeAttributes(group, paletteBridge(editor).termsById),
    })
    .run();
  return true;
}

function deleteDraggedSource(
  transaction: Transaction,
  editor: Editor,
  payload: WordPaletteTermDragPayload,
  towardPosition?: number,
) {
  if (payload.origin !== 'editor') return transaction;
  const sourcePosition = payload.nodeKey ? findNodePosition(editor, payload.nodeKey) : -1;
  const sourceNode = sourcePosition >= 0 ? editor.state.doc.nodeAt(sourcePosition) : null;
  if (!sourceNode) return transaction;
  const range = atomRemovalRange(editor, sourcePosition, sourceNode.nodeSize, towardPosition);
  return transaction.delete(range.from, range.to);
}

function deleteDraggedAtomOnly(transaction: Transaction, editor: Editor, payload: WordPaletteTermDragPayload) {
  if (payload.origin !== 'editor' || !payload.nodeKey) return transaction;
  const sourcePosition = findNodePosition(editor, payload.nodeKey);
  const sourceNode = sourcePosition >= 0 ? editor.state.doc.nodeAt(sourcePosition) : null;
  return sourceNode ? transaction.delete(sourcePosition, sourcePosition + sourceNode.nodeSize) : transaction;
}

type PaletteDropTarget = {
  element: HTMLElement | null;
  intent: 'combine' | 'add';
  kind: 'term' | 'choice' | 'recognition' | 'selection';
  rect: DOMRect;
  label?: string;
};

type PaletteDropPreview =
  | {
      intent: 'combine' | 'add';
      left: number;
      top: number;
      sourceLabel: string;
      targetLabel: string;
      targetRect: { left: number; top: number; width: number; height: number };
    }
  | {
      intent: 'insert';
      left: number;
      top: number;
      height: number;
    };

const DROP_TARGET_SLOP = 10;
const DROP_INSERT_EDGE = 5;
const DROP_TARGET_SELECTOR = '[data-palette-term-node], [data-palette-choice-node], [data-palette-recognition-term-id]';

function rectDistance(rect: DOMRect, x: number, y: number) {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

function resolveDropTarget(
  view: EditorView,
  event: Pick<DragEvent, 'clientX' | 'clientY'>,
  payload: WordPaletteTermDragPayload,
) {
  const candidates: PaletteDropTarget[] = [];
  for (const element of view.dom.querySelectorAll<HTMLElement>(DROP_TARGET_SELECTOR)) {
    if (element.dataset.paletteNodeKey && element.dataset.paletteNodeKey === payload.nodeKey) continue;
    if (element.dataset.paletteTermId === payload.termId || element.dataset.paletteRecognitionTermId === payload.termId)
      continue;
    const kind: PaletteDropTarget['kind'] = element.matches('[data-palette-choice-node]')
      ? 'choice'
      : element.matches('[data-palette-recognition-term-id]')
        ? 'recognition'
        : 'term';
    for (const rect of element.getClientRects()) {
      if (rectDistance(rect, event.clientX, event.clientY) > DROP_TARGET_SLOP) continue;
      const nearInsertionEdge =
        event.clientX <= rect.left + DROP_INSERT_EDGE || event.clientX >= rect.right - DROP_INSERT_EDGE;
      if (nearInsertionEdge) continue;
      candidates.push({
        element,
        intent: kind === 'choice' ? 'add' : 'combine',
        kind,
        rect,
      });
    }
  }
  const semanticTarget = candidates.sort(
    (left, right) =>
      rectDistance(left.rect, event.clientX, event.clientY) - rectDistance(right.rect, event.clientX, event.clientY) ||
      left.rect.width - right.rect.width,
  )[0];
  if (semanticTarget) return semanticTarget;

  const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const { from, to, empty } = view.state.selection;
  if (!empty && coordinates && coordinates.pos >= from && coordinates.pos <= to) {
    let containsAtom = false;
    view.state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === TERM_NODE || node.type.name === CHOICE_NODE) containsAtom = true;
    });
    const label = containsAtom ? '' : view.state.doc.textBetween(from, to, '\n').trim();
    if (label) {
      const nativeSelection = window.getSelection();
      const nativeRange = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0) : null;
      const nativeRect =
        nativeRange && view.dom.contains(nativeRange.commonAncestorContainer)
          ? nativeRange.getBoundingClientRect()
          : null;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const rect =
        nativeRect && nativeRect.width > 0
          ? nativeRect
          : new DOMRect(
              start.left,
              Math.min(start.top, end.top),
              Math.max(2, end.right - start.left),
              Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top),
            );
      return { element: null, intent: 'combine', kind: 'selection', rect, label } satisfies PaletteDropTarget;
    }
  }
  return null;
}

function targetLabel(target: PaletteDropTarget, termsById: ReadonlyMap<string, TermListItem>) {
  if (target.kind === 'selection') return target.label ?? '';
  if (!target.element) return '';
  if (target.kind === 'choice') return target.element.dataset.paletteChoiceLabel ?? '';
  const termId =
    target.kind === 'recognition'
      ? target.element.dataset.paletteRecognitionTermId
      : target.element.dataset.paletteTermId;
  return (
    (termId && termsById.get(termId)?.title) ||
    target.element.dataset.paletteRecognitionLabel ||
    target.element.textContent?.trim() ||
    ''
  );
}

function dropTerm(
  editor: Editor,
  view: EditorView,
  event: DragEvent,
  payload: WordPaletteTermDragPayload,
  resolvedTarget = resolveDropTarget(view, event, payload),
) {
  const bridge = paletteBridge(editor);
  const term = bridge.termsById.get(payload.termId);
  if (!term) return false;
  const target = resolvedTarget?.element ?? null;

  if (target?.matches('[data-palette-term-node]')) {
    const targetKey = target.dataset.paletteNodeKey ?? '';
    if (targetKey && targetKey === payload.nodeKey) return true;
    const targetPosition = findNodePosition(editor, targetKey);
    const targetNode = targetPosition >= 0 ? editor.state.doc.nodeAt(targetPosition) : null;
    const targetTerm = targetNode ? bridge.termsById.get(String(targetNode.attrs.termId)) : null;
    if (!targetNode || !targetTerm || targetTerm.id === term.id) return true;
    const group = bridge.callbacks.createChoice([
      { kind: 'TERM', term: targetTerm },
      { kind: 'TERM', term },
    ]);
    let transaction = editor.state.tr;
    transaction = deleteDraggedSource(transaction, editor, payload, targetPosition);
    const mappedTarget = transaction.mapping.map(targetPosition);
    transaction.replaceWith(
      mappedTarget,
      mappedTarget + targetNode.nodeSize,
      editor.schema.nodes[CHOICE_NODE].create(choiceNodeAttributes(group, bridge.termsById)),
    );
    view.dispatch(transaction.scrollIntoView());
    return true;
  }

  if (target?.matches('[data-palette-recognition-term-id]')) {
    const targetTermId = target.dataset.paletteRecognitionTermId ?? '';
    const targetTerm = bridge.termsById.get(targetTermId);
    const from = Number(target.dataset.paletteRecognitionFrom);
    const to = Number(target.dataset.paletteRecognitionTo);
    if (!targetTerm || targetTerm.id === term.id || !Number.isInteger(from) || !Number.isInteger(to) || from >= to)
      return true;
    const targetText = editor.state.doc.textBetween(from, to, '\n').trim();
    const targetSeed: ChoiceSeed =
      target.dataset.paletteRecognition === 'EXACT'
        ? { kind: 'TERM', term: targetTerm }
        : { kind: 'PROMPT', text: targetText };
    const group = bridge.callbacks.createChoice([targetSeed, { kind: 'TERM', term }]);
    let transaction = editor.state.tr;
    transaction = deleteDraggedSource(transaction, editor, payload, from);
    const mappedFrom = transaction.mapping.map(from);
    const mappedTo = transaction.mapping.map(to);
    transaction.replaceWith(
      mappedFrom,
      mappedTo,
      editor.schema.nodes[CHOICE_NODE].create(choiceNodeAttributes(group, bridge.termsById)),
    );
    view.dispatch(transaction.scrollIntoView());
    return true;
  }

  if (target?.matches('[data-palette-choice-node]')) {
    const targetKey = target.dataset.paletteNodeKey ?? '';
    const targetPosition = findNodePosition(editor, targetKey);
    const targetNode = targetPosition >= 0 ? editor.state.doc.nodeAt(targetPosition) : null;
    if (!targetNode) return true;
    const previousGroup = bridge.groupsByKey.get(String(targetNode.attrs.stableKey));
    const group = bridge.callbacks.addTermToChoice(String(targetNode.attrs.stableKey), term);
    if (!group) {
      bridge.callbacks.reportChoiceIssue('conflict');
      return true;
    }
    if (previousGroup && group.options.length <= previousGroup.options.length) {
      bridge.callbacks.reportChoiceIssue('duplicate');
      return true;
    }
    let transaction = editor.state.tr;
    transaction = deleteDraggedSource(transaction, editor, payload, targetPosition);
    const mappedTarget = transaction.mapping.map(targetPosition);
    transaction.setNodeMarkup(mappedTarget, undefined, {
      ...choiceNodeAttributes(group, bridge.termsById),
      editorKey: String(targetNode.attrs.editorKey),
    });
    transaction.setMeta('addToHistory', false);
    view.dispatch(transaction.scrollIntoView());
    return true;
  }

  const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coordinates) return true;
  const { from, to, empty } = editor.state.selection;
  if (
    !empty &&
    coordinates.pos >= from &&
    coordinates.pos <= to &&
    selectedPlainText(editor) &&
    replaceSelectionWithChoice(editor, term)
  )
    return true;
  let transaction = editor.state.tr;
  transaction = deleteDraggedAtomOnly(transaction, editor, payload);
  const position = transaction.mapping.map(coordinates.pos);
  transaction.insert(
    position,
    editor.schema.nodes[TERM_NODE].create(
      termNodeAttributes(term, payload.origin === 'editor' && payload.nodeKey ? payload.nodeKey : undefined),
    ),
  );
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export interface WordPaletteInlinePromptEditorHandle {
  insertTerm(term: TermListItem): void;
  removeTerm(termId: string): void;
  clearTerms(): void;
  combineTerms(source: TermListItem, target: TermListItem, sourceNodeKey?: string): void;
  combineSelectionWithTerm(term: TermListItem, sourceTerm?: TermListItem): boolean;
  selectedText(): string | null;
}

interface Props {
  nodes: PromptDocumentNode[];
  terms: TermListItem[];
  groups: PaletteParameterDraft[];
  selectedText: string | null;
  fullWindow: boolean;
  onNodesChange(nodes: PromptDocumentNode[]): void;
  onSelectionChange(text: string | null): void;
  onRequestCombineSelection(text?: string, sourceTerm?: TermListItem): void;
  onCreateChoice(seeds: ChoiceSeed[]): PaletteParameterDraft;
  onAddTermToChoice(stableKey: string, term: TermListItem): PaletteParameterDraft | null;
  onSetChoiceDefault(stableKey: string, optionIndex: number): PaletteParameterDraft | null;
  onRemoveChoice(stableKey: string): void;
  onRequestCombine(term: TermListItem, nodeKey?: string): void;
  onFullWindowChange(open: boolean): void;
}

export const WordPaletteInlinePromptEditor = forwardRef<WordPaletteInlinePromptEditorHandle, Props>(
  function WordPaletteInlinePromptEditor(
    {
      nodes,
      terms,
      groups,
      selectedText,
      fullWindow,
      onNodesChange,
      onSelectionChange,
      onRequestCombineSelection,
      onCreateChoice,
      onAddTermToChoice,
      onSetChoiceDefault,
      onRemoveChoice,
      onRequestCombine,
      onFullWindowChange,
    },
    ref,
  ) {
    const l = useI18n().messages.recipe.editor;
    const termsById = useMemo(() => new Map(terms.map((term) => [term.id, term])), [terms]);
    const groupsByKey = useMemo(() => new Map(groups.map((group) => [group.stableKey, group])), [groups]);
    const [dropPreview, setDropPreview] = useState<PaletteDropPreview | null>(null);
    const [interactionNotice, setInteractionNotice] = useState('');
    const activeDropTargetRef = useRef<PaletteDropTarget | null>(null);
    const reportChoiceIssue = useCallback(
      (reason: 'duplicate' | 'conflict') => {
        setInteractionNotice(reason === 'duplicate' ? l.choiceAlreadyExists : l.choiceConflict);
      },
      [l.choiceAlreadyExists, l.choiceConflict],
    );
    const clearDropFeedback = useCallback(() => {
      activeDropTargetRef.current = null;
      setDropPreview(null);
    }, []);
    const updateDropFeedback = useCallback(
      (view: EditorView, event: DragEvent, payload: WordPaletteTermDragPayload) => {
        const target = resolveDropTarget(view, event, payload);
        activeDropTargetRef.current = target;
        if (target) {
          event.dataTransfer!.dropEffect = 'link';
          setDropPreview({
            intent: target.intent,
            left: target.rect.left + target.rect.width / 2,
            top: target.rect.top - 8,
            sourceLabel: termsById.get(payload.termId)?.title || payload.plainText,
            targetLabel: targetLabel(target, termsById),
            targetRect: {
              left: target.rect.left,
              top: target.rect.top,
              width: target.rect.width,
              height: target.rect.height,
            },
          });
          return target;
        }
        activeDropTargetRef.current = null;
        event.dataTransfer!.dropEffect = payload.origin === 'editor' ? 'move' : 'copy';
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!position) {
          setDropPreview(null);
          return null;
        }
        const coordinates = view.coordsAtPos(position.pos);
        setDropPreview({
          intent: 'insert',
          left: coordinates.left,
          top: coordinates.top,
          height: Math.max(20, coordinates.bottom - coordinates.top),
        });
        return null;
      },
      [termsById],
    );
    const callbacksRef = useRef<PaletteBridgeCallbacks>({
      createChoice: onCreateChoice,
      addTermToChoice: onAddTermToChoice,
      setChoiceDefault: onSetChoiceDefault,
      removeChoice: onRemoveChoice,
      requestCombine: onRequestCombine,
      requestCombineSelection: onRequestCombineSelection,
      nodesChanged: onNodesChange,
      selectionChanged: onSelectionChange,
      reportChoiceIssue,
    });
    callbacksRef.current = {
      createChoice: onCreateChoice,
      addTermToChoice: onAddTermToChoice,
      setChoiceDefault: onSetChoiceDefault,
      removeChoice: onRemoveChoice,
      requestCombine: onRequestCombine,
      requestCombineSelection: onRequestCombineSelection,
      nodesChanged: onNodesChange,
      selectionChanged: onSelectionChange,
      reportChoiceIssue,
    };
    useEffect(() => {
      if (!interactionNotice) return;
      const timer = window.setTimeout(() => setInteractionNotice(''), 3000);
      return () => window.clearTimeout(timer);
    }, [interactionNotice]);
    const initialContent = useMemo(() => editorJsonFromDocument(nodes, termsById, groupsByKey), []);
    const tiptapEditorRef = useRef<Editor | null>(null);
    const editor: Editor | null = useEditor({
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          heading: false,
          horizontalRule: false,
          listItem: false,
          orderedList: false,
        }),
        PaletteTermNode,
        PaletteChoiceNode,
        WordPaletteBridge,
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class:
            'min-h-40 min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-4 py-3 text-md leading-8 text-foreground outline-none [&_p]:min-h-8 [&_p+p]:mt-1',
          'aria-label': l.prompt,
        },
        handleDOMEvents: {
          dragover: (view, rawEvent) => {
            const event = rawEvent as DragEvent;
            if (!event.dataTransfer) return false;
            const payload = activeWordPaletteTermDrag() ?? readWordPaletteTermDrag(event.dataTransfer);
            if (!payload) return false;
            event.preventDefault();
            updateDropFeedback(view, event, payload);
            return true;
          },
          dragleave: (view, rawEvent) => {
            const event = rawEvent as DragEvent;
            if (event.relatedTarget instanceof globalThis.Node && view.dom.contains(event.relatedTarget)) return false;
            clearDropFeedback();
            return false;
          },
          dragend: () => {
            clearWordPaletteTermDrag();
            clearDropFeedback();
            return false;
          },
          contextmenu: (view, rawEvent) => {
            const event = rawEvent as MouseEvent;
            const target =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>('[data-palette-recognition-term-id]')
                : null;
            if (!target) return false;
            const from = Number(target.dataset.paletteRecognitionFrom);
            const to = Number(target.dataset.paletteRecognitionTo);
            if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to) return false;
            const text = view.state.doc.textBetween(from, to, '\n').trim();
            if (!text) return false;
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
            const sourceTerm =
              target.dataset.paletteRecognition === 'EXACT'
                ? termsById.get(target.dataset.paletteRecognitionTermId ?? '')
                : undefined;
            callbacksRef.current.requestCombineSelection(text, sourceTerm);
            return true;
          },
        },
        handleDrop: (view, event): boolean => {
          const currentEditor = tiptapEditorRef.current;
          if (!currentEditor || !event.dataTransfer) return false;
          const payload = readWordPaletteTermDrag(event.dataTransfer);
          if (!payload) return false;
          event.preventDefault();
          const liveTarget = resolveDropTarget(view, event, payload);
          const cachedTarget = activeDropTargetRef.current;
          const target =
            liveTarget ??
            (cachedTarget && rectDistance(cachedTarget.rect, event.clientX, event.clientY) <= DROP_TARGET_SLOP
              ? cachedTarget
              : null);
          const handled = dropTerm(currentEditor, view, event, payload, target);
          clearWordPaletteTermDrag();
          clearDropFeedback();
          return handled;
        },
      },
      onUpdate: ({ editor: current }) => callbacksRef.current.nodesChanged(documentFromEditor(current)),
      onSelectionUpdate: ({ editor: current }) => callbacksRef.current.selectionChanged(selectedPlainText(current)),
    });
    tiptapEditorRef.current = editor;

    const bridgeRevision = useMemo(() => ({ groupsByKey, terms, termsById }), [groupsByKey, terms, termsById]);
    useLatestMicrotask(editor, bridgeRevision, (currentEditor) => {
      if (currentEditor.isDestroyed) return;
      const bridge = paletteBridge(currentEditor);
      bridge.terms = terms;
      bridge.termsById = termsById;
      bridge.groupsByKey = groupsByKey;
      bridge.callbacks = {
        createChoice: (...args) => callbacksRef.current.createChoice(...args),
        addTermToChoice: (...args) => callbacksRef.current.addTermToChoice(...args),
        setChoiceDefault: (...args) => callbacksRef.current.setChoiceDefault(...args),
        removeChoice: (...args) => callbacksRef.current.removeChoice(...args),
        requestCombine: (...args) => callbacksRef.current.requestCombine(...args),
        requestCombineSelection: (...args) => callbacksRef.current.requestCombineSelection(...args),
        nodesChanged: (...args) => callbacksRef.current.nodesChanged(...args),
        selectionChanged: (...args) => callbacksRef.current.selectionChanged(...args),
        reportChoiceIssue: (...args) => callbacksRef.current.reportChoiceIssue(...args),
      };
      const transaction = currentEditor.state.tr
        .setMeta(recognitionPluginKey, 'refresh')
        .setMeta('addToHistory', false);
      currentEditor.state.doc.descendants((node: ProseMirrorNode, position: number) => {
        if (node.type.name === TERM_NODE) {
          const term = termsById.get(String(node.attrs.termId));
          if (term)
            transaction.setNodeMarkup(position, undefined, termNodeAttributes(term, String(node.attrs.editorKey)));
        } else if (node.type.name === CHOICE_NODE) {
          const group = groupsByKey.get(String(node.attrs.stableKey));
          if (group)
            transaction.setNodeMarkup(position, undefined, {
              ...choiceNodeAttributes(group, termsById),
              editorKey: String(node.attrs.editorKey),
            });
        }
      });
      if (transaction.docChanged || transaction.getMeta(recognitionPluginKey)) {
        currentEditor.view.dispatch(transaction);
      }
    });

    const insertTerm = useCallback(
      (term: TermListItem) => {
        if (!editor) return;
        if (replaceSelectionWithChoice(editor, term)) return;
        editor
          .chain()
          .focus()
          .insertContent({ type: TERM_NODE, attrs: termNodeAttributes(term) })
          .run();
      },
      [editor],
    );

    useImperativeHandle(
      ref,
      () => ({
        insertTerm,
        removeTerm(termId) {
          if (!editor) return;
          const ranges: Array<{ from: number; to: number }> = [];
          editor.state.doc.descendants((node: ProseMirrorNode, position: number) => {
            if (node.type.name === TERM_NODE && String(node.attrs.termId) === termId) {
              ranges.push(atomRemovalRange(editor, position, node.nodeSize));
            }
          });
          let transaction = editor.state.tr;
          for (const range of mergedRanges(ranges).reverse()) transaction = transaction.delete(range.from, range.to);
          if (transaction.docChanged) editor.view.dispatch(transaction);
        },
        clearTerms() {
          if (!editor) return;
          const ranges: Array<{ from: number; to: number }> = [];
          editor.state.doc.descendants((node: ProseMirrorNode, position: number) => {
            if (node.type.name === TERM_NODE) ranges.push(atomRemovalRange(editor, position, node.nodeSize));
          });
          let transaction = editor.state.tr;
          for (const range of mergedRanges(ranges).reverse()) transaction = transaction.delete(range.from, range.to);
          if (transaction.docChanged) editor.view.dispatch(transaction);
        },
        combineTerms(source, target, sourceNodeKey) {
          if (!editor || source.id === target.id) return;
          const group = paletteBridge(editor).callbacks.createChoice([
            { kind: 'TERM', term: source },
            { kind: 'TERM', term: target },
          ]);
          const sourcePosition = sourceNodeKey
            ? findNodePosition(editor, sourceNodeKey)
            : findTermPosition(editor, source.id);
          const targetPosition = findTermPosition(editor, target.id, sourceNodeKey);
          const choice = editor.schema.nodes[CHOICE_NODE].create(
            choiceNodeAttributes(group, paletteBridge(editor).termsById),
          );
          const anchorPosition = sourcePosition >= 0 ? sourcePosition : targetPosition;
          const anchorNode = anchorPosition >= 0 ? editor.state.doc.nodeAt(anchorPosition) : null;
          if (anchorNode) {
            const otherPosition =
              sourcePosition >= 0 && targetPosition >= 0
                ? anchorPosition === sourcePosition
                  ? targetPosition
                  : sourcePosition
                : -1;
            const otherNode = otherPosition >= 0 ? editor.state.doc.nodeAt(otherPosition) : null;
            let transaction = editor.state.tr;
            if (otherNode) {
              const range = atomRemovalRange(editor, otherPosition, otherNode.nodeSize, anchorPosition);
              transaction = transaction.delete(range.from, range.to);
            }
            const mappedAnchor = transaction.mapping.map(anchorPosition);
            transaction = transaction.replaceWith(mappedAnchor, mappedAnchor + anchorNode.nodeSize, choice);
            editor.view.dispatch(transaction.scrollIntoView());
          } else {
            editor.chain().focus().insertContent({ type: CHOICE_NODE, attrs: choice.attrs }).run();
          }
        },
        combineSelectionWithTerm(term, sourceTerm) {
          return editor ? replaceSelectionWithChoice(editor, term, sourceTerm) : false;
        },
        selectedText() {
          return editor ? selectedPlainText(editor) : null;
        },
      }),
      [editor, insertTerm],
    );

    return (
      <section
        data-palette-inline-prompt
        className={cn(
          'grid min-h-0 min-w-0 w-full max-w-full overflow-hidden gap-2 border-b p-4',
          fullWindow && 'grid-rows-[auto_minmax(0,1fr)]',
        )}
      >
        {dropPreview?.intent === 'insert' && (
          <span
            aria-hidden="true"
            className="pointer-events-none fixed z-50 w-0.5 rounded-full bg-primary"
            style={{ left: dropPreview.left, top: dropPreview.top, height: dropPreview.height }}
          />
        )}
        {dropPreview && dropPreview.intent !== 'insert' && (
          <span
            aria-hidden="true"
            className="pointer-events-none fixed z-40 rounded-md border-2 border-primary bg-primary/10 ring-2 ring-primary/25 ring-offset-2"
            style={dropPreview.targetRect}
          />
        )}
        {dropPreview && dropPreview.intent !== 'insert' && (
          <div
            role="status"
            className="pointer-events-none fixed z-50 flex max-w-80 -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-overlay"
            style={{ left: dropPreview.left, top: dropPreview.top }}
          >
            {dropPreview.intent === 'combine' ? <BracesIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            <span className="truncate">
              {dropPreview.sourceLabel}
              {dropPreview.intent === 'combine' ? ` ⇄ ${dropPreview.targetLabel}` : ''} ·{' '}
              {dropPreview.intent === 'combine' ? l.releaseToCombine : l.releaseToAddChoice}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <strong className="text-md font-medium">{l.prompt}</strong>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3 text-xs text-muted-foreground">
            {selectedText && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="max-w-64 text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onRequestCombineSelection(selectedText)}
              >
                <ShuffleIcon className="size-3.5" />
                <span className="truncate">
                  {l.combineOptions} · “{selectedText}”
                </span>
              </Button>
            )}
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full border border-success bg-success-surface" />
              {l.linkedTerms}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full border border-warning bg-warning-surface" />
              {l.parameters}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full border border-info bg-info-surface" />
              {l.suggestedTerms}
            </span>
            <Button
              data-action="word-palette-prompt-full-window"
              type="button"
              variant={fullWindow ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onFullWindowChange(!fullWindow)}
            >
              {fullWindow ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
              {fullWindow ? l.exitFullWindow : l.fullWindow}
            </Button>
          </div>
        </div>
        <ScrollArea
          type="always"
          className={cn(
            'relative min-w-0 w-full max-w-full rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring [&_[data-slot=scroll-area-scrollbar]]:opacity-100 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full',
            fullWindow ? 'min-h-0' : 'h-56 max-h-[35vh]',
          )}
        >
          <div className="relative min-h-full min-w-0 w-full">
            {interactionNotice && (
              <div
                role="status"
                className="pointer-events-none absolute right-3 top-3 z-20 rounded-md border bg-overlay px-2.5 py-1.5 text-xs text-foreground shadow-overlay"
              >
                {interactionNotice}
              </div>
            )}
            {editor?.isEmpty && (
              <div className="pointer-events-none absolute left-4 top-3 text-md leading-8 text-muted-foreground">
                {l.promptPlaceholder}
              </div>
            )}
            <EditorContent
              className="min-h-full min-w-0 w-full max-w-full [&>.ProseMirror]:min-h-full [&>.ProseMirror]:min-w-0 [&>.ProseMirror]:w-full [&>.ProseMirror]:max-w-full"
              editor={editor}
            />
          </div>
        </ScrollArea>
      </section>
    );
  },
);
