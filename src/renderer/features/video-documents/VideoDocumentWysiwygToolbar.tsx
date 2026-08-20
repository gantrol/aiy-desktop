import type { Editor } from '@tiptap/core';
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  Code2Icon,
  Columns3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  Rows3Icon,
  StrikethroughIcon,
  Table2Icon,
  Trash2Icon,
  Undo2Icon,
  UnlinkIcon,
  UploadIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import type {
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
  insertVideoDocumentImage,
  videoDocumentFrameImageAttributes,
} from '@/renderer/features/video-documents/videoDocumentEditorMedia';
import { cn } from '@/renderer/lib/utils';

export interface VideoDocumentEditorImageImport {
  binding: VideoDocumentMediaBinding;
  media: VideoDocumentRevisionMediaDto;
}

export interface VideoDocumentWysiwygEditorLabels {
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
  table: string;
  insertTable: string;
  addRow: string;
  addColumn: string;
  deleteTable: string;
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
}

interface FormatButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}

function FormatButton({ label, active = false, disabled = false, onClick, children }: FormatButtonProps) {
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
    { level: 2 as const, label: labels.heading2, shortcut: 'Alt+2' },
    { level: 3 as const, label: labels.heading3, shortcut: 'Alt+3' },
    { level: 4 as const, label: labels.heading4, shortcut: 'Alt+4' },
    { level: 5 as const, label: labels.heading5, shortcut: 'Alt+5' },
    { level: 6 as const, label: labels.heading6, shortcut: 'Alt+6' },
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

function TableMenu({
  editor,
  state,
  labels,
}: {
  editor: Editor;
  state: VideoDocumentWysiwygToolbarState;
  labels: VideoDocumentWysiwygEditorLabels;
}) {
  const [open, setOpen] = useState(false);
  const actions = state.table
    ? [
        { label: labels.addRow, icon: Rows3Icon, run: () => editor.chain().focus().addRowAfter().run() },
        { label: labels.addColumn, icon: Columns3Icon, run: () => editor.chain().focus().addColumnAfter().run() },
        { label: labels.deleteTable, icon: Trash2Icon, run: () => editor.chain().focus().deleteTable().run() },
      ]
    : [
        {
          label: labels.insertTable,
          icon: Table2Icon,
          run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        },
      ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span>
          <FormatButton label={labels.table} active={state.table} onClick={() => setOpen(true)}>
            <Table2Icon className="size-3.5" />
          </FormatButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.label}
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start rounded-sm px-2 text-xs font-normal"
              onClick={() => {
                action.run();
                setOpen(false);
              }}
            >
              <Icon className="size-3.5" />
              {action.label}
            </Button>
          );
        })}
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
}: Props) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const selectedImageTimestampMs = state.imageSourcePath
    ? (mediaBindings.find((binding) => binding.path === state.imageSourcePath)?.timestampMs ?? null)
    : null;

  async function uploadImage(file: File) {
    setUploadingImage(true);
    try {
      const item = (await imageImportItems([file]))[0];
      if (!item) throw new Error('Image import produced no item');
      const assets = await window.desktopApi.creatorReferencesImport({
        context: {
          seriesId: null,
          versionId: null,
          title: '',
          titleLocale: 'en',
          source: 'UPLOAD',
        },
        items: [item],
      });
      const asset = assets[0];
      if (!asset) throw new Error('Image import produced no asset');
      if (
        asset.mimeType !== 'image/png' &&
        asset.mimeType !== 'image/jpeg' &&
        asset.mimeType !== 'image/webp' &&
        asset.mimeType !== 'image/svg+xml'
      ) {
        throw new Error('Image import produced an unsupported asset');
      }
      const mimeType = asset.mimeType;
      const extension =
        mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/webp'
            ? 'webp'
            : mimeType === 'image/svg+xml'
              ? 'svg'
              : 'jpg';
      const binding: VideoDocumentMediaBinding = {
        path: `assets/upload-${asset.id}.${extension}`,
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
        byteSize: asset.byteSize ?? item.bytes.byteLength,
        durationMs: null,
      };
      const attributes = { src: media.mediaUrl, sourcePath: binding.path, title: null, alt: item.name || null };
      if (!insertVideoDocumentImage(editor, attributes, editor.isActive('image'))) {
        throw new Error('Image could not be inserted into the editor');
      }
      onImageImported({ binding, media });
    } catch {
      if (!editor.isDestroyed) onImageImportError();
    } finally {
      setUploadingImage(false);
    }
  }

  return (
    <TooltipProvider delayDuration={450}>
      <div className="sticky top-0 z-30 flex min-h-9 items-center gap-0.5 overflow-x-auto border-b bg-background/96 px-1.5 shadow-sm backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        <TableMenu editor={editor} state={state} labels={labels} />
        <FormatButton label={labels.horizontalRule} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <MinusIcon className="size-3.5" />
        </FormatButton>
        <Separator orientation="vertical" className="mx-1 h-4" />
        <FormatButton
          label={labels.uploadImage}
          disabled={uploadingImage}
          onClick={() => imageInputRef.current?.click()}
        >
          <UploadIcon className={uploadingImage ? 'size-3.5 animate-pulse' : 'size-3.5'} />
        </FormatButton>
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
    </TooltipProvider>
  );
}
