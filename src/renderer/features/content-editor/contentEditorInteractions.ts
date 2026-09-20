import { commandMatchesShortcut } from '@/renderer/commands/app-shortcuts';
import { imageFiles, imageMimeType } from '@/renderer/components/creator/imageImport';
import { pasteContentImages } from '@/renderer/features/content-editor/contentImagePaste';
import type { ContentInputOperations } from '@/renderer/features/content-editor/contentInputOperations';
import type { useVideoDocumentEditorComposition } from '@/renderer/features/video-documents/videoDocumentEditorComposition';
import { followInternalArticleHeadingLink } from '@/renderer/features/video-documents/videoDocumentEditorNavigation';
import type { VideoDocumentWysiwygEditorProps as Props } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import type { materialImageDropHandler } from '@/renderer/features/video-documents/videoDocumentMaterialImageDrop';
import type { CreatorImageImportSource } from '@/shared/contracts';
import type { Editor, EditorOptions } from '@tiptap/core';

type Ref<T> = { current: T };
interface Options {
  props: Pick<Props, 'mediaIntake' | 'onInputPendingChange'>;
  composition: ReturnType<typeof useVideoDocumentEditorComposition>;
  editorRef: Ref<Editor | null>;
  editorRootRef: Ref<HTMLDivElement | null>;
  articleCallbacksRef: Ref<Pick<Props, 'onArticleNavigationLocation'>>;
  onSaveRef: Ref<Props['onSave']>;
  persistenceSnapshotRef: Ref<{ markdown: string }>;
  enqueueImages(files: readonly File[], source: CreatorImageImportSource, importIds?: readonly string[]): void;
  materialDrop: ReturnType<typeof materialImageDropHandler>;
  imageImportQueueRef: Ref<Promise<void>>;
  inputs: ContentInputOperations;
}
export function contentEditorInteractions({
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
}: Options): EditorOptions['editorProps'] {
  return {
    attributes: {
      class:
        '[&_a[data-video-binding]]:flex [&_a[data-video-binding]]:aspect-video [&_a[data-video-binding]]:items-end [&_a[data-video-binding]]:rounded-md [&_a[data-video-binding]]:border [&_a[data-video-binding]]:bg-media-surround-dark [&_a[data-video-binding]]:bg-cover [&_a[data-video-binding]]:bg-center [&_a[data-video-binding]]:p-4 [&_a[data-video-binding]]:font-medium [&_a[data-video-binding]]:text-media-checker-a [&_a[data-video-binding]]:no-underline',
    },
    handleDOMEvents: {
      compositionstart: (view) => {
        props.onInputPendingChange?.(true);
        return composition.start(view);
      },
      compositionend: (view) => {
        const result = composition.end(view);
        void composition.whenSettled().then((settled) => {
          if (settled) props.onInputPendingChange?.(false);
        });
        return result;
      },
    },
    handleClick: (view, _position, event) =>
      followInternalArticleHeadingLink(
        editorRef.current,
        view.dom.closest<HTMLElement>('[data-slot="video-document-wysiwyg-editor"]') ?? editorRootRef.current,
        event,
        articleCallbacksRef.current.onArticleNavigationLocation,
      ),
    handlePaste: (_view, event, slice) => {
      if (props.mediaIntake === 'EXTERNAL') return false;
      const editor = editorRef.current;
      return editor ? pasteContentImages(editor, event, slice, enqueueImages) : false;
    },
    handleDrop: (view, event, _slice, moved) => {
      if (moved) return false;
      if (props.mediaIntake === 'EXTERNAL') return false;
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return false;
      if (window.desktopApi && materialDrop(view, event)) {
        inputs.track(imageImportQueueRef.current);
        return true;
      }
      const files = imageFiles(dataTransfer.files).filter((file) => imageMimeType(file));
      if (!files.length) return false;
      event.preventDefault();
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (position) editorRef.current?.commands.setTextSelection(position.pos);
      enqueueImages(files, 'DROP');
      return true;
    },
    handleKeyDown: (_view, event) => {
      if (commandMatchesShortcut(event, window.desktopApi?.appPlatform ?? 'win32', 'document.save')) {
        event.preventDefault();
        onSaveRef.current(persistenceSnapshotRef.current.markdown);
        return true;
      }
      return false;
    },
  };
}
