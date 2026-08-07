import { mergeAttributes, Node, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { BookOpenIcon, ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react';
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
import type { CreatorPromptNodeInput, Locale, TermListItem, WordPaletteDto } from '@/shared/contracts';
import { resolveAlternateTermTitle, resolveTermExpression, resolveTermTitle } from '@/shared/term-localization';
import {
  resolveLocalizedName,
  resolveWordPaletteOptionLabel,
  resolveWordPaletteParameterName,
} from '@/shared/word-palette-localization';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useExternalEditorDocument } from '@/renderer/hooks/useExternalEditorDocument';
import { useLatestMicrotask } from '@/renderer/hooks/useLatestMicrotask';
import {
  activeWordPaletteRecipeDrag,
  activeWordPaletteTermDrag,
  clearWordPaletteRecipeDrag,
  clearWordPaletteTermDrag,
  readWordPaletteRecipeDrag,
  readWordPaletteTermDrag,
  writeWordPaletteRecipeDrag,
  writeWordPaletteTermDrag,
} from '@/renderer/components/palette/wordPaletteInteractions';
import { normalizeCreatorPromptNodes } from '@/renderer/components/creator/creatorPromptDocument';
import {
  CreatorRecipeNodeDetails,
  CreatorTermNodeDetails,
} from '@/renderer/components/creator/CreatorPromptNodeDetails';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';

const TERM_NODE = 'creatorTerm';
const RECIPE_NODE = 'creatorRecipe';
let nodeSerial = 0;

function nextNodeKey(prefix: string) {
  nodeSerial += 1;
  return `${prefix}_${Date.now().toString(36)}_${nodeSerial.toString(36)}`;
}

interface ComposerCallbacks {
  nodesChanged(nodes: CreatorPromptNodeInput[]): void;
  openTerm(term: TermListItem): void;
  openRecipe(paletteId: string): void;
  configureRecipe(palette: WordPaletteDto): void;
  changeRecipeLocale(paletteId: string, promptLocale: Locale): void;
  requestRecipeInsert(palette: WordPaletteDto, position: number): void;
}

interface ComposerBridgeStorage {
  locale: Locale;
  termPromptLocale: Locale;
  termsById: Map<string, TermListItem>;
  palettesById: Map<string, WordPaletteDto>;
  appliedByPaletteId: Map<string, AppliedWordPalette>;
  callbacks: ComposerCallbacks;
}

const composerBridges = new WeakMap<Editor, ComposerBridgeStorage>();

function composerBridge(editor: Editor) {
  let bridge = composerBridges.get(editor);
  if (!bridge) {
    bridge = {
      locale: 'zh',
      termPromptLocale: 'en',
      termsById: new Map(),
      palettesById: new Map(),
      appliedByPaletteId: new Map(),
      callbacks: {
        nodesChanged: () => undefined,
        openTerm: () => undefined,
        openRecipe: () => undefined,
        configureRecipe: () => undefined,
        changeRecipeLocale: () => undefined,
        requestRecipeInsert: () => undefined,
      },
    };
    composerBridges.set(editor, bridge);
  }
  return bridge;
}

function termLabel(term: TermListItem, promptLocale: Locale) {
  return resolveTermTitle(term, promptLocale);
}

function termExpression(term: TermListItem, promptLocale: Locale) {
  return resolveTermExpression(term, 'gpt-image-2', promptLocale)?.positive;
}

function termAttributes(term: TermListItem, promptLocale: Locale, editorKey = nextNodeKey('term')) {
  return {
    editorKey,
    termId: term.id,
    promptLocale,
    label: termLabel(term, promptLocale),
    promptText: termExpression(term, promptLocale) ?? termLabel(term, promptLocale),
  };
}

function recipeLabel(reference: AppliedWordPalette | undefined, palette: WordPaletteDto | undefined, locale: Locale) {
  const revision = reference?.revision;
  if (revision) return resolveLocalizedName(revision, locale);
  return palette ? resolveLocalizedName(palette, locale) : '';
}

function recipeAttributes(
  paletteId: string,
  bridge: Pick<ComposerBridgeStorage, 'locale' | 'palettesById' | 'appliedByPaletteId'>,
  editorKey = nextNodeKey('recipe'),
) {
  const reference = bridge.appliedByPaletteId.get(paletteId);
  const palette = bridge.palettesById.get(paletteId) ?? reference?.palette;
  return {
    editorKey,
    paletteId,
    label: recipeLabel(reference, palette, bridge.locale) || paletteId,
    revisionNo: reference?.revision.revisionNo ?? palette?.revisionNo ?? 0,
    promptLocale: reference?.promptLocale ?? bridge.locale,
  };
}

function deleteNode(editor: Editor, getPos: NodeViewProps['getPos'], nodeSize: number) {
  const position = getPos();
  if (typeof position === 'number')
    editor
      .chain()
      .focus()
      .deleteRange({ from: position, to: position + nodeSize })
      .run();
}

function CreatorTermNodeView({ editor, node, getPos }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const bridge = composerBridge(editor);
  const term = bridge.termsById.get(String(node.attrs.termId));
  if (!term)
    return (
      <NodeViewWrapper as="span" contentEditable={false} className="rounded border px-1 text-destructive">
        {String(node.attrs.label)}
      </NodeViewWrapper>
    );
  const nodeKey = String(node.attrs.editorKey);
  const promptLocale: Locale =
    node.attrs.promptLocale === 'zh' ? 'zh' : node.attrs.promptLocale === 'en' ? 'en' : bridge.termPromptLocale;
  const label = termLabel(term, promptLocale);
  const secondaryName = resolveAlternateTermTitle(term, promptLocale);
  const promptFragment = termExpression(term, promptLocale) ?? label;
  return (
    <NodeViewWrapper
      as="span"
      data-creator-term-node=""
      data-creator-node-key={nodeKey}
      data-creator-term-id={term.id}
      draggable
      contentEditable={false}
      className="mx-0.5 inline-flex cursor-grab rounded-lg align-middle active:cursor-grabbing"
      onDragStart={(event: ReactDragEvent<HTMLSpanElement>) =>
        writeWordPaletteTermDrag(event.dataTransfer, {
          termId: term.id,
          origin: 'editor',
          nodeKey,
          plainText: promptFragment || label,
        })
      }
      onDragEnd={clearWordPaletteTermDrag}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-8 gap-1.5 rounded-lg border-success/35 bg-success-surface px-2 font-normal text-foreground hover:bg-success-surface"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <BookOpenIcon className="size-4" />
            <span className="max-w-48 truncate">{label}</span>
            <span className="text-[10px] text-muted-foreground">{promptLocale.toUpperCase()}</span>
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <CreatorTermNodeDetails
          locale={bridge.locale}
          label={label}
          secondaryName={secondaryName}
          promptFragment={promptFragment}
          promptLocale={promptLocale}
          onPromptLocaleChange={(value) => {
            const position = getPos();
            if (typeof position !== 'number') return;
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(position, undefined, termAttributes(term, value, nodeKey)),
            );
          }}
          onOpen={() => {
            setOpen(false);
            bridge.callbacks.openTerm(term);
          }}
          onRemove={() => deleteNode(editor, getPos, node.nodeSize)}
        />
      </Popover>
    </NodeViewWrapper>
  );
}

function selectedRecipeParameters(reference: AppliedWordPalette, locale: Locale) {
  return reference.revision.parameters.flatMap((parameter) => {
    const selected = parameter.options.find(
      (option) => option.value === reference.parameterValues[parameter.stableKey],
    );
    if (!selected) return [];
    return [
      {
        id: parameter.id,
        name: resolveWordPaletteParameterName(parameter, locale),
        value: resolveWordPaletteOptionLabel(selected, locale),
      },
    ];
  });
}

function CreatorRecipeNodeView({ editor, node, getPos }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const bridge = composerBridge(editor);
  const paletteId = String(node.attrs.paletteId);
  const reference = bridge.appliedByPaletteId.get(paletteId);
  const palette = bridge.palettesById.get(paletteId) ?? reference?.palette;
  const label = recipeLabel(reference, palette, bridge.locale) || String(node.attrs.label);
  const promptLocale: Locale = reference?.promptLocale ?? (node.attrs.promptLocale === 'zh' ? 'zh' : 'en');
  const parameters = reference ? selectedRecipeParameters(reference, promptLocale) : [];
  const nodeKey = String(node.attrs.editorKey);
  if (!palette)
    return (
      <NodeViewWrapper as="span" contentEditable={false} className="rounded border px-1 text-destructive">
        {label}
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper
      as="span"
      data-creator-recipe-node=""
      data-creator-node-key={nodeKey}
      data-creator-palette-id={paletteId}
      draggable
      contentEditable={false}
      className="mx-0.5 inline-flex cursor-grab rounded-lg align-middle active:cursor-grabbing"
      onDragStart={(event: ReactDragEvent<HTMLSpanElement>) =>
        writeWordPaletteRecipeDrag(event.dataTransfer, {
          paletteId,
          origin: 'editor',
          nodeKey,
          plainText: label,
        })
      }
      onDragEnd={clearWordPaletteRecipeDrag}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-8 gap-1.5 rounded-lg border-warning/45 bg-warning-surface px-2 font-normal text-foreground hover:bg-warning-surface"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <SlidersHorizontalIcon className="size-4" />
            <span className="max-w-56 truncate">{label}</span>
            <span className="text-[10px] text-muted-foreground">
              V{reference?.revision.revisionNo ?? palette.revisionNo} · {promptLocale.toUpperCase()}
            </span>
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <CreatorRecipeNodeDetails
          locale={bridge.locale}
          label={label}
          version={reference?.revision.revisionNo ?? palette.revisionNo}
          promptLocale={promptLocale}
          parameters={parameters}
          onPromptLocaleChange={(value) => bridge.callbacks.changeRecipeLocale(paletteId, value)}
          onConfigure={() => {
            setOpen(false);
            bridge.callbacks.configureRecipe(palette);
          }}
          onOpen={() => {
            setOpen(false);
            bridge.callbacks.openRecipe(paletteId);
          }}
          onRemove={() => deleteNode(editor, getPos, node.nodeSize)}
        />
      </Popover>
    </NodeViewWrapper>
  );
}

const CreatorTermNode = Node.create({
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
      promptLocale: { default: '' },
      label: { default: '' },
      promptText: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-creator-term-node]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-creator-term-node': '' })];
  },
  renderText({ node }) {
    return String(node.attrs.promptText);
  },
  addNodeView() {
    return ReactNodeViewRenderer(CreatorTermNodeView);
  },
});

const CreatorRecipeNode = Node.create({
  name: RECIPE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      editorKey: { default: '' },
      paletteId: { default: '' },
      label: { default: '' },
      revisionNo: { default: 0 },
      promptLocale: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-creator-recipe-node]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-creator-recipe-node': '' })];
  },
  renderText({ node }) {
    return String(node.attrs.label);
  },
  addNodeView() {
    return ReactNodeViewRenderer(CreatorRecipeNodeView);
  },
});

function editorJsonFromNodes(
  nodes: readonly CreatorPromptNodeInput[],
  bridge: Pick<
    ComposerBridgeStorage,
    'locale' | 'termPromptLocale' | 'termsById' | 'palettesById' | 'appliedByPaletteId'
  >,
) {
  const paragraphs: Array<{ type: 'paragraph'; content: Array<Record<string, unknown>> }> = [
    { type: 'paragraph', content: [] },
  ];
  const paragraph = () => paragraphs.at(-1)!;
  const appendText = (value: string) => {
    value.split('\n').forEach((line, index, lines) => {
      if (line) paragraph().content.push({ type: 'text', text: line });
      if (index < lines.length - 1) paragraphs.push({ type: 'paragraph', content: [] });
    });
  };
  for (const node of normalizeCreatorPromptNodes(nodes)) {
    if (node.kind === 'TEXT') appendText(node.text);
    else if (node.kind === 'TERM') {
      const term = bridge.termsById.get(node.termId);
      if (term)
        paragraph().content.push({
          type: TERM_NODE,
          attrs: termAttributes(term, node.promptLocale ?? bridge.termPromptLocale),
        });
    } else if (bridge.palettesById.has(node.paletteId) || bridge.appliedByPaletteId.has(node.paletteId)) {
      paragraph().content.push({ type: RECIPE_NODE, attrs: recipeAttributes(node.paletteId, bridge) });
    }
  }
  return { type: 'doc', content: paragraphs };
}

function documentFromProseMirror(doc: ProseMirrorNode): CreatorPromptNodeInput[] {
  const nodes: CreatorPromptNodeInput[] = [];
  const appendText = (text: string) => {
    const previous = nodes.at(-1);
    if (previous?.kind === 'TEXT') previous.text += text;
    else nodes.push({ kind: 'TEXT', text });
  };
  doc.forEach((paragraph: ProseMirrorNode, _offset: number, paragraphIndex: number) => {
    if (paragraphIndex > 0) appendText('\n');
    paragraph.forEach((node) => {
      if (node.isText) appendText(node.text ?? '');
      else if (node.type.name === TERM_NODE) {
        const promptLocale =
          node.attrs.promptLocale === 'zh' ? 'zh' : node.attrs.promptLocale === 'en' ? 'en' : undefined;
        nodes.push({
          kind: 'TERM',
          termId: String(node.attrs.termId),
          ...(promptLocale ? { promptLocale } : {}),
        });
      } else if (node.type.name === RECIPE_NODE)
        nodes.push({ kind: 'RECIPE', paletteId: String(node.attrs.paletteId) });
    });
  });
  return normalizeCreatorPromptNodes(nodes);
}

function documentFromEditor(editor: Editor) {
  return documentFromProseMirror(editor.state.doc);
}

type ComposerBridgeSnapshot = Parameters<typeof editorJsonFromNodes>[1];

function useComposerBridgeSynchronization(editor: Editor | null, snapshot: ComposerBridgeSnapshot) {
  useLatestMicrotask(editor, snapshot, (currentEditor) => {
    if (currentEditor.isDestroyed) return;
    const bridge = composerBridge(currentEditor);
    bridge.locale = snapshot.locale;
    bridge.termPromptLocale = snapshot.termPromptLocale;
    bridge.termsById = snapshot.termsById;
    bridge.palettesById = snapshot.palettesById;
    bridge.appliedByPaletteId = snapshot.appliedByPaletteId;

    let transaction = currentEditor.state.tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
    currentEditor.state.doc.descendants((node: ProseMirrorNode, position: number) => {
      if (node.type.name === TERM_NODE) {
        const term = snapshot.termsById.get(String(node.attrs.termId));
        if (term) {
          transaction = transaction.setNodeMarkup(
            position,
            undefined,
            termAttributes(
              term,
              node.attrs.promptLocale === 'zh' || node.attrs.promptLocale === 'en'
                ? node.attrs.promptLocale
                : snapshot.termPromptLocale,
              String(node.attrs.editorKey),
            ),
          );
        }
      } else if (node.type.name === RECIPE_NODE) {
        const paletteId = String(node.attrs.paletteId);
        if (snapshot.palettesById.has(paletteId) || snapshot.appliedByPaletteId.has(paletteId)) {
          transaction = transaction.setNodeMarkup(
            position,
            undefined,
            recipeAttributes(paletteId, snapshot, String(node.attrs.editorKey)),
          );
        }
      }
    });
    if (transaction.docChanged) currentEditor.view.dispatch(transaction);
  });
}

function findNodePosition(editor: Editor, nodeKey: string) {
  let found = -1;
  editor.state.doc.descendants((node: ProseMirrorNode, position: number) => {
    if (String(node.attrs.editorKey ?? '') === nodeKey) {
      found = position;
      return false;
    }
    return found < 0;
  });
  return found;
}

function findStructuredPosition(editor: Editor, typeName: string, attribute: string, value: string) {
  let found = -1;
  editor.state.doc.descendants((node: ProseMirrorNode, position: number) => {
    if (node.type.name === typeName && String(node.attrs[attribute]) === value) {
      found = position;
      return false;
    }
    return found < 0;
  });
  return found;
}

function insertPosition(editor: Editor, requested?: number) {
  return Math.max(1, Math.min(requested ?? editor.state.selection.from, editor.state.doc.content.size - 1));
}

function moveOrInsertAtom(
  editor: Editor,
  typeName: string,
  attrs: Record<string, unknown>,
  position: number,
  sourceNodeKey?: string,
) {
  let transaction = editor.state.tr;
  let insertionAttrs = attrs;
  const sourcePosition = sourceNodeKey ? findNodePosition(editor, sourceNodeKey) : -1;
  if (sourcePosition >= 0) {
    const sourceNode = editor.state.doc.nodeAt(sourcePosition);
    if (sourceNode) {
      if (position >= sourcePosition && position <= sourcePosition + sourceNode.nodeSize) return true;
      if (
        typeName === TERM_NODE &&
        (sourceNode.attrs.promptLocale === 'zh' || sourceNode.attrs.promptLocale === 'en')
      ) {
        insertionAttrs = { ...attrs, promptLocale: sourceNode.attrs.promptLocale };
      }
      transaction = transaction.delete(sourcePosition, sourcePosition + sourceNode.nodeSize);
    }
  }
  const mappedPosition = Math.max(1, Math.min(transaction.mapping.map(position), transaction.doc.content.size - 1));
  transaction = transaction.insert(mappedPosition, editor.schema.nodes[typeName].create(insertionAttrs));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export interface CreatorPromptComposerHandle {
  getNodes(): CreatorPromptNodeInput[];
  insertTerm(termId: string, position?: number): void;
  insertRecipe(paletteId: string, position?: number): void;
  removeTerm(termId: string): void;
  removeRecipe(paletteId: string): void;
  clearStructuredNodes(): void;
  focusTerm(termId: string): void;
  focusRecipe(paletteId: string): void;
}

interface Props {
  locale: Locale;
  termPromptLocale: Locale;
  nodes: CreatorPromptNodeInput[];
  terms: TermListItem[];
  palettes: WordPaletteDto[];
  appliedPalettes: AppliedWordPalette[];
  placeholder: string;
  ariaLabel: string;
  fullWindow?: boolean;
  onNodesChange(nodes: CreatorPromptNodeInput[]): void;
  onOpenTerm(term: TermListItem): void;
  onOpenRecipe(paletteId: string): void;
  onConfigureRecipe(palette: WordPaletteDto): void;
  onRecipePromptLocaleChange(paletteId: string, promptLocale: Locale): void;
  onRequestRecipeInsert(palette: WordPaletteDto, position: number): void;
}

export const CreatorPromptComposer = forwardRef<CreatorPromptComposerHandle, Props>(function CreatorPromptComposer(
  {
    locale,
    termPromptLocale,
    nodes,
    terms,
    palettes,
    appliedPalettes,
    placeholder,
    ariaLabel,
    fullWindow = false,
    onNodesChange,
    onOpenTerm,
    onOpenRecipe,
    onConfigureRecipe,
    onRecipePromptLocaleChange,
    onRequestRecipeInsert,
  },
  ref,
) {
  const termsById = useMemo(() => new Map(terms.map((term) => [term.id, term])), [terms]);
  const palettesById = useMemo(
    () =>
      new Map([
        ...palettes.map((palette) => [palette.id, palette] as const),
        ...appliedPalettes.map((reference) => [reference.palette.id, reference.palette] as const),
      ]),
    [appliedPalettes, palettes],
  );
  const appliedByPaletteId = useMemo(
    () => new Map(appliedPalettes.map((reference) => [reference.palette.id, reference])),
    [appliedPalettes],
  );
  const bridgeSnapshot = useMemo(
    () => ({ locale, termPromptLocale, termsById, palettesById, appliedByPaletteId }),
    [appliedByPaletteId, locale, palettesById, termPromptLocale, termsById],
  );
  const callbacksRef = useRef<ComposerCallbacks>({
    nodesChanged: onNodesChange,
    openTerm: onOpenTerm,
    openRecipe: onOpenRecipe,
    configureRecipe: onConfigureRecipe,
    changeRecipeLocale: onRecipePromptLocaleChange,
    requestRecipeInsert: onRequestRecipeInsert,
  });
  const [editorIsEmpty, setEditorIsEmpty] = useState(() => normalizeCreatorPromptNodes(nodes).length === 0);
  callbacksRef.current = {
    nodesChanged: onNodesChange,
    openTerm: onOpenTerm,
    openRecipe: onOpenRecipe,
    configureRecipe: onConfigureRecipe,
    changeRecipeLocale: onRecipePromptLocaleChange,
    requestRecipeInsert: onRequestRecipeInsert,
  };
  const initialContent = useMemo(() => editorJsonFromNodes(nodes, bridgeSnapshot), []);
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false,
      }),
      CreatorTermNode,
      CreatorRecipeNode,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          'min-h-48 whitespace-pre-wrap break-words px-5 pt-2 pb-5 text-md leading-8 text-foreground outline-none [&_p]:min-h-8 [&_p+p]:mt-1',
        'data-generation-prompt': 'true',
        'aria-label': ariaLabel,
      },
      handleDOMEvents: {
        dragover: (_view, event) => {
          if (!event.dataTransfer) return false;
          const term = activeWordPaletteTermDrag() ?? readWordPaletteTermDrag(event.dataTransfer);
          const recipe = activeWordPaletteRecipeDrag() ?? readWordPaletteRecipeDrag(event.dataTransfer);
          if (!term && !recipe) return false;
          event.preventDefault();
          event.dataTransfer.dropEffect = term?.origin === 'editor' || recipe?.origin === 'editor' ? 'move' : 'copy';
          return false;
        },
        dragend: () => {
          clearWordPaletteTermDrag();
          clearWordPaletteRecipeDrag();
          return false;
        },
      },
      handleDrop: (view, event) => {
        const currentEditor = editorRef.current;
        if (!currentEditor || !event.dataTransfer) return false;
        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coordinates) return false;
        const termPayload = readWordPaletteTermDrag(event.dataTransfer);
        if (termPayload) {
          const bridge = composerBridge(currentEditor);
          const term = bridge.termsById.get(termPayload.termId);
          if (!term) return false;
          event.preventDefault();
          event.stopPropagation();
          const existing = findStructuredPosition(currentEditor, TERM_NODE, 'termId', term.id);
          if (termPayload.origin === 'dictionary' && existing >= 0) {
            currentEditor.chain().focus().setNodeSelection(existing).run();
          } else {
            moveOrInsertAtom(
              currentEditor,
              TERM_NODE,
              termAttributes(term, bridge.termPromptLocale, termPayload.nodeKey),
              coordinates.pos,
              termPayload.nodeKey,
            );
          }
          clearWordPaletteTermDrag();
          return true;
        }
        const recipePayload = readWordPaletteRecipeDrag(event.dataTransfer);
        if (!recipePayload) return false;
        const bridge = composerBridge(currentEditor);
        const palette = bridge.palettesById.get(recipePayload.paletteId);
        if (!palette) return false;
        event.preventDefault();
        event.stopPropagation();
        if (recipePayload.origin === 'dictionary') {
          bridge.callbacks.requestRecipeInsert(palette, coordinates.pos);
        } else {
          moveOrInsertAtom(
            currentEditor,
            RECIPE_NODE,
            recipeAttributes(recipePayload.paletteId, bridge, recipePayload.nodeKey),
            coordinates.pos,
            recipePayload.nodeKey,
          );
        }
        clearWordPaletteRecipeDrag();
        return true;
      },
    },
    onCreate: ({ editor: current }) => setEditorIsEmpty(current.isEmpty),
    onUpdate: ({ editor: current }) => {
      setEditorIsEmpty(current.isEmpty);
      callbacksRef.current.nodesChanged(documentFromEditor(current));
    },
  });
  editorRef.current = editor;

  useComposerBridgeSynchronization(editor, bridgeSnapshot);

  useEffect(() => {
    if (!editor) return;
    const bridge = composerBridge(editor);
    bridge.callbacks = {
      nodesChanged: (...args) => callbacksRef.current.nodesChanged(...args),
      openTerm: (...args) => callbacksRef.current.openTerm(...args),
      openRecipe: (...args) => callbacksRef.current.openRecipe(...args),
      configureRecipe: (...args) => callbacksRef.current.configureRecipe(...args),
      changeRecipeLocale: (...args) => callbacksRef.current.changeRecipeLocale(...args),
      requestRecipeInsert: (...args) => callbacksRef.current.requestRecipeInsert(...args),
    };
  }, [editor]);

  const nodesSignature = JSON.stringify(normalizeCreatorPromptNodes(nodes));
  useExternalEditorDocument({
    editor,
    nodes,
    signature: nodesSignature,
    bridge: bridgeSnapshot,
    currentSignature: (currentEditor) => JSON.stringify(documentFromEditor(currentEditor)),
    content: editorJsonFromNodes,
    onEmptyChange: setEditorIsEmpty,
  });

  const focusAt = useCallback(
    (typeName: string, attribute: string, value: string) => {
      if (!editor) return false;
      const position = findStructuredPosition(editor, typeName, attribute, value);
      if (position < 0) return false;
      editor.chain().focus().setNodeSelection(position).scrollIntoView().run();
      return true;
    },
    [editor],
  );

  const removeMatching = useCallback(
    (predicate: (node: ProseMirrorNode) => boolean) => {
      if (!editor) return;
      const ranges: Array<{ from: number; to: number }> = [];
      editor.state.doc.descendants((node: ProseMirrorNode, position: number) => {
        if (predicate(node)) ranges.push({ from: position, to: position + node.nodeSize });
      });
      let transaction = editor.state.tr;
      for (const range of ranges.reverse()) transaction = transaction.delete(range.from, range.to);
      if (transaction.docChanged) editor.view.dispatch(transaction);
    },
    [editor],
  );

  useImperativeHandle(
    ref,
    () => ({
      getNodes() {
        return editor ? documentFromEditor(editor) : normalizeCreatorPromptNodes(nodes);
      },
      insertTerm(termId, position) {
        if (!editor) return;
        if (focusAt(TERM_NODE, 'termId', termId)) return;
        const term = termsById.get(termId);
        if (term)
          editor
            .chain()
            .focus()
            .insertContentAt(insertPosition(editor, position), {
              type: TERM_NODE,
              attrs: termAttributes(term, termPromptLocale),
            })
            .run();
      },
      insertRecipe(paletteId, position) {
        if (!editor) return;
        if (focusAt(RECIPE_NODE, 'paletteId', paletteId)) return;
        if (palettesById.has(paletteId) || appliedByPaletteId.has(paletteId)) {
          const target = insertPosition(editor, position);
          const recipe = editor.schema.nodes[RECIPE_NODE].create(recipeAttributes(paletteId, bridgeSnapshot));
          const transaction = editor.state.tr.insert(target, recipe);
          callbacksRef.current.nodesChanged(documentFromProseMirror(transaction.doc));
        }
      },
      removeTerm(termId) {
        removeMatching((node) => node.type.name === TERM_NODE && String(node.attrs.termId) === termId);
      },
      removeRecipe(paletteId) {
        removeMatching((node) => node.type.name === RECIPE_NODE && String(node.attrs.paletteId) === paletteId);
      },
      clearStructuredNodes() {
        removeMatching((node) => node.type.name === TERM_NODE || node.type.name === RECIPE_NODE);
      },
      focusTerm(termId) {
        focusAt(TERM_NODE, 'termId', termId);
      },
      focusRecipe(paletteId) {
        focusAt(RECIPE_NODE, 'paletteId', paletteId);
      },
    }),
    [appliedByPaletteId, bridgeSnapshot, editor, focusAt, palettesById, removeMatching, termsById],
  );

  return (
    <ScrollArea
      data-creator-prompt-editor
      type="always"
      className={cn(
        'relative [&_[data-slot=scroll-area-scrollbar]]:opacity-100',
        fullWindow ? 'min-h-0 flex-1' : 'h-60 max-h-[38vh]',
      )}
    >
      <div className="relative min-h-full">
        {editor && editorIsEmpty && (
          <div className="pointer-events-none absolute left-5 top-2 text-md leading-8 text-muted-foreground">
            {placeholder}
          </div>
        )}
        <EditorContent className="min-h-full [&>.ProseMirror]:min-h-full" editor={editor} />
      </div>
    </ScrollArea>
  );
});
