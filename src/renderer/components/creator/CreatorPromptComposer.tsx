import { normalizeCreatorPromptNodes } from '@/renderer/components/creator/creatorPromptDocument';
import { createImagePromptPlan, ImagePromptPlanExtension } from '@/renderer/components/creator/imagePromptPlan';
import { CreatorPromptEditorSurface } from '@/renderer/components/creator/CreatorPromptEditorSurface';
import { imageFiles, imageMimeType } from '@/renderer/components/creator/imageImport';
import { type AppliedWordPalette } from '@/renderer/components/creator/utils';
import {
  activeWordPaletteRecipeDrag,
  activeWordPaletteTermDrag,
  clearWordPaletteRecipeDrag,
  clearWordPaletteTermDrag,
  readWordPaletteRecipeDrag,
  readWordPaletteTermDrag,
} from '@/renderer/components/palette/wordPaletteInteractions';
import { beginContentImageInsertion } from '@/renderer/features/content-editor/contentImageInsertion';
import { pasteContentImages } from '@/renderer/features/content-editor/contentImagePaste';
import { registerContentImageRecovery } from '@/renderer/features/content-editor/contentImageRecovery';
import { ContentInputOperations } from '@/renderer/features/content-editor/contentInputOperations';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import { useVideoDocumentEditorComposition } from '@/renderer/features/video-documents/videoDocumentEditorComposition';
import {
  importVideoDocumentEditorImage,
  type ImportedEditorImage,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { useExternalEditorDocument } from '@/renderer/hooks/useExternalEditorDocument';
import { plainTextBlockDocument } from '@/shared/block-document-codecs';
import type { CreatorPromptNodeInput, Locale, TermListItem, WordPaletteDto } from '@/shared/contracts';
import { blockDocumentIsEmpty, captureBlockDocument, type BlockDocument } from '@/shared/contracts/block-document';
import { type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import {
  composerBridge,
  ComposerCallbacks,
  CreatorRecipeNode,
  CreatorTermNode,
  documentFromEditor,
  editorJsonFromNodes,
  RECIPE_NODE,
  recipeAttributes,
  TERM_NODE,
  termAttributes,
  useComposerBridgeSynchronization,
} from '@/renderer/components/creator/creatorPromptNodes';

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
  getDocument(): BlockDocument;
  hasPendingInput(): boolean;
  whenSettled(): Promise<void>;
  appendText(value: string): void;
  setImagePromptPlan(prompts: readonly string[], copy: Parameters<typeof createImagePromptPlan>[1]): void;
  reconcileReferences(termIds: readonly string[], paletteIds: readonly string[]): void;
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
  promptProfileId: string;
  nodes: CreatorPromptNodeInput[];
  document?: BlockDocument;
  onImageImported?(image: ImportedEditorImage): void;
  onImageImportError?(): void;
  terms: TermListItem[];
  palettes: WordPaletteDto[];
  appliedPalettes: AppliedWordPalette[];
  placeholder: string;
  ariaLabel: string;
  fullWindow?: boolean;
  onNodesChange(nodes: CreatorPromptNodeInput[], document: BlockDocument): void;
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
    promptProfileId,
    nodes,
    document,
    onImageImported,
    onImageImportError,
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
    () => ({ locale, termPromptLocale, promptProfileId, termsById, palettesById, appliedByPaletteId }),
    [appliedByPaletteId, locale, palettesById, promptProfileId, termPromptLocale, termsById],
  );
  const callbacksRef = useRef<ComposerCallbacks>({
    nodesChanged: onNodesChange,
    openTerm: onOpenTerm,
    openRecipe: onOpenRecipe,
    configureRecipe: onConfigureRecipe,
    changeRecipeLocale: onRecipePromptLocaleChange,
    requestRecipeInsert: onRequestRecipeInsert,
  });
  const [editorIsEmpty, setEditorIsEmpty] = useState(() =>
    document ? blockDocumentIsEmpty(document) : normalizeCreatorPromptNodes(nodes).length === 0,
  );
  callbacksRef.current = {
    nodesChanged: onNodesChange,
    openTerm: onOpenTerm,
    openRecipe: onOpenRecipe,
    configureRecipe: onConfigureRecipe,
    changeRecipeLocale: onRecipePromptLocaleChange,
    requestRecipeInsert: onRequestRecipeInsert,
  };
  const initialContent = useMemo(
    () => document?.root ?? captureBlockDocument(editorJsonFromNodes(nodes, bridgeSnapshot)).root,
    [],
  );
  const editorRef = useRef<Editor | null>(null);
  const [inputs] = useState(() => new ContentInputOperations());
  const importCallbacks = useRef({ onImageImported, onImageImportError });
  importCallbacks.current = { onImageImported, onImageImportError };
  const publish = useRef((current: Editor) => {
    const document = captureBlockDocument(current.getJSON());
    setEditorIsEmpty(blockDocumentIsEmpty(document));
    callbacksRef.current.nodesChanged(documentFromEditor(current), document);
  });
  const composition = useVideoDocumentEditorComposition({ editor: editorRef, publish });
  composition.finish.current = (view) => {
    const before = view.state.doc;
    view.dispatch(view.state.tr.setMeta('blockIdentityRepair', true));
    return before !== view.state.doc;
  };
  const imageQueue = useRef(Promise.resolve());
  const enqueueImages = (files: readonly File[], source: 'PASTE' | 'DROP', importIds: readonly string[] = []) => {
    const current = editorRef.current;
    if (!current) return;
    for (const [index, file] of files.filter((candidate) => imageMimeType(candidate)).entries())
      inputs.track(
        beginContentImageInsertion(
          current,
          file,
          source,
          (file, source, importId) => {
            const operation = imageQueue.current.then(() => importVideoDocumentEditorImage(file, source, importId));
            imageQueue.current = operation.then(
              () => undefined,
              () => undefined,
            );
            return operation;
          },
          (image) => importCallbacks.current.onImageImported?.(image),
          () => importCallbacks.current.onImageImportError?.(),
          importIds[index],
        ),
      );
  };
  const extensions = useMemo(() => [CreatorTermNode, CreatorRecipeNode, ImagePromptPlanExtension], []);
  const editor = useContentEditor({
    presentation: {
      typography: 'compact',
      ariaLabel,
      className: 'min-h-48 px-5 pt-2 pb-5',
    },
    extensions,
    content: initialContent,
    editorProps: {
      attributes: {
        'data-generation-prompt': 'true',
      },
      handleDOMEvents: {
        compositionstart: composition.start,
        compositionend: composition.end,
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
      handlePaste: (_view, event, slice) => {
        const editor = editorRef.current;
        return editor ? pasteContentImages(editor, event, slice, enqueueImages) : false;
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
              termAttributes(term, bridge.promptProfileId, bridge.termPromptLocale, termPayload.nodeKey),
              coordinates.pos,
              termPayload.nodeKey,
            );
          }
          clearWordPaletteTermDrag();
          return true;
        }
        const recipePayload = readWordPaletteRecipeDrag(event.dataTransfer);
        if (!recipePayload) {
          const files = imageFiles(event.dataTransfer.files);
          if (!files.length) return false;
          event.preventDefault();
          currentEditor.commands.setTextSelection(coordinates.pos);
          enqueueImages(files, 'DROP');
          return true;
        }
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
    onCreate: ({ editor: current }) => setEditorIsEmpty(blockDocumentIsEmpty({ root: current.getJSON() })),
    onUpdate: ({ editor: current, transaction }) => {
      if (!composition.defers(current, transaction)) publish.current(current);
    },
  });
  editorRef.current = editor;

  useComposerBridgeSynchronization(editor, bridgeSnapshot);
  useEffect(() => {
    if (!editor) return;
    const unregister = registerContentImageRecovery(editor, {
      imported: (image) => importCallbacks.current.onImageImported?.(image),
      failed: () => importCallbacks.current.onImageImportError?.(),
      track: inputs.track,
    });
    return () => {
      unregister();
    };
  }, [editor, inputs]);

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

  const desired = { nodes, document };
  useExternalEditorDocument({
    editor,
    nodes: [desired],
    signature: document ? JSON.stringify(document) : JSON.stringify(normalizeCreatorPromptNodes(nodes)),
    bridge: bridgeSnapshot,
    currentSignature: (current) =>
      document ? JSON.stringify(captureBlockDocument(current.getJSON())) : JSON.stringify(documentFromEditor(current)),
    content: ([value], bridge) =>
      value.document?.root ?? captureBlockDocument(editorJsonFromNodes(value.nodes, bridge)).root,
    onContentChange: (current) => setEditorIsEmpty(blockDocumentIsEmpty({ root: current.getJSON() })),
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
      hasPendingInput: () => composition.isInputPending() || inputs.isPending(),
      whenSettled: async () => {
        do {
          if (!(await composition.whenSettled())) throw new Error('EDITOR_INPUT_UNSETTLED');
          await inputs.settle();
          // Another composition can start while a pasted image is importing.
          // Capture only when both input sources have finished in the same turn.
        } while (composition.isInputPending() || inputs.isPending());
        if (!composition.canReadSnapshot()) throw new Error('EDITOR_INPUT_UNSETTLED');
      },
      appendText(value) {
        if (!editor || !value) return;
        editor.commands.insertContentAt(
          editor.state.doc.content.size,
          plainTextBlockDocument(value).root.content ?? [],
        );
      },
      setImagePromptPlan(prompts, copy) {
        if (!editor) return;
        const transaction = editor.state.tr;
        const ranges: { from: number; to: number }[] = [];
        editor.state.doc.forEach((node, from) => {
          if (node.type.name === 'blockquote' && node.attrs.imagePromptPlan === true)
            ranges.push({ from, to: from + node.nodeSize });
        });
        for (const range of [...ranges].reverse()) transaction.delete(range.from, range.to);
        if (prompts.length)
          transaction.insert(
            ranges[0]?.from ?? transaction.doc.content.size,
            editor.schema.nodeFromJSON(createImagePromptPlan(prompts, copy)),
          );
        if (transaction.docChanged) editor.view.dispatch(transaction);
      },
      reconcileReferences(termIds, paletteIds) {
        if (!editor) return;
        const desiredTerms = new Set(termIds);
        const desiredRecipes = new Set(paletteIds);
        const removals: Array<{ from: number; to: number }> = [];
        editor.state.doc.descendants((node, from) => {
          if (node.type.name === TERM_NODE && !desiredTerms.delete(String(node.attrs.termId)))
            removals.push({ from, to: from + node.nodeSize });
          if (node.type.name === RECIPE_NODE && !desiredRecipes.delete(String(node.attrs.paletteId)))
            removals.push({ from, to: from + node.nodeSize });
        });
        const transaction = editor.state.tr;
        for (const range of removals.reverse()) transaction.delete(range.from, range.to);
        const additions = [...desiredTerms].flatMap((id) => {
          const term = termsById.get(id);
          return term
            ? [editor.schema.nodes[TERM_NODE].create(termAttributes(term, promptProfileId, termPromptLocale))]
            : [];
        });
        for (const id of desiredRecipes)
          additions.push(editor.schema.nodes[RECIPE_NODE].create(recipeAttributes(id, bridgeSnapshot)));
        if (additions.length)
          transaction.insert(transaction.doc.content.size, editor.schema.nodes.paragraph.create(null, additions));
        if (transaction.docChanged) editor.view.dispatch(transaction);
      },
      getDocument() {
        if (!composition.canReadSnapshot()) throw new Error('EDITOR_INPUT_UNSETTLED');
        return captureBlockDocument(editor?.getJSON() ?? initialContent);
      },
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
              attrs: termAttributes(term, promptProfileId, termPromptLocale),
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
          editor.view.dispatch(transaction);
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
    <CreatorPromptEditorSurface
      editor={editor}
      empty={editorIsEmpty}
      fullWindow={fullWindow}
      placeholder={placeholder}
    />
  );
});
