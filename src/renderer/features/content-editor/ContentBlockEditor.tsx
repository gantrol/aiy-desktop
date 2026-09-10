import { imageMimeType } from '@/renderer/components/creator/imageImport';
import { contentEditorInteractions } from '@/renderer/features/content-editor/contentEditorInteractions';
import {
  createDocumentImageExtension,
  DocumentImageMediaStore,
  normalizedMediaPath,
  type ContentEditorMedia,
} from '@/renderer/features/content-editor/contentImageExtension';
import { beginContentImageInsertion } from '@/renderer/features/content-editor/contentImageInsertion';
import {
  contentImagesRecoverable,
  registerContentImageRecovery,
} from '@/renderer/features/content-editor/contentImageRecovery';
import { ContentInputOperations } from '@/renderer/features/content-editor/contentInputOperations';
import { contentReferenceExtension } from '@/renderer/features/content-editor/ContentReferenceExtension';
import { ContentReferencePicker } from '@/renderer/features/content-editor/ContentReferencePicker';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import {
  activeArticleElementId,
  activeArticleOutlineHeadingIndex,
  articleCheckBlocks,
  articleCommentAnchorRect,
  articleCommentTargetResolution,
  articleElementIdentityTransaction,
  captureArticleCommentTarget,
  captureArticleEditorLocation,
  captureArticleViewportLocation,
  createArticleElementIdentityExtension,
  focusArticleElement,
  mappedArticleCommentAnchors,
  resolveArticleCommentLocation,
  resolveArticleOutlineHeadingLocation,
  restoreArticleEditorLocation,
  revealArticleEditorLocation,
} from '@/renderer/features/video-documents/articleElementIdentity';
import { hydrateArticleElementJsonIdentities } from '@/renderer/features/video-documents/articleElementJsonIdentity';
import { normalizeMarkdownForWysiwyg } from '@/renderer/features/video-documents/markdownForWysiwyg';
import { useArticleCommentDomInteractions } from '@/renderer/features/video-documents/useArticleCommentDomInteractions';
import { useArticleElementEditorEffects } from '@/renderer/features/video-documents/useArticleElementEditorEffects';
import { VideoDocumentEditorChrome } from '@/renderer/features/video-documents/VideoDocumentEditorChrome';
import { useVideoDocumentEditorComposition } from '@/renderer/features/video-documents/videoDocumentEditorComposition';
import {
  insertVideoDocumentImage,
  videoDocumentFrameImageAttributes,
} from '@/renderer/features/video-documents/videoDocumentEditorMedia';
import {
  publishVideoDocumentEditor,
  type VideoDocumentWysiwygPersistenceSnapshot,
} from '@/renderer/features/video-documents/videoDocumentEditorPublication';
import { VideoDocumentEditorSurfaces } from '@/renderer/features/video-documents/VideoDocumentEditorSurfaces';
import type {
  VideoDocumentWysiwygEditorProps as Props,
  VideoDocumentQuickInsertNoteRequest,
  VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { materialImageDropHandler } from '@/renderer/features/video-documents/videoDocumentMaterialImageDrop';
import type { VideoDocumentSearchReplaceMode } from '@/renderer/features/video-documents/VideoDocumentSearchReplace';
import { useVideoDocumentSplitEditorView } from '@/renderer/features/video-documents/videoDocumentSplitEditorView';
import {
  importVideoDocumentEditorImage,
  type VideoDocumentArticleElementControls,
  type VideoDocumentEditorImageImport,
  type VideoDocumentWysiwygToolbarState,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type {
  CreatorImageImportSource,
  VideoDocumentFrameCaptureResult,
  VideoDocumentMediaBinding,
} from '@/shared/contracts';
import { blockDocumentImportIds, captureBlockDocument } from '@/shared/contracts/block-document';
import type { ContentReference } from '@/shared/contracts/content-library';
import { videoDocumentRevisionMediaSchema } from '@/shared/contracts/video-document';
import type { Editor } from '@tiptap/core';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import { useEditorState } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type { VideoDocumentWysiwygPersistenceSnapshot } from '@/renderer/features/video-documents/videoDocumentEditorPublication';
export type {
  VideoDocumentQuickInsertNoteRequest,
  VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/videoDocumentEditorTypes';
export type {
  VideoDocumentArticleElementControls,
  VideoDocumentEditorImageImport,
  VideoDocumentWysiwygEditorLabels,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';

function activeHeadingLevel(editor: Editor): 0 | 2 | 3 | 4 | 5 | 6 {
  if (editor.isActive('heading', { level: 2 })) return 2;
  if (editor.isActive('heading', { level: 3 })) return 3;
  if (editor.isActive('heading', { level: 4 })) return 4;
  if (editor.isActive('heading', { level: 5 })) return 5;
  if (editor.isActive('heading', { level: 6 })) return 6;
  return 0;
}

const emptyToolbarState: VideoDocumentWysiwygToolbarState = {
  headingLevel: 0,
  bold: false,
  italic: false,
  strike: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  link: false,
  codeBlock: false,
  blockquote: false,
  table: false,
  canUndo: false,
  canRedo: false,
  image: false,
  imageSourcePath: null,
  imageAltText: '',
  selectedText: '',
  articleElementId: null,
};

function selectToolbarState(editor: Editor | null): VideoDocumentWysiwygToolbarState {
  if (!editor || editor.isDestroyed) return emptyToolbarState;
  const image = editor.isActive('image');
  const imageAttributes = image ? editor.getAttributes('image') : null;
  const { from, to } = editor.state.selection;
  return {
    headingLevel: activeHeadingLevel(editor),
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    link: editor.isActive('link'),
    codeBlock: editor.isActive('codeBlock'),
    blockquote: editor.isActive('blockquote'),
    table: editor.isActive('table'),
    canUndo: undoDepth(editor.state) > 0,
    canRedo: redoDepth(editor.state) > 0,
    image,
    imageSourcePath: typeof imageAttributes?.sourcePath === 'string' ? imageAttributes.sourcePath : null,
    imageAltText: typeof imageAttributes?.alt === 'string' ? imageAttributes.alt : '',
    selectedText: from === to ? '' : editor.state.doc.textBetween(from, to, '\n').trim(),
    articleElementId: activeArticleElementId(editor),
  };
}

function useQuickInsertNote({
  editor,
  documentId,
  request,
  onFrameCaptured,
  onBusyChange,
  onError,
}: {
  editor: Editor | null;
  documentId?: string;
  request?: VideoDocumentQuickInsertNoteRequest | null;
  onFrameCaptured?(result: VideoDocumentFrameCaptureResult): void;
  onBusyChange?(busy: boolean): void;
  onError?(): void;
}) {
  const callbacksRef = useRef({ onFrameCaptured, onBusyChange, onError });
  const handledRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    callbacksRef.current = { onFrameCaptured, onBusyChange, onError };
  }, [onBusyChange, onError, onFrameCaptured]);

  useEffect(() => {
    if (!request || !documentId || !editor || editor.isDestroyed) return undefined;
    if (handledRevisionRef.current === request.revision) return undefined;
    handledRevisionRef.current = request.revision;
    let active = true;
    let settled = false;
    callbacksRef.current.onBusyChange?.(true);
    void window.desktopApi
      .videoDocumentFrameCapture({ documentId, timestampMs: request.timestampMs })
      .then((result) => {
        if (!active || editor.isDestroyed) return;
        if (!insertVideoDocumentImage(editor, videoDocumentFrameImageAttributes(result))) {
          throw new Error('Video frame could not be inserted into the editor');
        }
        callbacksRef.current.onFrameCaptured?.(result);
      })
      .catch(() => {
        if (active) callbacksRef.current.onError?.();
      })
      .finally(() => {
        settled = true;
        if (active) callbacksRef.current.onBusyChange?.(false);
      });
    return () => {
      active = false;
      if (!settled && handledRevisionRef.current === request.revision) handledRevisionRef.current = null;
      callbacksRef.current.onBusyChange?.(false);
    };
  }, [documentId, editor, request]);
}

function useEditorRegistration(
  editor: Editor | null,
  refs: {
    editor: { current: Editor | null };
    comments: { current: VideoDocumentArticleElementControls['comments'] | undefined };
    persistence: { current: VideoDocumentWysiwygPersistenceSnapshot };
    composition: ReturnType<typeof useVideoDocumentEditorComposition>;
    inputs: ContentInputOperations;
    articleElementsEnabled: boolean;
    onHandleChange: { current: Props['onEditorHandleChange'] };
  },
) {
  useEffect(() => {
    refs.editor.current = editor;
    return () => {
      if (refs.editor.current === editor) refs.editor.current = null;
    };
  }, [editor, refs.editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      refs.onHandleChange.current?.(null, null);
      return undefined;
    }
    let capturedComments = refs.comments.current;
    let publishedSnapshot = refs.persistence.current;
    const handle: VideoDocumentWysiwygEditorHandle = {
      removeImageAssets: (assetIds) => {
        if (editor.isDestroyed || !editor.isEditable || !assetIds.length) return;
        const targets = new Set(assetIds);
        const positions: { from: number; to: number }[] = [];
        editor.state.doc.descendants((node, position) => {
          if (node.type.name === 'image' && targets.has(String(node.attrs.assetId ?? '')))
            positions.push({ from: position, to: position + node.nodeSize });
        });
        const transaction = editor.state.tr;
        for (const position of positions.reverse()) transaction.delete(position.from, position.to);
        if (transaction.docChanged) editor.view.dispatch(transaction);
      },
      getArticleCheckBlocks: () => articleCheckBlocks(editor),
      getPersistenceSnapshot: () => {
        if (refs.persistence.current !== publishedSnapshot) {
          // onUpdate publishes before notifying the session.
          capturedComments = refs.comments.current;
          publishedSnapshot = refs.persistence.current;
        }
        if (refs.composition.canReadSnapshot() && !editor.isDestroyed && capturedComments !== refs.comments.current) {
          // Selection and hydration transactions must not replace the saved document snapshot.
          refs.persistence.current = {
            ...refs.persistence.current,
            commentAnchors: refs.articleElementsEnabled
              ? mappedArticleCommentAnchors(editor, refs.comments.current ?? [])
              : [],
          };
          capturedComments = refs.comments.current;
          publishedSnapshot = refs.persistence.current;
        }
        return refs.persistence.current;
      },
      whenRecoverable: async () => {
        if (editor.isDestroyed || !(await refs.composition.whenSettled())) return false;
        const document = captureBlockDocument(editor.getJSON());
        if (blockDocumentImportIds(document).length) return contentImagesRecoverable(document);
        await refs.inputs.settle();
        return !editor.isDestroyed;
      },
      whenSettled: async () => {
        await refs.inputs.settle();
        return !editor.isDestroyed && (await refs.composition.whenSettled());
      },
      isInputPending: () => refs.inputs.isPending() || refs.composition.isInputPending(),
      subscribeInput: (listener) => {
        const a = refs.inputs.subscribe(listener),
          b = refs.composition.subscribeInput(listener);
        return () => {
          a();
          b();
        };
      },
      getArticleCommentAnchors: () => mappedArticleCommentAnchors(editor, refs.comments.current ?? []),
      getArticleCommentAnchorRect: (commentId) => articleCommentAnchorRect(editor, commentId),
      getArticleCommentTargetResolution: (commentId) => articleCommentTargetResolution(editor, commentId),
      captureArticleCommentTarget: () =>
        refs.composition.phase.current === 'idle' ? captureArticleCommentTarget(editor) : null,
      resolveArticleCommentLocation: (commentId) => resolveArticleCommentLocation(editor, commentId),
      resolveArticleOutlineHeadingLocation: (sourceIndex) => resolveArticleOutlineHeadingLocation(editor, sourceIndex),
      captureArticleLocation: () => captureArticleEditorLocation(editor),
      captureArticleViewportLocation: (scrollRoot) => captureArticleViewportLocation(editor, scrollRoot),
      revealArticleLocation: (location, scrollRoot) => revealArticleEditorLocation(editor, location, scrollRoot),
      restoreArticleLocation: (location) => restoreArticleEditorLocation(editor, location),
      focusArticleElement: (elementId) => focusArticleElement(editor, elementId),
    };
    refs.onHandleChange.current?.(handle, null);
    return () => refs.onHandleChange.current?.(null, handle);
  }, [
    editor,
    refs.articleElementsEnabled,
    refs.comments,
    refs.composition,
    refs.inputs,
    refs.onHandleChange,
    refs.persistence,
  ]);
}

interface ArticleEditorCallbackSnapshot {
  onArticleElementsChange: Props['onArticleElementsChange'];
  onArticleLocationChange: Props['onArticleLocationChange'];
  onArticleEditLocation: Props['onArticleEditLocation'];
  onArticleNavigationLocation: Props['onArticleNavigationLocation'];
}

function useImageEnqueue(
  editor: { current: Editor | null },
  queue: { current: Promise<void> },
  inputs: ContentInputOperations,
  callbacks: {
    current: {
      importImage?: Props['importImage'];
      onImageImported(result: VideoDocumentEditorImageImport): void;
      onImageImportError(): void;
    };
  },
) {
  return useCallback(
    (files: readonly File[], source: CreatorImageImportSource, importIds: readonly string[] = []) => {
      const candidates = files.filter((file) => imageMimeType(file));
      if (!candidates.length) return;
      const currentEditor = editor.current;
      if (!currentEditor || currentEditor.isDestroyed) return;
      const previous = queue.current;
      // Deferred import callbacks must not wait on the shared queue that includes their own completion.
      let importQueue = previous;
      const operations = candidates.map((file, index) =>
        beginContentImageInsertion(
          currentEditor,
          file,
          source,
          (candidate, origin, importId) => {
            const operation = importQueue
              .catch(() => undefined)
              .then(() =>
                (callbacks.current.importImage ?? importVideoDocumentEditorImage)(candidate, origin, importId),
              );
            importQueue = operation.then(
              () => undefined,
              () => undefined,
            );
            return operation;
          },
          (image) => callbacks.current.onImageImported(image),
          () => callbacks.current.onImageImportError(),
          importIds[index],
        ),
      );
      queue.current = Promise.allSettled([previous, ...operations]).then(() => undefined);
      inputs.track(queue.current);
    },
    [callbacks, editor, queue, inputs],
  );
}

function useVideoDocumentEditorRuntimeRefs(
  props: Pick<
    Props,
    | 'markdown'
    | 'document'
    | 'onDocumentChange'
    | 'articleElements'
    | 'articleElementControls'
    | 'mediaBindings'
    | 'media'
    | 'onChange'
    | 'onSave'
    | 'onEditorHandleChange'
    | 'onImageImported'
    | 'importImage'
    | 'onImageImportError'
    | 'onArticleElementsChange'
    | 'onArticleLocationChange'
    | 'onArticleEditLocation'
    | 'onArticleNavigationLocation'
  >,
) {
  const initialMarkdownRef = useRef<string | null>(null);
  if (initialMarkdownRef.current === null) initialMarkdownRef.current = normalizeMarkdownForWysiwyg(props.markdown);
  const initialArticleElementsRef = useRef(props.articleElements ?? []);
  const lastMarkdownRef = useRef(initialMarkdownRef.current);
  const persistenceSnapshotRef = useRef<VideoDocumentWysiwygPersistenceSnapshot>({
    markdown: props.markdown,
    document: props.document,
    articleElements: initialArticleElementsRef.current.map((element) => ({ ...element })),
    commentAnchors: (props.articleElementControls?.comments ?? []).map((comment) => ({
      commentId: comment.id,
      anchor: { ...comment.anchor },
    })),
  });
  const onChangeRef = useRef(props.onChange);
  const onDocumentChangeRef = useRef(props.onDocumentChange);
  onDocumentChangeRef.current = props.onDocumentChange;
  const onSaveRef = useRef(props.onSave);
  const onEditorHandleChangeRef = useRef(props.onEditorHandleChange);
  const imageImportCallbacksRef = useRef({
    importImage: props.importImage,
    onImageImported: props.onImageImported,
    onImageImportError: props.onImageImportError,
  });
  const articleCallbacksRef = useRef<ArticleEditorCallbackSnapshot>({
    onArticleElementsChange: props.onArticleElementsChange,
    onArticleLocationChange: props.onArticleLocationChange,
    onArticleEditLocation: props.onArticleEditLocation,
    onArticleNavigationLocation: props.onArticleNavigationLocation,
  });
  const articleCommentsRef = useRef(props.articleElementControls?.comments ?? []);
  articleCommentsRef.current = props.articleElementControls?.comments ?? [];
  const [imageMediaStore] = useState(
    () => new DocumentImageMediaStore({ mediaBindings: props.mediaBindings, media: props.media }),
  );
  useEffect(() => {
    imageMediaStore.update({ mediaBindings: props.mediaBindings, media: props.media });
  }, [imageMediaStore, props.mediaBindings, props.media]);

  useEffect(() => {
    onChangeRef.current = props.onChange;
    onSaveRef.current = props.onSave;
    onEditorHandleChangeRef.current = props.onEditorHandleChange;
    imageImportCallbacksRef.current = {
      importImage: props.importImage,
      onImageImported: props.onImageImported,
      onImageImportError: props.onImageImportError,
    };
    articleCallbacksRef.current = {
      onArticleElementsChange: props.onArticleElementsChange,
      onArticleLocationChange: props.onArticleLocationChange,
      onArticleEditLocation: props.onArticleEditLocation,
      onArticleNavigationLocation: props.onArticleNavigationLocation,
    };
  }, [props]);

  return {
    initialMarkdown: initialMarkdownRef.current,
    initialArticleElementsRef,
    lastMarkdownRef,
    persistenceSnapshotRef,
    onChangeRef,
    onDocumentChangeRef,
    onSaveRef,
    onEditorHandleChangeRef,
    imageImportCallbacksRef,
    articleCallbacksRef,
    articleCommentsRef,
    imageMediaStore,
  };
}

function useEditorDomProjection({
  editor,
  root,
  mediaById,
  videoBindingByPath,
}: {
  editor: Editor | null;
  root: { current: HTMLDivElement | null };
  mediaById: ReadonlyMap<string, ContentEditorMedia>;
  videoBindingByPath: ReadonlyMap<string, VideoDocumentMediaBinding>;
}) {
  useEffect(() => {
    if (!editor) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const headings = root.current?.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6') ?? [];
      headings.forEach((heading, index) => {
        heading.dataset.articleHeadingId = `article-heading-${index + 1}`;
      });
      const links = root.current?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [];
      links.forEach((link) => {
        const path = normalizedMediaPath(link.getAttribute('href') ?? '');
        const binding = videoBindingByPath.get(path);
        if (!binding) {
          delete link.dataset.videoBinding;
          link.style.removeProperty('background-image');
          return;
        }
        link.dataset.videoBinding = 'true';
        const poster = binding.posterAssetId ? mediaById.get(binding.posterAssetId) : null;
        link.style.backgroundImage = poster
          ? `var(--image-overlay-copy-scrim), url(${JSON.stringify(poster.mediaUrl)})`
          : 'var(--image-overlay-copy-scrim)';
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, mediaById, root, videoBindingByPath]);
}

function ContentBlockEditorSession(props: Props) {
  const runtimeRefs = useVideoDocumentEditorRuntimeRefs(props);
  const {
    initialMarkdown,
    initialArticleElementsRef,
    lastMarkdownRef,
    persistenceSnapshotRef,
    onChangeRef,
    onDocumentChangeRef,
    onSaveRef,
    onEditorHandleChangeRef,
    imageImportCallbacksRef,
    articleCallbacksRef,
    articleCommentsRef,
    imageMediaStore,
  } = runtimeRefs;
  const notifyActiveHeading = useStableCallback((index: number | null) => props.onActiveHeadingChange?.(index));
  const editorRootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const publishDocumentRef = useRef<(editor: Editor, identityChanged: boolean) => void>(() => undefined);
  const composition = useVideoDocumentEditorComposition({ editor: editorRef, publish: publishDocumentRef });
  const [searchReplaceMode, setSearchReplaceMode] = useState<VideoDocumentSearchReplaceMode>(null);
  const imageImportQueueRef = useRef(Promise.resolve());
  const [inputs] = useState(() => new ContentInputOperations());
  const [initialDocument] = useState(props.document);

  const enqueueImages = useImageEnqueue(editorRef, imageImportQueueRef, inputs, imageImportCallbacksRef);

  const imageExtension = useMemo(
    () => createDocumentImageExtension(imageMediaStore, props.compact),
    [imageMediaStore, props.compact],
  );
  const articleElementsEnabled = props.articleElements !== undefined;
  const articleElementHydrationReadyRef = useRef(!articleElementsEnabled);
  publishDocumentRef.current = (current, identityChanged) => {
    publishVideoDocumentEditor(current, identityChanged, articleElementsEnabled, {
      persistence: persistenceSnapshotRef,
      comments: articleCommentsRef,
      lastMarkdown: lastMarkdownRef,
      onChange: onChangeRef,
      onDocumentChange: onDocumentChangeRef,
      callbacks: articleCallbacksRef,
    });
    notifyActiveHeading(activeArticleOutlineHeadingIndex(current));
  };
  const articleElementExtension = useMemo(
    () =>
      articleElementsEnabled
        ? createArticleElementIdentityExtension(() => articleCommentsRef.current, composition.isInputPending)
        : null,
    [articleCommentsRef, articleElementsEnabled, composition],
  );
  const videoBindingByPath = useMemo(
    () =>
      new Map(
        props.mediaBindings
          .filter((binding) => binding.kind === 'VIDEO')
          .map((binding) => [normalizedMediaPath(binding.path), binding]),
      ),
    [props.mediaBindings],
  );
  const mediaById = useMemo(() => new Map(props.media.map((item) => [item.assetId, item])), [props.media]);
  const adoptReference = useStableCallback((reference: ContentReference) => {
    for (const image of reference.media) {
      const media = videoDocumentRevisionMediaSchema.parse({
        assetId: image.assetId,
        mediaUrl: image.mediaUrl,
        mimeType: image.mimeType,
        width: Math.max(1, image.width),
        height: Math.max(1, image.height),
        byteSize: Math.max(1, image.byteSize),
        durationMs: null,
      });
      props.onImageImported({
        binding: {
          path: image.path,
          assetId: image.assetId,
          kind: image.mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
          timestampMs: null,
          endTimestampMs: null,
          posterAssetId: null,
        },
        media,
      });
    }
  });
  const referencesExtension = useMemo(() => contentReferenceExtension(adoptReference), [adoptReference]);
  const extensions = useMemo(
    () => [imageExtension, referencesExtension, ...(articleElementExtension ? [articleElementExtension] : [])],
    [articleElementExtension, imageExtension, referencesExtension],
  );
  const materialDrop = materialImageDropHandler(editorRef, imageImportQueueRef, imageImportCallbacksRef);
  const editor = useContentEditor(
    {
      extensions,
      editable: !props.readOnly,
      content: initialDocument?.root ?? initialMarkdown,
      ...(initialDocument ? {} : { contentType: 'markdown' as const }),
      enableContentCheck: true,
      immediatelyRender: true,
      onBeforeCreate: ({ editor: initializingEditor }) => {
        const content = initializingEditor.options.content;
        if (!content || typeof content !== 'object' || Array.isArray(content)) return;
        const root = captureBlockDocument(content, props.mediaBindings).root;
        if (!initialDocument && articleElementsEnabled)
          hydrateArticleElementJsonIdentities(root, initialArticleElementsRef.current);
        initializingEditor.options.content = root;
      },
      editorProps: contentEditorInteractions({
        props,
        composition,
        editorRef,
        editorRootRef,
        articleCallbacksRef,
        onSaveRef,
        persistenceSnapshotRef,
        enqueueImages,
        materialDrop,
        imageImportQueueRef,
        inputs,
      }),
      onUpdate: ({ editor: current, transaction, appendedTransactions }) => {
        if (!transaction.docChanged && !appendedTransactions.some((appended) => appended.docChanged)) return;
        if (
          composition.defers(current, transaction) ||
          appendedTransactions.some(composition.defers.bind(null, current))
        )
          return;
        const identityChanged =
          articleElementHydrationReadyRef.current &&
          [transaction, ...appendedTransactions].some(articleElementIdentityTransaction);
        publishDocumentRef.current(current, identityChanged);
      },
      onSelectionUpdate: ({ editor: current }) => {
        if (composition.phase.current !== 'idle' || current.view.composing) return;
        notifyActiveHeading(activeArticleOutlineHeadingIndex(current));
        const location = articleElementsEnabled ? captureArticleEditorLocation(current) : null;
        if (location) articleCallbacksRef.current.onArticleLocationChange?.(location);
      },
    },
    [extensions],
  );
  const secondaryEditorRootRef = useMemo(
    () => ({ current: props.secondaryEditorRoot ?? null }),
    [props.secondaryEditorRoot],
  );
  useEffect(() => {
    // Changing editability must not publish the loaded document as a user edit.
    if (editor && !editor.isDestroyed) editor.setEditable(!props.readOnly, false);
  }, [editor, props.readOnly]);
  useVideoDocumentSplitEditorView({
    ariaLabel: props.secondaryAriaLabel ?? props.ariaLabel,
    editor,
    root: props.secondaryEditorRoot ?? null,
  });

  const finishComposition = useArticleElementEditorEffects({
    editor,
    enabled: articleElementsEnabled,
    initialElements: initialArticleElementsRef,
    callbacks: articleCallbacksRef,
    comments: props.articleElementControls?.comments,
    compositionPhase: composition.phase,
    hydrationReady: articleElementHydrationReadyRef,
  });
  composition.finish.current = (view) => {
    view.dispatch(view.state.tr.setMeta('blockIdentityRepair', true));
    return finishComposition(view);
  };

  useEditorRegistration(editor, {
    editor: editorRef,
    comments: articleCommentsRef,
    persistence: persistenceSnapshotRef,
    composition,
    inputs,
    articleElementsEnabled,
    onHandleChange: onEditorHandleChangeRef,
  });

  useEditorDomProjection({ editor, root: editorRootRef, mediaById, videoBindingByPath });
  useEditorDomProjection({ editor, root: secondaryEditorRootRef, mediaById, videoBindingByPath });
  useArticleCommentDomInteractions(editorRootRef, props.articleElementControls, Boolean(editor));
  useArticleCommentDomInteractions(
    secondaryEditorRootRef,
    props.articleElementControls,
    Boolean(editor && props.secondaryEditorRoot),
  );

  useQuickInsertNote({
    editor,
    documentId: props.documentId,
    request: props.quickInsertNoteRequest,
    onFrameCaptured: props.onFrameCaptured,
    onBusyChange: props.onQuickInsertNoteBusyChange,
    onError: props.onQuickInsertNoteError,
  });

  useEffect(() => {
    if (!editor) return;
    const unregister = registerContentImageRecovery(editor, {
      imported: (result) => imageImportCallbacksRef.current.onImageImported(result),
      failed: () => imageImportCallbacksRef.current.onImageImportError(),
      track: inputs.track,
    });
    return () => {
      unregister();
    };
  }, [editor, imageImportCallbacksRef, inputs]);

  const state =
    useEditorState({
      editor,
      selector: ({ editor: current }) => selectToolbarState(current),
    }) ?? emptyToolbarState;

  if (!editor || editor.isDestroyed) return null;

  return (
    <VideoDocumentEditorSurfaces
      toolbarRoot={props.toolbarRoot}
      contentSource={
        props.contentSource ?? (props.documentId ? { kind: 'VIDEO_DOCUMENT', id: props.documentId } : undefined)
      }
      embedded={props.embedded}
      chrome={
        props.toolbarVisible !== false &&
        !props.readOnly && (
          <VideoDocumentEditorChrome
            referenceAction={
              !props.readOnly && (
                <ContentReferencePicker
                  onInsert={(reference) => {
                    adoptReference(reference);
                    editor
                      .chain()
                      .focus()
                      .insertContent({ type: 'contentReference', attrs: { referenceId: reference.id } })
                      .run();
                  }}
                />
              )
            }
            editor={editor}
            props={props}
            onImageOperation={inputs.track}
            searchReplaceMode={searchReplaceMode}
            setSearchReplaceMode={setSearchReplaceMode}
            state={state}
          />
        )
      }
      editor={editor}
      editorRootRef={editorRootRef}
      secondaryChromeRoot={props.secondaryChromeRoot}
    />
  );
}

export function ContentBlockEditor(props: Props) {
  const sessionIdentity = props.sessionIdentity ?? 'unversioned';
  return <ContentBlockEditorSession key={sessionIdentity} {...props} />;
}
