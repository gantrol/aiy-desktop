import { normalizeCreatorPromptNodes } from '@/renderer/components/creator/creatorPromptDocument';
import {
  CreatorRecipeNodeDetails,
  CreatorTermNodeDetails,
} from '@/renderer/components/creator/CreatorPromptNodeDetails';
import { resolveCreatorPrompt, type AppliedWordPalette } from '@/renderer/components/creator/utils';
import {
  clearWordPaletteRecipeDrag,
  clearWordPaletteTermDrag,
  writeWordPaletteRecipeDrag,
  writeWordPaletteTermDrag,
} from '@/renderer/components/palette/wordPaletteInteractions';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useLatestMicrotask } from '@/renderer/hooks/useLatestMicrotask';
import type { CreatorPromptNodeInput, Locale, TermListItem, WordPaletteDto } from '@/shared/contracts';
import { type BlockDocument } from '@/shared/contracts/block-document';
import { DEFAULT_IMAGE_PROMPT_PROFILE_ID } from '@/shared/image-generation-prompt-profile';
import { resolveAlternateTermTitle, resolveTermExpression, resolveTermTitle } from '@/shared/term-localization';
import {
  resolveLocalizedName,
  resolveWordPaletteOptionLabel,
  resolveWordPaletteParameterName,
} from '@/shared/word-palette-localization';
import { mergeAttributes, Node, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { BookOpenIcon, ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useState, type DragEvent as ReactDragEvent } from 'react';

export const [TERM_NODE, RECIPE_NODE] = ['creatorTerm', 'creatorRecipe'] as const;
let nodeSerial = 0;

function nextNodeKey(prefix: string) {
  nodeSerial += 1;
  return `${prefix}_${Date.now().toString(36)}_${nodeSerial.toString(36)}`;
}

export interface ComposerCallbacks {
  nodesChanged(nodes: CreatorPromptNodeInput[], document: BlockDocument): void;
  openTerm(term: TermListItem): void;
  openRecipe(paletteId: string): void;
  configureRecipe(palette: WordPaletteDto): void;
  changeRecipeLocale(paletteId: string, promptLocale: Locale): void;
  requestRecipeInsert(palette: WordPaletteDto, position: number): void;
}

interface ComposerBridgeStorage {
  locale: Locale;
  termPromptLocale: Locale;
  promptProfileId: string;
  termsById: Map<string, TermListItem>;
  palettesById: Map<string, WordPaletteDto>;
  appliedByPaletteId: Map<string, AppliedWordPalette>;
  callbacks: ComposerCallbacks;
}

const composerBridges = new WeakMap<Editor, ComposerBridgeStorage>();

export function composerBridge(editor: Editor) {
  let bridge = composerBridges.get(editor);
  if (!bridge) {
    bridge = {
      locale: 'zh',
      termPromptLocale: 'en',
      promptProfileId: DEFAULT_IMAGE_PROMPT_PROFILE_ID,
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

function termExpression(term: TermListItem, promptProfileId: string, promptLocale: Locale) {
  return resolveTermExpression(term, promptProfileId, promptLocale)?.positive;
}

export function termAttributes(
  term: TermListItem,
  promptProfileId: string,
  promptLocale: Locale,
  editorKey = nextNodeKey('term'),
) {
  return {
    editorKey,
    termId: term.id,
    promptLocale,
    label: termLabel(term, promptLocale),
    promptText: termExpression(term, promptProfileId, promptLocale) ?? termLabel(term, promptLocale),
  };
}

function recipeLabel(reference: AppliedWordPalette | undefined, palette: WordPaletteDto | undefined, locale: Locale) {
  const revision = reference?.revision;
  if (revision) return resolveLocalizedName(revision, locale);
  return palette ? resolveLocalizedName(palette, locale) : '';
}

export function recipeAttributes(
  paletteId: string,
  bridge: Pick<ComposerBridgeStorage, 'locale' | 'palettesById' | 'appliedByPaletteId' | 'promptProfileId'>,
  editorKey = nextNodeKey('recipe'),
) {
  const reference = bridge.appliedByPaletteId.get(paletteId);
  const palette = bridge.palettesById.get(paletteId) ?? reference?.palette;
  return {
    editorKey,
    paletteId,
    promptText: reference
      ? resolveCreatorPrompt({
          manualPrompt: '',
          selectedTerms: [],
          appliedPalettes: [reference],
          promptProfileId: bridge.promptProfileId,
        }).livePrompt
      : '',
    label: recipeLabel(reference, palette, bridge.locale) || paletteId,
    paletteRevisionId: reference?.revision.id ?? null,
    parameterValues: reference?.parameterValues ?? {},
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
  const promptFragment = termExpression(term, bridge.promptProfileId, promptLocale) ?? label;
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
              editor.state.tr.setNodeMarkup(
                position,
                undefined,
                termAttributes(term, bridge.promptProfileId, value, nodeKey),
              ),
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

export const CreatorTermNode = Node.create({
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

export const CreatorRecipeNode = Node.create({
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
      promptText: { default: '' },
      label: { default: '' },
      paletteRevisionId: { default: null, rendered: false },
      parameterValues: { default: {}, rendered: false },
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

/** Import legacy prompt inputs. This cannot reconstruct the formatting of a saved BlockDocument. */
export function editorJsonFromNodes(
  nodes: readonly CreatorPromptNodeInput[],
  bridge: Pick<
    ComposerBridgeStorage,
    'locale' | 'termPromptLocale' | 'promptProfileId' | 'termsById' | 'palettesById' | 'appliedByPaletteId'
  >,
) {
  const paragraphs: Array<{ type: 'paragraph'; content: Array<Record<string, unknown>> }> = [
    { type: 'paragraph', content: [] },
  ];
  const paragraph = () => paragraphs.at(-1)!;
  const appendText = (value: string) => {
    // Match documentFromProseMirror: paragraphs produce two newlines, hard breaks produce one.
    value.split('\n\n').forEach((text, paragraphIndex) => {
      if (paragraphIndex > 0) paragraphs.push({ type: 'paragraph', content: [] });
      text.split('\n').forEach((line, lineIndex) => {
        if (lineIndex > 0) paragraph().content.push({ type: 'hardBreak' });
        if (line) paragraph().content.push({ type: 'text', text: line });
      });
    });
  };
  for (const node of normalizeCreatorPromptNodes(nodes)) {
    if (node.kind === 'TEXT') appendText(node.text);
    else if (node.kind === 'TERM') {
      const term = bridge.termsById.get(node.termId);
      if (term)
        paragraph().content.push({
          type: TERM_NODE,
          attrs: termAttributes(term, bridge.promptProfileId, node.promptLocale ?? bridge.termPromptLocale),
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
  const visit = (node: ProseMirrorNode) => {
    if (node.isText) appendText(node.text ?? '');
    else if (node.type.name === 'hardBreak') appendText('\n');
    else if (node.type.name === TERM_NODE) {
      const promptLocale =
        node.attrs.promptLocale === 'zh' || node.attrs.promptLocale === 'en' ? node.attrs.promptLocale : undefined;
      nodes.push({ kind: 'TERM', termId: String(node.attrs.termId), ...(promptLocale ? { promptLocale } : {}) });
    } else if (node.type.name === RECIPE_NODE) nodes.push({ kind: 'RECIPE', paletteId: String(node.attrs.paletteId) });
    else
      node.forEach((child, _offset, index) => {
        if (index > 0 && child.isBlock) appendText('\n\n');
        visit(child);
      });
  };
  visit(doc);
  return normalizeCreatorPromptNodes(nodes);
}

/** A lossy prompt projection for generation. Editor updates must also publish their BlockDocument. */
export function documentFromEditor(editor: Editor) {
  return documentFromProseMirror(editor.state.doc);
}

type ComposerBridgeSnapshot = Parameters<typeof editorJsonFromNodes>[1];

export function useComposerBridgeSynchronization(editor: Editor | null, snapshot: ComposerBridgeSnapshot) {
  useLatestMicrotask(editor, snapshot, (currentEditor) => {
    if (currentEditor.isDestroyed) return;
    const bridge = composerBridge(currentEditor);
    bridge.locale = snapshot.locale;
    bridge.termPromptLocale = snapshot.termPromptLocale;
    bridge.promptProfileId = snapshot.promptProfileId;
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
              snapshot.promptProfileId,
              node.attrs.promptLocale === 'zh' || node.attrs.promptLocale === 'en'
                ? node.attrs.promptLocale
                : snapshot.termPromptLocale,
              node.attrs.editorKey ? String(node.attrs.editorKey) : undefined,
            ),
          );
        }
      } else if (node.type.name === RECIPE_NODE) {
        const paletteId = String(node.attrs.paletteId);
        if (snapshot.palettesById.has(paletteId) || snapshot.appliedByPaletteId.has(paletteId)) {
          transaction = transaction.setNodeMarkup(
            position,
            undefined,
            recipeAttributes(paletteId, snapshot, node.attrs.editorKey ? String(node.attrs.editorKey) : undefined),
          );
        }
      }
    });
    if (transaction.docChanged) currentEditor.view.dispatch(transaction);
  });
}
