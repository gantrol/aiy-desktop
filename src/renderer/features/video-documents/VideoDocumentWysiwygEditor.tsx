import type { Editor, JSONContent, MarkdownParseHelpers, MarkdownToken } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef } from 'react';
import type {
  VideoDocumentFrameCaptureResult,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
  VideoDocumentTimelineSegment,
} from '@/shared/contracts';
import {
  VideoDocumentWysiwygToolbar,
  type VideoDocumentEditorImageImport,
  type VideoDocumentWysiwygEditorLabels,
  type VideoDocumentWysiwygToolbarState,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import {
  insertVideoDocumentImage,
  videoDocumentFrameImageAttributes,
} from '@/renderer/features/video-documents/videoDocumentEditorMedia';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';

export type { VideoDocumentWysiwygEditorLabels } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
export type { VideoDocumentEditorImageImport } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';

export interface VideoDocumentQuickInsertNoteRequest {
  revision: number;
  timestampMs: number;
}

interface Props {
  markdown: string;
  mediaBindings: readonly VideoDocumentMediaBinding[];
  media: readonly VideoDocumentRevisionMediaDto[];
  documentId?: string;
  sourceVideoUrl?: string;
  currentTimeMs: number;
  durationMs: number;
  timelineSegments: readonly VideoDocumentTimelineSegment[];
  quickInsertNoteRequest?: VideoDocumentQuickInsertNoteRequest | null;
  ariaLabel: string;
  labels: VideoDocumentWysiwygEditorLabels;
  onChange(markdown: string): void;
  onFrameCaptured(result: VideoDocumentFrameCaptureResult): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageImportError(): void;
  onQuickInsertNoteBusyChange?(busy: boolean): void;
  onQuickInsertNoteError?(): void;
  onSave(markdown: string): void;
}

function normalizedMediaPath(value: string) {
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
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
    <NodeViewWrapper className="relative isolate my-5 block max-h-[34rem] w-full overflow-hidden rounded-lg border bg-surface-sunken">
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
          rendered: false,
        },
      };
    },
    parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
      const { mediaBindings, media } = resolveMedia();
      const bindingByPath = new Map(mediaBindings.map((binding) => [normalizedMediaPath(binding.path), binding]));
      const mediaById = new Map(media.map((item) => [item.assetId, item]));
      const sourcePath = markdownTokenText(token, 'href');
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
      const src = sourcePath || (typeof node.attrs?.src === 'string' ? node.attrs.src : '');
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
};

function selectToolbarState(editor: Editor | null): VideoDocumentWysiwygToolbarState {
  if (!editor || editor.isDestroyed) return emptyToolbarState;
  const image = editor.isActive('image');
  const imageAttributes = image ? editor.getAttributes('image') : null;
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
    canUndo: editor.can().chain().undo().run(),
    canRedo: editor.can().chain().redo().run(),
    image,
    imageSourcePath: typeof imageAttributes?.sourcePath === 'string' ? imageAttributes.sourcePath : null,
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

export function VideoDocumentWysiwygEditor({
  markdown,
  mediaBindings,
  media,
  documentId,
  sourceVideoUrl,
  currentTimeMs,
  durationMs,
  timelineSegments,
  quickInsertNoteRequest,
  ariaLabel,
  labels,
  onChange,
  onFrameCaptured,
  onImageImported,
  onImageImportError,
  onQuickInsertNoteBusyChange,
  onQuickInsertNoteError,
  onSave,
}: Props) {
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const currentMarkdownRef = useRef(markdown);
  const editorRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  }, [onChange, onSave]);

  const imageMediaRef = useRef<DocumentImageMediaSnapshot>({ mediaBindings, media });
  useEffect(() => {
    imageMediaRef.current = { mediaBindings, media };
  }, [media, mediaBindings]);
  const imageExtension = useMemo(() => createDocumentImageExtension(() => imageMediaRef.current), []);
  const videoBindingByPath = useMemo(
    () =>
      new Map(
        mediaBindings
          .filter((binding) => binding.kind === 'VIDEO')
          .map((binding) => [normalizedMediaPath(binding.path), binding]),
      ),
    [mediaBindings],
  );
  const mediaById = useMemo(() => new Map(media.map((item) => [item.assetId, item])), [media]);
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false, defaultProtocol: 'https' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      imageExtension,
      TableKit.configure({ table: { resizable: false, renderWrapper: true } }),
      Markdown,
    ],
    [imageExtension],
  );
  const editor = useEditor(
    {
      extensions,
      content: markdown,
      contentType: 'markdown',
      immediatelyRender: true,
      editorProps: {
        attributes: {
          'aria-label': ariaLabel,
          'aria-multiline': 'true',
          role: 'textbox',
          class:
            'min-h-[60vh] px-6 py-5 text-[15px] leading-7 text-foreground outline-none [&>h1:first-child]:hidden [&_h2]:mb-4 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight [&_h3]:mb-3 [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:leading-tight [&_h4]:mb-2 [&_h4]:mt-6 [&_h4]:font-semibold [&_h5]:mb-2 [&_h5]:mt-5 [&_h5]:text-sm [&_h5]:font-semibold [&_h6]:mb-2 [&_h6]:mt-4 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-wide [&_p]:my-4 [&_a]:text-selected-foreground [&_a]:underline [&_a]:decoration-selected-border [&_a]:underline-offset-4 [&_a[data-video-binding]]:flex [&_a[data-video-binding]]:aspect-video [&_a[data-video-binding]]:items-end [&_a[data-video-binding]]:rounded-lg [&_a[data-video-binding]]:border [&_a[data-video-binding]]:bg-media-surround-dark [&_a[data-video-binding]]:bg-cover [&_a[data-video-binding]]:bg-center [&_a[data-video-binding]]:p-4 [&_a[data-video-binding]]:font-medium [&_a[data-video-binding]]:text-white [&_a[data-video-binding]]:no-underline [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-sm [&_blockquote]:leading-6 [&_blockquote]:text-muted-foreground [&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-2 [&_li[data-type=taskItem]>label]:pt-1 [&_li[data-type=taskItem]>div]:min-w-0 [&_li[data-type=taskItem]>div]:flex-1 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:bg-surface-sunken [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_hr]:my-8 [&_hr]:border-border-strong [&_.tableWrapper]:my-5 [&_.tableWrapper]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:bg-surface-sunken [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-top [&_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-selectednode]:ring-selected-border',
        },
        handleKeyDown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
            event.preventDefault();
            onSaveRef.current(currentMarkdownRef.current);
            return true;
          }
          if (event.altKey && !event.ctrlKey && !event.metaKey && /^[2-6]$/.test(event.key)) {
            event.preventDefault();
            const level = Number(event.key) as 2 | 3 | 4 | 5 | 6;
            editor?.chain().focus().setHeading({ level }).run();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: current }) => {
        const nextMarkdown = current.getMarkdown();
        currentMarkdownRef.current = nextMarkdown;
        onChangeRef.current(nextMarkdown);
      },
    },
    [extensions],
  );

  useEffect(() => {
    currentMarkdownRef.current = markdown;
    if (!editor || editor.isDestroyed || editor.getMarkdown() === markdown) return;
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
  }, [editor, markdown]);

  useEffect(() => {
    if (!editor) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const headings = editorRootRef.current?.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6') ?? [];
      headings.forEach((heading, index) => {
        heading.dataset.articleHeadingId = `article-heading-${index + 1}`;
      });
      const links = editorRootRef.current?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [];
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
          ? `linear-gradient(to top, rgb(0 0 0 / 72%), transparent 58%), url(${JSON.stringify(poster.mediaUrl)})`
          : 'linear-gradient(to top, rgb(0 0 0 / 72%), rgb(0 0 0 / 18%))';
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, markdown, mediaById, videoBindingByPath]);

  useQuickInsertNote({
    editor,
    documentId,
    request: quickInsertNoteRequest,
    onFrameCaptured,
    onBusyChange: onQuickInsertNoteBusyChange,
    onError: onQuickInsertNoteError,
  });

  const state =
    useEditorState({
      editor,
      selector: ({ editor: current }) => selectToolbarState(current),
    }) ?? emptyToolbarState;

  if (!editor || editor.isDestroyed) return null;

  return (
    <div
      ref={editorRootRef}
      data-slot="video-document-wysiwyg-editor"
      className="group/editor relative min-w-0 w-full border-y bg-surface focus-within:border-selected-border"
    >
      <VideoDocumentWysiwygToolbar
        editor={editor}
        state={state}
        labels={labels}
        documentId={documentId}
        sourceVideoUrl={sourceVideoUrl}
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        timelineSegments={timelineSegments}
        mediaBindings={mediaBindings}
        onFrameCaptured={onFrameCaptured}
        onImageImported={onImageImported}
        onImageImportError={onImageImportError}
      />
      <div className="min-w-0 overflow-hidden">
        <EditorContent className="min-w-0 w-full [&>.ProseMirror]:min-w-0 [&>.ProseMirror]:w-full" editor={editor} />
      </div>
    </div>
  );
}
