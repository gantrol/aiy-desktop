import type { Editor, JSONContent, MarkdownParseHelpers, MarkdownToken } from '@tiptap/core';
import FindAndReplace from '@tiptap/extension-find-and-replace';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CreatorImageImportSource,
  VideoDocumentFrameCaptureResult,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { parseCodexThreadHref } from '@/shared/contracts/codex-thread';
import {
  importVideoDocumentEditorImage,
  type VideoDocumentEditorImageImport,
  type VideoDocumentArticleElementControls,
  type VideoDocumentWysiwygToolbarState,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import {
  clipboardHasUserText,
  clipboardImageFiles,
  imageFiles,
  imageMimeType,
} from '@/renderer/components/creator/imageImport';
import {
  insertVideoDocumentImage,
  videoDocumentFrameImageAttributes,
} from '@/renderer/features/video-documents/videoDocumentEditorMedia';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { CjkStrongMarkdown } from '@/renderer/features/video-documents/cjkStrongMarkdown';
import { normalizeMarkdownForWysiwyg } from '@/renderer/features/video-documents/markdownForWysiwyg';
import type { VideoDocumentSearchReplaceMode } from '@/renderer/features/video-documents/VideoDocumentSearchReplace';
import { VideoDocumentEditorChrome } from '@/renderer/features/video-documents/VideoDocumentEditorChrome';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { materialImageDropHandler } from '@/renderer/features/video-documents/videoDocumentMaterialImageDrop';
import { commandMatchesShortcut } from '@/renderer/commands/app-shortcuts';
import { VideoDocumentTableView } from '@/renderer/features/video-documents/videoDocumentTableView';
import { VideoDocumentEditorSurfaces } from '@/renderer/features/video-documents/VideoDocumentEditorSurfaces';
import {
  synchronizeVideoDocumentEditorSelectionFromDom,
  VideoDocumentListIndent,
} from '@/renderer/features/video-documents/videoDocumentListIndent';
import { useVideoDocumentSplitEditorView } from '@/renderer/features/video-documents/videoDocumentSplitEditorView';
import {
  activeArticleElementId,
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
  revealArticleEditorLocation,
  restoreArticleEditorLocation,
} from '@/renderer/features/video-documents/articleElementIdentity';
import { useArticleElementEditorEffects } from '@/renderer/features/video-documents/useArticleElementEditorEffects';
import { useArticleCommentDomInteractions } from '@/renderer/features/video-documents/useArticleCommentDomInteractions';
import {
  useVideoDocumentEditorComposition,
  type EditorCompositionPhase,
} from '@/renderer/features/video-documents/videoDocumentEditorComposition';
import { followInternalArticleHeadingLink } from '@/renderer/features/video-documents/videoDocumentEditorNavigation';
import {
  publishVideoDocumentEditor,
  type VideoDocumentWysiwygPersistenceSnapshot,
} from '@/renderer/features/video-documents/videoDocumentEditorPublication';
import { articleRichTextClassName } from '@/renderer/lib/articleTypography';
import type {
  VideoDocumentQuickInsertNoteRequest,
  VideoDocumentWysiwygEditorHandle,
  VideoDocumentWysiwygEditorProps as Props,
} from '@/renderer/features/video-documents/videoDocumentEditorTypes';

export type { VideoDocumentWysiwygEditorLabels } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
export type { VideoDocumentEditorImageImport } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
export type { VideoDocumentArticleElementControls } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
export type {
  VideoDocumentQuickInsertNoteRequest,
  VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/videoDocumentEditorTypes';
export type { VideoDocumentWysiwygPersistenceSnapshot } from '@/renderer/features/video-documents/videoDocumentEditorPublication';

function normalizedMediaPath(value: string) {
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function internalImageAssetId(value: string) {
  const match = /^aiy-media:\/\/asset\/([^/?#]+)(?:[?#].*)?$/u.exec(value);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

function persistentDocumentImageSource(sourcePath: string, src: string, mediaSnapshot: DocumentImageMediaSnapshot) {
  const candidate = sourcePath || src;
  const assetId = internalImageAssetId(candidate);
  if (!assetId) return candidate;
  return (
    mediaSnapshot.mediaBindings.find((binding) => binding.kind === 'IMAGE' && binding.assetId === assetId)?.path ??
    candidate
  );
}

function markdownTokenText(token: MarkdownToken, property: 'href' | 'title' | 'text') {
  const value = token[property];
  return typeof value === 'string' ? value : '';
}

interface DocumentImageMediaSnapshot {
  mediaBindings: readonly VideoDocumentMediaBinding[];
  media: readonly VideoDocumentRevisionMediaDto[];
}

function DocumentImageNodeView({ node }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const title = typeof node.attrs.title === 'string' ? node.attrs.title : undefined;
  return (
    <NodeViewWrapper className="relative isolate my-7 block max-h-[34rem] w-full overflow-hidden rounded-md bg-surface-sunken">
      {src && <ImageAmbientBackdrop src={src} loading="lazy" />}
      <img
        src={src}
        alt={alt}
        title={title}
        className="relative z-10 max-h-[34rem] w-full object-contain"
        loading="lazy"
        draggable={false}
      />
    </NodeViewWrapper>
  );
}

function createDocumentImageExtension(resolveMedia: () => DocumentImageMediaSnapshot) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        sourcePath: {
          default: null,
          parseHTML: (element) => {
            const src = element.getAttribute('src') ?? '';
            return persistentDocumentImageSource('', src, resolveMedia()) || null;
          },
          rendered: false,
        },
      };
    },
    parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
      const { mediaBindings, media } = resolveMedia();
      const bindingByPath = new Map(mediaBindings.map((binding) => [normalizedMediaPath(binding.path), binding]));
      const mediaById = new Map(media.map((item) => [item.assetId, item]));
      const sourcePath = persistentDocumentImageSource(markdownTokenText(token, 'href'), '', { mediaBindings, media });
      const binding = bindingByPath.get(normalizedMediaPath(sourcePath));
      const boundMedia = binding?.kind === 'IMAGE' ? mediaById.get(binding.assetId) : null;
      return helpers.createNode('image', {
        src: boundMedia?.mediaUrl ?? sourcePath,
        sourcePath,
        title: markdownTokenText(token, 'title') || null,
        alt: markdownTokenText(token, 'text') || null,
      });
    },
    renderMarkdown(node: JSONContent) {
      const sourcePath = typeof node.attrs?.sourcePath === 'string' ? node.attrs.sourcePath : '';
      const src = persistentDocumentImageSource(
        sourcePath,
        typeof node.attrs?.src === 'string' ? node.attrs.src : '',
        resolveMedia(),
      );
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    },
    addNodeView() {
      return ReactNodeViewRenderer(DocumentImageNodeView);
    },
  }).configure({
    HTMLAttributes: {
      class: 'my-5 max-h-[34rem] w-full rounded-lg border bg-surface-sunken object-contain',
    },
  });
}

function createVideoDocumentEditorExtensions(
  imageExtension: ReturnType<typeof createDocumentImageExtension>,
  articleElementExtension: ReturnType<typeof createArticleElementIdentityExtension> | null,
) {
  return [
    VideoDocumentListIndent,
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        defaultProtocol: 'https',
        markdownLinks: true,
        protocols: ['codex'],
        isAllowedUri: (url, { defaultValidate }) =>
          url.trimStart().toLowerCase().startsWith('codex:')
            ? parseCodexThreadHref(url) !== null
            : defaultValidate(url),
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    imageExtension,
    TableKit.configure({
      table: { resizable: false, renderWrapper: true, View: VideoDocumentTableView },
    }),
    FindAndReplace.configure({ injectCSS: false, searchDebounceMs: 0, useRegex: false }),
    CjkStrongMarkdown,
    ...(articleElementExtension ? [articleElementExtension] : []),
    Markdown,
  ];
}

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
    selectedText: from === to ? '' : editor.state.doc.textBetween(from, to, '\n').trim(),
    articleElementId: activeArticleElementId(editor),
  };
}

function selectedHeadingIndex(editor: Editor) {
  const selectionPosition = editor.state.selection.from;
  let headingIndex = 0;
  let selectedIndex: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return true;
    const level = Number(node.attrs.level);
    if (level >= 2 && level <= 6) {
      if (position <= selectionPosition) selectedIndex = headingIndex;
      headingIndex += 1;
    }
    return false;
  });
  return selectedIndex;
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
  onFrameCaptured(result: VideoDocumentFrameCaptureResult): void;
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
        callbacksRef.current.onFrameCaptured(result);
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
    composition: { current: EditorCompositionPhase };
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
    const handle: VideoDocumentWysiwygEditorHandle = {
      getArticleCheckBlocks: () => articleCheckBlocks(editor),
      getPersistenceSnapshot: () => ({
        markdown: refs.persistence.current.markdown,
        articleElements: refs.persistence.current.articleElements.map((element) => ({ ...element })),
      }),
      getArticleCommentAnchors: () => mappedArticleCommentAnchors(editor, refs.comments.current ?? []),
      getArticleCommentAnchorRect: (commentId) => articleCommentAnchorRect(editor, commentId),
      getArticleCommentTargetResolution: (commentId) => articleCommentTargetResolution(editor, commentId),
      captureArticleCommentTarget: () =>
        refs.composition.current === 'idle' ? captureArticleCommentTarget(editor) : null,
      resolveArticleCommentLocation: (commentId) => resolveArticleCommentLocation(editor, commentId),
      captureArticleLocation: () => captureArticleEditorLocation(editor),
      captureArticleViewportLocation: (scrollRoot) => captureArticleViewportLocation(editor, scrollRoot),
      revealArticleLocation: (location, scrollRoot) => revealArticleEditorLocation(editor, location, scrollRoot),
      restoreArticleLocation: (location) => restoreArticleEditorLocation(editor, location),
      focusArticleElement: (elementId) => focusArticleElement(editor, elementId),
    };
    refs.onHandleChange.current?.(handle, null);
    return () => refs.onHandleChange.current?.(null, handle);
  }, [editor, refs.comments, refs.composition, refs.onHandleChange, refs.persistence]);
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
  callbacks: {
    current: {
      onImageImported(result: VideoDocumentEditorImageImport): void;
      onImageImportError(): void;
    };
  },
) {
  return useCallback(
    (files: readonly File[], source: CreatorImageImportSource) => {
      const candidates = files.filter((file) => imageMimeType(file));
      if (!candidates.length) return;
      queue.current = queue.current.then(async () => {
        let failed = false;
        for (const file of candidates) {
          const currentEditor = editor.current;
          if (!currentEditor || currentEditor.isDestroyed) return;
          try {
            const result = await importVideoDocumentEditorImage(file, source);
            if (!insertVideoDocumentImage(currentEditor, result.attributes)) {
              throw new Error('Image could not be inserted into the editor');
            }
            callbacks.current.onImageImported(result);
          } catch {
            failed = true;
          }
        }
        const currentEditor = editor.current;
        if (failed && currentEditor && !currentEditor.isDestroyed) callbacks.current.onImageImportError();
      });
    },
    [callbacks, editor, queue],
  );
}

function useVideoDocumentEditorRuntimeRefs(
  props: Pick<
    Props,
    | 'markdown'
    | 'articleElements'
    | 'articleElementControls'
    | 'mediaBindings'
    | 'media'
    | 'onChange'
    | 'onSave'
    | 'onEditorHandleChange'
    | 'onImageImported'
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
    markdown: initialMarkdownRef.current,
    articleElements: initialArticleElementsRef.current.map((element) => ({ ...element })),
  });
  const onChangeRef = useRef(props.onChange);
  const onSaveRef = useRef(props.onSave);
  const onEditorHandleChangeRef = useRef(props.onEditorHandleChange);
  const imageImportCallbacksRef = useRef({
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
  const imageMediaRef = useRef<DocumentImageMediaSnapshot>({ mediaBindings: props.mediaBindings, media: props.media });

  useEffect(() => {
    onChangeRef.current = props.onChange;
    onSaveRef.current = props.onSave;
    onEditorHandleChangeRef.current = props.onEditorHandleChange;
    imageImportCallbacksRef.current = {
      onImageImported: props.onImageImported,
      onImageImportError: props.onImageImportError,
    };
    articleCallbacksRef.current = {
      onArticleElementsChange: props.onArticleElementsChange,
      onArticleLocationChange: props.onArticleLocationChange,
      onArticleEditLocation: props.onArticleEditLocation,
      onArticleNavigationLocation: props.onArticleNavigationLocation,
    };
    imageMediaRef.current = { mediaBindings: props.mediaBindings, media: props.media };
  }, [props]);

  return {
    initialMarkdown: initialMarkdownRef.current,
    initialArticleElementsRef,
    lastMarkdownRef,
    persistenceSnapshotRef,
    onChangeRef,
    onSaveRef,
    onEditorHandleChangeRef,
    imageImportCallbacksRef,
    articleCallbacksRef,
    articleCommentsRef,
    imageMediaRef,
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
  mediaById: ReadonlyMap<string, VideoDocumentRevisionMediaDto>;
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

function VideoDocumentWysiwygEditorSession(props: Props) {
  const runtimeRefs = useVideoDocumentEditorRuntimeRefs(props);
  const {
    initialMarkdown,
    initialArticleElementsRef,
    lastMarkdownRef,
    persistenceSnapshotRef,
    onChangeRef,
    onSaveRef,
    onEditorHandleChangeRef,
    imageImportCallbacksRef,
    articleCallbacksRef,
    articleCommentsRef,
    imageMediaRef,
  } = runtimeRefs;
  const notifyActiveHeading = useStableCallback((index: number | null) => props.onActiveHeadingChange?.(index));
  const editorRootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const publishDocumentRef = useRef<(editor: Editor, identityChanged: boolean) => void>(() => undefined);
  const composition = useVideoDocumentEditorComposition({ editor: editorRef, publish: publishDocumentRef });
  const [searchReplaceMode, setSearchReplaceMode] = useState<VideoDocumentSearchReplaceMode>(null);
  const imageImportQueueRef = useRef(Promise.resolve());

  const enqueueImages = useImageEnqueue(editorRef, imageImportQueueRef, imageImportCallbacksRef);

  const imageExtension = useMemo(() => createDocumentImageExtension(() => imageMediaRef.current), [imageMediaRef]);
  const articleElementsEnabled = props.articleElements !== undefined;
  const articleElementHydrationReadyRef = useRef(!articleElementsEnabled);
  publishDocumentRef.current = (current, identityChanged) => {
    publishVideoDocumentEditor(current, identityChanged, articleElementsEnabled, {
      persistence: persistenceSnapshotRef,
      lastMarkdown: lastMarkdownRef,
      onChange: onChangeRef,
      callbacks: articleCallbacksRef,
    });
    notifyActiveHeading(selectedHeadingIndex(current));
  };
  const articleElementExtension = useMemo(
    () => (articleElementsEnabled ? createArticleElementIdentityExtension(() => articleCommentsRef.current) : null),
    [articleCommentsRef, articleElementsEnabled],
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
  const extensions = useMemo(
    () => createVideoDocumentEditorExtensions(imageExtension, articleElementExtension),
    [articleElementExtension, imageExtension],
  );
  const materialDrop = materialImageDropHandler(editorRef, imageMediaRef, imageImportQueueRef, imageImportCallbacksRef);
  const editor = useEditor(
    {
      extensions,
      content: initialMarkdown,
      contentType: 'markdown',
      enableContentCheck: true,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          'aria-label': props.ariaLabel,
          'aria-multiline': 'true',
          role: 'textbox',
          class: `${articleRichTextClassName} min-h-[60vh] px-6 py-7 outline-none [&>p:has(>br.ProseMirror-trailingBreak:only-child)]:my-0 [&_a[data-video-binding]]:flex [&_a[data-video-binding]]:aspect-video [&_a[data-video-binding]]:items-end [&_a[data-video-binding]]:rounded-md [&_a[data-video-binding]]:border [&_a[data-video-binding]]:bg-media-surround-dark [&_a[data-video-binding]]:bg-cover [&_a[data-video-binding]]:bg-center [&_a[data-video-binding]]:p-4 [&_a[data-video-binding]]:font-medium [&_a[data-video-binding]]:text-media-checker-a [&_a[data-video-binding]]:no-underline`,
        },
        handleDOMEvents: {
          compositionstart: composition.start,
          compositionend: composition.end,
        },
        handleClick: (view, _position, event) =>
          followInternalArticleHeadingLink(
            editorRef.current,
            view.dom.closest<HTMLElement>('[data-slot="video-document-wysiwyg-editor"]') ?? editorRootRef.current,
            event,
            articleCallbacksRef.current.onArticleNavigationLocation,
          ),
        handlePaste: (_view, event) => {
          const clipboardData = event.clipboardData;
          if (!clipboardData) return false;
          const files = clipboardImageFiles(clipboardData).filter((file) => imageMimeType(file));
          if (!files.length) return false;
          if (clipboardHasUserText(clipboardData)) {
            window.setTimeout(() => enqueueImages(files, 'PASTE'), 0);
            return false;
          }
          event.preventDefault();
          enqueueImages(files, 'PASTE');
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const dataTransfer = event.dataTransfer;
          if (!dataTransfer) return false;
          if (materialDrop(view, event)) return true;
          const files = imageFiles(dataTransfer.files).filter((file) => imageMimeType(file));
          if (!files.length) return false;
          event.preventDefault();
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (position) editorRef.current?.commands.setTextSelection(position.pos);
          enqueueImages(files, 'DROP');
          return true;
        },
        handleKeyDown: (view, event) => {
          if (event.key === 'Enter' && event.repeat) {
            event.preventDefault();
            return true;
          }
          const current = editorRef.current;
          if (current && !current.isDestroyed && !event.isComposing && (event.key === 'Enter' || event.key === 'Tab')) {
            synchronizeVideoDocumentEditorSelectionFromDom(current, view);
          }
          if (commandMatchesShortcut(event, window.desktopApi.appPlatform, 'document.save')) {
            event.preventDefault();
            onSaveRef.current(persistenceSnapshotRef.current.markdown);
            return true;
          }
          for (let level = 2; level <= 6; level += 1) {
            if (!commandMatchesShortcut(event, window.desktopApi.appPlatform, `format.heading.${level}`)) continue;
            event.preventDefault();
            editorRef.current
              ?.chain()
              .setHeading({ level: level as 2 | 3 | 4 | 5 | 6 })
              .run();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: current, transaction, appendedTransactions }) => {
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
        notifyActiveHeading(selectedHeadingIndex(current));
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
  composition.finish.current = finishComposition;

  useEditorRegistration(editor, {
    editor: editorRef,
    comments: articleCommentsRef,
    persistence: persistenceSnapshotRef,
    composition: composition.phase,
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

  const state =
    useEditorState({
      editor,
      selector: ({ editor: current }) => selectToolbarState(current),
    }) ?? emptyToolbarState;

  if (!editor || editor.isDestroyed) return null;

  return (
    <VideoDocumentEditorSurfaces
      chrome={
        <VideoDocumentEditorChrome
          editor={editor}
          props={props}
          searchReplaceMode={searchReplaceMode}
          setSearchReplaceMode={setSearchReplaceMode}
          state={state}
        />
      }
      editor={editor}
      editorRootRef={editorRootRef}
      secondaryChromeRoot={props.secondaryChromeRoot}
    />
  );
}

export function VideoDocumentWysiwygEditor(props: Props) {
  const sessionIdentity = props.sessionIdentity ?? 'unversioned';
  return <VideoDocumentWysiwygEditorSession key={sessionIdentity} {...props} />;
}
