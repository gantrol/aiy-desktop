import type { Editor } from '@tiptap/core';
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Code2Icon,
  ItalicIcon,
  ImagePlusIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  MinusIcon,
  MapPinIcon,
  QuoteIcon,
  Redo2Icon,
  RouteIcon,
  SearchIcon,
  StrikethroughIcon,
  Undo2Icon,
  UnlinkIcon,
  UploadIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import type {
  ArticleEditTrailEntryDto,
  ArticleEditorLocationDto,
  ArticleCommentDto,
  AssetDto,
  CreatorImageImportSource,
  VideoDocumentFrameCaptureResult,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
  VideoDocumentTimelineSegment,
} from '@/shared/contracts';
import { imageImportItems } from '@/renderer/components/creator/imageImport';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { VideoDocumentFramePicker } from '@/renderer/features/video-documents/VideoDocumentFramePicker';
import {
  VideoDocumentTableMenu,
  VideoDocumentTableOperations,
  type VideoDocumentTableControlsLabels,
} from '@/renderer/features/video-documents/VideoDocumentTableControls';
import {
  VideoDocumentImageOperations,
  type VideoDocumentImageControlsLabels,
} from '@/renderer/features/video-documents/VideoDocumentImageOperations';
import {
  insertVideoDocumentImage,
  type VideoDocumentEditorImageAttributes,
  videoDocumentFrameImageAttributes,
} from '@/renderer/features/video-documents/videoDocumentEditorMedia';
import { cn } from '@/renderer/lib/utils';
import { commandShortcutText } from '@/renderer/commands/app-shortcuts';

export interface VideoDocumentEditorImageImport {
  binding: VideoDocumentMediaBinding;
  media: VideoDocumentRevisionMediaDto;
}

export interface ImportedEditorImage extends VideoDocumentEditorImageImport {
  attributes: VideoDocumentEditorImageAttributes;
}

function editorImageFromAsset(
  asset: AssetDto,
  fallbackByteSize: number,
  alt: string | null,
  sourcePath: string,
): ImportedEditorImage {
  if (
    asset.mimeType !== 'image/png' &&
    asset.mimeType !== 'image/jpeg' &&
    asset.mimeType !== 'image/webp' &&
    asset.mimeType !== 'image/gif' &&
    asset.mimeType !== 'image/svg+xml'
  ) {
    throw new Error('Image import produced an unsupported asset');
  }
  const mimeType = asset.mimeType;
  const binding: VideoDocumentMediaBinding = {
    path: sourcePath,
    assetId: asset.id,
    kind: 'IMAGE',
    timestampMs: null,
    endTimestampMs: null,
    posterAssetId: null,
  };
  const media: VideoDocumentRevisionMediaDto = {
    assetId: asset.id,
    mediaUrl: asset.mediaUrl,
    mimeType,
    width: asset.width,
    height: asset.height,
    byteSize: Math.max(1, asset.byteSize ?? fallbackByteSize),
    durationMs: null,
  };
  return {
    binding,
    media,
    attributes: { src: media.mediaUrl, sourcePath: binding.path, title: null, alt },
  };
}

export function videoDocumentEditorImageFromAsset(asset: AssetDto, existingPath?: string): ImportedEditorImage {
  const extension =
    asset.mimeType === 'image/png'
      ? 'png'
      : asset.mimeType === 'image/webp'
        ? 'webp'
        : asset.mimeType === 'image/gif'
          ? 'gif'
          : asset.mimeType === 'image/svg+xml'
            ? 'svg'
            : 'jpg';
  return editorImageFromAsset(asset, 1, null, existingPath ?? `assets/material-${asset.id}.${extension}`);
}

export async function importVideoDocumentEditorImage(
  file: File,
  source: CreatorImageImportSource,
): Promise<ImportedEditorImage> {
  const item = (await imageImportItems([file]))[0];
  if (!item) throw new Error('Image import produced no item');
  const assets = await window.desktopApi.creatorReferencesImport({
    context: {
      seriesId: null,
      versionId: null,
      title: '',
      titleLocale: 'en',
      source,
    },
    items: [item],
  });
  const asset = assets[0];
  if (!asset) throw new Error('Image import produced no asset');
  const extension =
    asset.mimeType === 'image/png'
      ? 'png'
      : asset.mimeType === 'image/webp'
        ? 'webp'
        : asset.mimeType === 'image/gif'
          ? 'gif'
          : asset.mimeType === 'image/svg+xml'
            ? 'svg'
            : 'jpg';
  return editorImageFromAsset(
    asset,
    item.bytes.byteLength,
    item.name || null,
    `assets/upload-${asset.id}.${extension}`,
  );
}

export interface VideoDocumentWysiwygEditorLabels
  extends VideoDocumentTableControlsLabels, VideoDocumentImageControlsLabels {
  headingMenu: string;
  paragraph: string;
  heading2: string;
  heading3: string;
  heading4: string;
  heading5: string;
  heading6: string;
  bold: string;
  italic: string;
  strike: string;
  bulletList: string;
  orderedList: string;
  taskList: string;
  link: string;
  linkUrl: string;
  applyLink: string;
  removeLink: string;
  codeBlock: string;
  blockquote: string;
  horizontalRule: string;
  searchAndReplace: string;
  search: string;
  showReplace: string;
  hideReplace: string;
  previousMatch: string;
  nextMatch: string;
  matchCase: string;
  wholeWord: string;
  replaceWith: string;
  replaceCurrent: string;
  replaceAll: string;
  closeSearch: string;
  noMatches: string;
  searchResultCount(current: number, total: number): string;
  undo: string;
  redo: string;
  insertFrame: string;
  replaceFrame: string;
  frameTime: string;
  framePreview: string;
  frameStepBack: string;
  frameStepForward: string;
  captureFrame: string;
  invalidFrameTime: string;
  captureFrameFailed: string;
  uploadImage: string;
  uploadImageFailed: string;
}

export interface VideoDocumentWysiwygToolbarState {
  headingLevel: 0 | 2 | 3 | 4 | 5 | 6;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  link: boolean;
  codeBlock: boolean;
  blockquote: boolean;
  table: boolean;
  canUndo: boolean;
  canRedo: boolean;
  image: boolean;
  imageSourcePath: string | null;
  imageAltText: string;
  selectedText: string;
  articleElementId: string | null;
}

export interface VideoDocumentArticleElementControls {
  comments: readonly ArticleCommentDto[];
  commentsOpen: boolean;
  hoveredCommentId: string | null;
  selectedCommentId: string | null;
  editTrail: readonly ArticleEditTrailEntryDto[];
  elementPreviews: Readonly<Record<string, string>>;
  busy: boolean;
  commentLabel: string;
  commentsLabel: string;
  historyLabel: string;
  previousEditLabel: string;
  nextEditLabel: string;
  onAddComment(): void;
  onCommentHover(commentId: string | null): void;
  onCommentSelect(commentId: string): void;
  onCommentsToggle(): void;
  onEditTrailSelect(location: ArticleEditorLocationDto): void;
  onPreviousEdit(): void;
  onNextEdit(): void;
}

interface FormatButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onClick(): void;
  children: ReactNode;
}

function FormatButton({ label, active = false, disabled = false, expanded, onClick, children }: FormatButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn('size-7', active && 'bg-selected text-selected-foreground hover:bg-selected/80')}
          aria-label={label}
          aria-pressed={active}
          aria-expanded={expanded}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="px-2 py-1">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function HeadingMenu({
  editor,
  state,
  labels,
}: {
  editor: Editor;
  state: VideoDocumentWysiwygToolbarState;
  labels: VideoDocumentWysiwygEditorLabels;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    { level: 0 as const, label: labels.paragraph, shortcut: '' },
    ...([2, 3, 4, 5, 6] as const).map((level) => ({
      level,
      label: labels[`heading${level}`],
      shortcut: commandShortcutText(`format.heading.${level}`, window.desktopApi.appPlatform),
    })),
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-11 gap-1 px-1.5 font-mono text-xs"
          aria-label={labels.headingMenu}
          title={labels.headingMenu}
        >
          {state.headingLevel ? `H${state.headingLevel}` : '¶'}
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {options.map((option) => (
          <Button
            key={option.level}
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start rounded-sm px-2 text-xs font-normal"
            onClick={() => {
              if (option.level === 0) editor.chain().focus().setParagraph().run();
              else editor.chain().focus().setHeading({ level: option.level }).run();
              setOpen(false);
            }}
          >
            <span className="w-5 font-mono text-muted-foreground">{option.level ? `H${option.level}` : '¶'}</span>
            <span>{option.label}</span>
            {state.headingLevel === option.level && <CheckIcon className="ml-auto size-3.5 text-selected-foreground" />}
            {state.headingLevel !== option.level && option.shortcut && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{option.shortcut}</span>
            )}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LinkMenu({
  editor,
  active,
  labels,
}: {
  editor: Editor;
  active: boolean;
  labels: VideoDocumentWysiwygEditorLabels;
}) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');

  function apply() {
    const value = href.trim();
    if (!value) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setHref(String(editor.getAttributes('link').href ?? ''));
      }}
    >
      <PopoverTrigger asChild>
        <span>
          <FormatButton label={labels.link} active={active} onClick={() => setOpen(true)}>
            <LinkIcon className="size-3.5" />
          </FormatButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex items-center gap-1.5">
          <Input
            value={href}
            className="h-8 min-w-0 text-xs"
            placeholder="https://"
            aria-label={labels.linkUrl}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
            }}
          />
          {active && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={labels.removeLink}
              aria-label={labels.removeLink}
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setOpen(false);
              }}
            >
              <UnlinkIcon className="size-3.5" />
            </Button>
          )}
          <Button type="button" size="icon-sm" title={labels.applyLink} aria-label={labels.applyLink} onClick={apply}>
            <CheckIcon className="size-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ArticleEditTrailMenu({ controls }: { controls: VideoDocumentArticleElementControls }) {
  const entries = [...controls.editTrail].reverse().slice(0, 30);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <FormatButton label={controls.historyLabel} disabled={!entries.length} onClick={() => undefined}>
            <RouteIcon className="size-3.5" />
          </FormatButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-80 w-72 overflow-y-auto p-1">
        <div className="mb-1 grid grid-cols-2 gap-1 border-b pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 justify-start gap-1.5 rounded-sm px-2 text-xs font-normal"
            onClick={controls.onPreviousEdit}
          >
            <ChevronLeftIcon className="size-3.5" />
            {controls.previousEditLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 justify-start gap-1.5 rounded-sm px-2 text-xs font-normal"
            onClick={controls.onNextEdit}
          >
            <ChevronRightIcon className="size-3.5" />
            {controls.nextEditLabel}
          </Button>
        </div>
        {entries.map((entry, index) => (
          <Button
            key={`${entry.recordedAt}:${entry.elementId}:${index}`}
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-left font-normal"
            disabled={!Object.hasOwn(controls.elementPreviews, entry.elementId)}
            onClick={() => controls.onEditTrailSelect(entry)}
          >
            <MapPinIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{controls.elementPreviews[entry.elementId] || entry.elementId}</span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  editor: Editor;
  state: VideoDocumentWysiwygToolbarState;
  labels: VideoDocumentWysiwygEditorLabels;
  documentId?: string;
  sourceVideoUrl?: string;
  currentTimeMs: number;
  durationMs: number;
  timelineSegments: readonly VideoDocumentTimelineSegment[];
  mediaBindings: readonly VideoDocumentMediaBinding[];
  onFrameCaptured(result: VideoDocumentFrameCaptureResult): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageImportError(): void;
  searchOpen: boolean;
  onSearchToggle(): void;
  illustrationLabel?: string;
  onIllustrationRequest?(selectedText: string): void;
  articleElementControls?: VideoDocumentArticleElementControls;
}

export function VideoDocumentWysiwygToolbar({
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
  onImageImported,
  onImageImportError,
  searchOpen,
  onSearchToggle,
  illustrationLabel,
  onIllustrationRequest,
  articleElementControls,
}: Props) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const selectedImageTimestampMs = state.imageSourcePath
    ? (mediaBindings.find((binding) => binding.path === state.imageSourcePath)?.timestampMs ?? null)
    : null;

  async function uploadImage(file: File) {
    setUploadingImage(true);
    try {
      const result = await importVideoDocumentEditorImage(file, 'UPLOAD');
      if (!insertVideoDocumentImage(editor, result.attributes, editor.isActive('image'))) {
        throw new Error('Image could not be inserted into the editor');
      }
      onImageImported(result);
    } catch {
      if (!editor.isDestroyed) onImageImportError();
    } finally {
      setUploadingImage(false);
    }
  }

  return (
    <TooltipProvider delayDuration={450}>
      <div className="sticky top-0 z-30 flex min-h-9 items-center gap-0.5 overflow-x-auto border-b bg-background/96 px-1.5 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <HeadingMenu editor={editor} state={state} labels={labels} />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <FormatButton label={labels.bold} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <BoldIcon className="size-3.5" />
        </FormatButton>
        <FormatButton
          label={labels.italic}
          active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <ItalicIcon className="size-3.5" />
        </FormatButton>
        <FormatButton
          label={labels.strike}
          active={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <StrikethroughIcon className="size-3.5" />
        </FormatButton>
        <Separator orientation="vertical" className="mx-1 h-4" />
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
        <Separator orientation="vertical" className="mx-1 h-4" />
        <LinkMenu editor={editor} active={state.link} labels={labels} />
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
        <Separator orientation="vertical" className="mx-1 h-4" />
        {!state.image && (
          <FormatButton
            label={labels.uploadImage}
            disabled={uploadingImage}
            onClick={() => imageInputRef.current?.click()}
          >
            <UploadIcon className={uploadingImage ? 'size-3.5 animate-pulse' : 'size-3.5'} />
          </FormatButton>
        )}
        {illustrationLabel && onIllustrationRequest && (
          <FormatButton
            label={illustrationLabel}
            disabled={!state.selectedText}
            onClick={() => onIllustrationRequest(state.selectedText)}
          >
            <ImagePlusIcon className="size-3.5" />
          </FormatButton>
        )}
        {documentId && durationMs > 0 && (
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
              onFrameCaptured(result);
            }}
          />
        )}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void uploadImage(file);
          }}
        />
        <span className="ml-auto flex items-center gap-0.5 pl-2">
          {articleElementControls && (
            <>
              <FormatButton
                label={articleElementControls.commentLabel}
                disabled={!state.articleElementId || articleElementControls.busy}
                onClick={articleElementControls.onAddComment}
              >
                <MessageSquarePlusIcon className="size-3.5" />
              </FormatButton>
              <FormatButton
                label={`${articleElementControls.commentsLabel} (${articleElementControls.comments.filter((comment) => comment.status === 'OPEN').length})`}
                active={articleElementControls.commentsOpen}
                expanded={articleElementControls.commentsOpen}
                onClick={articleElementControls.onCommentsToggle}
              >
                <MessageSquareIcon className="size-3.5" />
              </FormatButton>
              <ArticleEditTrailMenu controls={articleElementControls} />
              <Separator orientation="vertical" className="mx-1 h-4" />
            </>
          )}
          <FormatButton label={labels.search} active={searchOpen} expanded={searchOpen} onClick={onSearchToggle}>
            <SearchIcon className="size-3.5" />
          </FormatButton>
          <FormatButton
            label={labels.undo}
            disabled={!state.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2Icon className="size-3.5" />
          </FormatButton>
          <FormatButton
            label={labels.redo}
            disabled={!state.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2Icon className="size-3.5" />
          </FormatButton>
        </span>
      </div>
      {state.table && <VideoDocumentTableOperations editor={editor} labels={labels} />}
      {state.image && (
        <VideoDocumentImageOperations
          altText={state.imageAltText}
          editor={editor}
          labels={labels}
          mediaBindings={mediaBindings}
          replacing={uploadingImage}
          sourcePath={state.imageSourcePath}
          onReplace={() => imageInputRef.current?.click()}
        />
      )}
    </TooltipProvider>
  );
}
