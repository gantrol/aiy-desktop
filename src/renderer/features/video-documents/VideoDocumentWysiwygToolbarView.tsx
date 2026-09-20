import { beginContentImageInsertion } from '@/renderer/features/content-editor/contentImageInsertion';
import { CompactContentToolbar } from '@/renderer/features/content-editor/CompactContentToolbar';
import { useI18n } from '@/renderer/i18n/useI18n';
import { VideoDocumentFramePicker } from '@/renderer/features/video-documents/VideoDocumentFramePicker';
import { VideoDocumentImageOperations } from '@/renderer/features/video-documents/VideoDocumentImageOperations';
import {
  VideoDocumentTableMenu,
  VideoDocumentTableOperations,
} from '@/renderer/features/video-documents/VideoDocumentTableControls';
import {
  insertVideoDocumentImage,
  videoDocumentFrameImageAttributes,
} from '@/renderer/features/video-documents/videoDocumentEditorMedia';
import { cn } from '@/renderer/lib/utils';
import { Separator } from '@/renderer/components/ui/separator';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import {
  ArticleElementReviewButtons,
  ArticleInteractionButtons,
  FormatButton,
  HeadingMenu,
  LinkMenu,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { Props } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import {
  BoldIcon,
  Code2Icon,
  ImagePlusIcon,
  ItalicIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  SearchIcon,
  StrikethroughIcon,
  Undo2Icon,
  UploadIcon,
} from 'lucide-react';
import type { ChangeEvent, ReactNode, RefObject } from 'react';
import { useRef, useState } from 'react';

type ViewProps = Omit<Props, 'importImage'> & {
  importImage: NonNullable<Props['importImage']>;
};

function useImageUpload({
  editor,
  importImage,
  onImageOperation,
  onImageImported,
  onImageImportError,
}: Pick<ViewProps, 'editor' | 'importImage' | 'onImageOperation' | 'onImageImported' | 'onImageImportError'>) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  async function uploadImage(file: File) {
    setUploadingImage(true);
    try {
      await beginContentImageInsertion(editor, file, 'UPLOAD', importImage, onImageImported, onImageImportError);
    } catch {
      if (!editor.isDestroyed) onImageImportError();
    } finally {
      setUploadingImage(false);
    }
  }

  function handleImageInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const operation = uploadImage(file);
    onImageOperation?.(operation);
  }

  return { imageInputRef, uploadingImage, handleImageInputChange };
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center gap-0.5">{children}</span>;
}

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="mx-1 h-4 shrink-0" />;
}

interface FormattingActions {
  heading: ReactNode;
  bold: ReactNode;
  italic: ReactNode;
  strike: ReactNode;
  link: ReactNode;
}

function createFormattingActions({
  editor,
  outlineMode,
  state,
  labels,
  toolbarPreset,
}: Pick<ViewProps, 'editor' | 'outlineMode' | 'state' | 'labels' | 'toolbarPreset'>): FormattingActions {
  return {
    heading: !outlineMode ? (
      <HeadingMenu editor={editor} state={state} labels={labels} textLabel={toolbarPreset === 'compact'} />
    ) : null,
    bold: (
      <FormatButton label={labels.bold} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <BoldIcon className="size-3.5" />
      </FormatButton>
    ),
    italic: (
      <FormatButton
        label={labels.italic}
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon className="size-3.5" />
      </FormatButton>
    ),
    strike: (
      <FormatButton
        label={labels.strike}
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <StrikethroughIcon className="size-3.5" />
      </FormatButton>
    ),
    link: <LinkMenu editor={editor} active={state.link} labels={labels} />,
  };
}

function createFrameAction({
  editor,
  state,
  labels,
  documentId,
  sourceVideoUrl,
  currentTimeMs = 0,
  durationMs = 0,
  timelineSegments = [],
  mediaBindings,
  onFrameCaptured,
}: Pick<
  ViewProps,
  | 'editor'
  | 'state'
  | 'labels'
  | 'documentId'
  | 'sourceVideoUrl'
  | 'currentTimeMs'
  | 'durationMs'
  | 'timelineSegments'
  | 'mediaBindings'
  | 'onFrameCaptured'
>): ReactNode {
  if (!documentId || durationMs <= 0) return null;
  const selectedImageTimestampMs = state.imageSourcePath
    ? (mediaBindings.find((binding) => binding.path === state.imageSourcePath)?.timestampMs ?? null)
    : null;
  return (
    <VideoDocumentFramePicker
      documentId={documentId}
      sourceVideoUrl={sourceVideoUrl}
      currentTimeMs={currentTimeMs}
      selectedImageTimestampMs={selectedImageTimestampMs}
      durationMs={durationMs}
      timelineSegments={timelineSegments}
      replacing={state.image}
      labels={{
        insert: labels.insertFrame,
        replace: labels.replaceFrame,
        time: labels.frameTime,
        preview: labels.framePreview,
        stepBack: labels.frameStepBack,
        stepForward: labels.frameStepForward,
        capture: labels.captureFrame,
        invalidTime: labels.invalidFrameTime,
        failed: labels.captureFrameFailed,
      }}
      onCapture={(result) => {
        if (!insertVideoDocumentImage(editor, videoDocumentFrameImageAttributes(result), state.image)) return;
        onFrameCaptured?.(result);
      }}
    />
  );
}

function ToolbarCoreGroup({ actions }: { actions: FormattingActions }) {
  return (
    <ToolbarGroup>
      {actions.heading && (
        <>
          {actions.heading}
          <ToolbarSeparator />
        </>
      )}
      {actions.bold}
      {actions.italic}
      {actions.strike}
      <ToolbarSeparator />
      {actions.link}
    </ToolbarGroup>
  );
}

function ToolbarListGroup({ editor, state, labels }: Pick<ViewProps, 'editor' | 'state' | 'labels'>) {
  return (
    <ToolbarGroup>
      <FormatButton
        label={labels.bulletList}
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListIcon className="size-3.5" />
      </FormatButton>
      <FormatButton
        label={labels.orderedList}
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrderedIcon className="size-3.5" />
      </FormatButton>
      <FormatButton
        label={labels.taskList}
        active={state.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecksIcon className="size-3.5" />
      </FormatButton>
    </ToolbarGroup>
  );
}

function ToolbarInsertGroup({ actions }: { actions: readonly ReactNode[] }) {
  const visibleActions = actions.filter(Boolean);
  return visibleActions.length ? <ToolbarGroup>{visibleActions}</ToolbarGroup> : null;
}

function ToolbarStructureGroup({ editor, state, labels }: Pick<ViewProps, 'editor' | 'state' | 'labels'>) {
  return (
    <ToolbarGroup>
      <FormatButton
        label={labels.blockquote}
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <QuoteIcon className="size-3.5" />
      </FormatButton>
      <FormatButton
        label={labels.codeBlock}
        active={state.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2Icon className="size-3.5" />
      </FormatButton>
      <VideoDocumentTableMenu editor={editor} active={state.table} labels={labels} />
      <FormatButton label={labels.horizontalRule} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <MinusIcon className="size-3.5" />
      </FormatButton>
    </ToolbarGroup>
  );
}

function ToolbarReviewGroup({
  articleElementControls,
  labels,
  onSearchToggle,
  searchOpen,
  state,
}: Pick<ViewProps, 'articleElementControls' | 'labels' | 'onSearchToggle' | 'searchOpen' | 'state'>) {
  return (
    <ToolbarGroup>
      {articleElementControls && (
        <ArticleElementReviewButtons articleElementId={state.articleElementId} controls={articleElementControls} />
      )}
      <FormatButton label={labels.search} active={searchOpen} expanded={searchOpen} onClick={onSearchToggle}>
        <SearchIcon className="size-3.5" />
      </FormatButton>
    </ToolbarGroup>
  );
}

function ToolbarHistoryGroup({ editor, labels, state }: Pick<ViewProps, 'editor' | 'labels' | 'state'>) {
  return (
    <ToolbarGroup>
      <FormatButton label={labels.undo} disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2Icon className="size-3.5" />
      </FormatButton>
      <FormatButton label={labels.redo} disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2Icon className="size-3.5" />
      </FormatButton>
    </ToolbarGroup>
  );
}

function ToolbarLayout({
  embedded,
  imageInputRef,
  onImageInputChange,
  toolbarGroups,
}: {
  embedded?: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onImageInputChange(event: ChangeEvent<HTMLInputElement>): void;
  toolbarGroups: ReactNode;
}) {
  return (
    <div
      data-slot="video-document-wysiwyg-toolbar"
      className={cn(
        'z-30 flex min-h-8 min-w-0 items-center overflow-hidden px-1.5',
        embedded
          ? 'relative bg-transparent text-inherit'
          : 'sticky top-0 min-h-9 border-b bg-background/96 backdrop-blur-sm',
      )}
    >
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-0.5">{toolbarGroups}</div>
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        className="sr-only"
        tabIndex={-1}
        onChange={onImageInputChange}
      />
    </div>
  );
}

export function VideoDocumentWysiwygToolbarView({
  toolbarPreset = 'full',
  figureAssetIds,
  embedded,
  outlineMode = false,
  interactionsEnabled = false,
  referenceAction,
  importImage,
  onImageOperation,
  editor,
  state,
  labels,
  documentId,
  sourceVideoUrl,
  currentTimeMs = 0,
  durationMs = 0,
  timelineSegments = [],
  mediaBindings,
  onFrameCaptured,
  onImageImported,
  onImageImportError,
  searchOpen,
  onSearchToggle,
  illustrationLabel,
  onIllustrationRequest,
  articleElementControls,
}: ViewProps) {
  const toolbarCopy = useI18n().messages.contentEditor.toolbar;
  const imageUpload = useImageUpload({
    editor,
    importImage,
    onImageOperation,
    onImageImported,
    onImageImportError,
  });
  const formattingActions = createFormattingActions({ editor, outlineMode, state, labels, toolbarPreset });
  const listGroup = !outlineMode ? <ToolbarListGroup editor={editor} state={state} labels={labels} /> : null;
  const uploadAction = !state.image ? (
    <FormatButton
      label={labels.uploadImage}
      disabled={imageUpload.uploadingImage}
      onClick={() => imageUpload.imageInputRef.current?.click()}
    >
      <UploadIcon className={imageUpload.uploadingImage ? 'size-3.5 animate-pulse' : 'size-3.5'} />
    </FormatButton>
  ) : null;
  const illustrationAction =
    illustrationLabel && onIllustrationRequest ? (
      <FormatButton
        label={illustrationLabel}
        disabled={!state.selectedText}
        onClick={() => onIllustrationRequest(state.selectedText)}
      >
        <ImagePlusIcon className="size-3.5" />
      </FormatButton>
    ) : null;
  const frameAction = createFrameAction({
    editor,
    state,
    labels,
    documentId,
    sourceVideoUrl,
    currentTimeMs,
    durationMs,
    timelineSegments,
    mediaBindings,
    onFrameCaptured,
  });
  const insertGroup = <ToolbarInsertGroup actions={[referenceAction, uploadAction, illustrationAction, frameAction]} />;
  const structureGroup = !outlineMode ? <ToolbarStructureGroup editor={editor} state={state} labels={labels} /> : null;
  const articleToolsGroup =
    !outlineMode && interactionsEnabled ? (
      <ToolbarGroup>
        <ArticleInteractionButtons editor={editor} state={state} />
      </ToolbarGroup>
    ) : null;
  const reviewGroup = (
    <ToolbarReviewGroup
      articleElementControls={articleElementControls}
      labels={labels}
      onSearchToggle={onSearchToggle}
      searchOpen={searchOpen}
      state={state}
    />
  );
  const historyGroup = <ToolbarHistoryGroup editor={editor} labels={labels} state={state} />;
  const toolbarGroups = (
    <>
      <ToolbarCoreGroup actions={formattingActions} />
      {listGroup && (
        <>
          <ToolbarSeparator />
          {listGroup}
        </>
      )}
      {insertGroup && (
        <>
          <ToolbarSeparator />
          {insertGroup}
        </>
      )}
      {structureGroup && (
        <>
          <ToolbarSeparator />
          {structureGroup}
        </>
      )}
      {articleToolsGroup && (
        <>
          <ToolbarSeparator />
          {articleToolsGroup}
        </>
      )}
      <ToolbarSeparator />
      {reviewGroup}
      <ToolbarSeparator />
      {historyGroup}
    </>
  );

  return (
    <TooltipProvider delayDuration={450}>
      {toolbarPreset === 'compact' ? (
        <>
          <CompactContentToolbar
            editor={editor}
            state={state}
            labels={labels}
            referenceAction={referenceAction}
            figureAssetIds={figureAssetIds}
            mediaBindings={mediaBindings}
            searchOpen={searchOpen}
            onSearchToggle={onSearchToggle}
            heading={formattingActions.heading}
            bold={formattingActions.bold}
            italic={formattingActions.italic}
            link={formattingActions.link}
            history={historyGroup}
            uploading={imageUpload.uploadingImage}
            onUpload={() => imageUpload.imageInputRef.current?.click()}
          />
          <input
            ref={imageUpload.imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
            className="sr-only"
            tabIndex={-1}
            onChange={imageUpload.handleImageInputChange}
          />
        </>
      ) : (
        <ToolbarLayout
          embedded={embedded}
          imageInputRef={imageUpload.imageInputRef}
          onImageInputChange={imageUpload.handleImageInputChange}
          toolbarGroups={toolbarGroups}
        />
      )}
      {state.table && <VideoDocumentTableOperations editor={editor} labels={labels} />}
      {state.image && (
        <VideoDocumentImageOperations
          altText={state.imageAltText}
          editor={editor}
          labels={toolbarPreset === 'compact' ? { ...labels, removeImage: toolbarCopy.removeInlineImage } : labels}
          mediaBindings={mediaBindings}
          replacing={imageUpload.uploadingImage}
          sourcePath={state.imageSourcePath}
          onReplace={() => imageUpload.imageInputRef.current?.click()}
        />
      )}
    </TooltipProvider>
  );
}
