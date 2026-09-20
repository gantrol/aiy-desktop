import { commandShortcutText } from '@/renderer/commands/app-shortcuts';
import { imageImportItems } from '@/renderer/components/creator/imageImport';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import {
  editorImageFromAsset,
  type ImportedEditorImage,
  type VideoDocumentEditorImageImport,
} from '@/renderer/features/content-editor/contentImageAsset';
import { insertRevealBlock } from '@/renderer/features/content-editor/contentRevealExtension';
import { useContentMenuAction } from '@/renderer/features/content-editor/useContentMenuAction';
import { contentImageApi, stageContentImage } from '@/renderer/features/content-editor/contentImageRecovery';
import { type VideoDocumentImageControlsLabels } from '@/renderer/features/video-documents/VideoDocumentImageOperations';
import type { VideoDocumentTableControlsLabels } from '@/renderer/features/video-documents/VideoDocumentTableControls';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { VideoDocumentWysiwygToolbarView } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbarView';
import type {
  ContentCommentDto,
  ArticleEditTrailEntryDto,
  ArticleEditorLocationDto,
  CreatorImageImportSource,
  VideoDocumentFrameCaptureResult,
  VideoDocumentMediaBinding,
  VideoDocumentTimelineSegment,
} from '@/shared/contracts';
import type { Editor } from '@tiptap/core';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImagePlusIcon,
  LinkIcon,
  MapPinIcon,
  MessageSquarePlusIcon,
  RouteIcon,
  UnlinkIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
export { videoDocumentEditorImageFromAsset } from '@/renderer/features/content-editor/contentImageAsset';
export type {
  ImportedEditorImage,
  VideoDocumentEditorImageImport,
} from '@/renderer/features/content-editor/contentImageAsset';

export async function importVideoDocumentEditorImage(
  file: File,
  source: CreatorImageImportSource,
  importId: string = crypto.randomUUID(),
): Promise<ImportedEditorImage> {
  const item = (await imageImportItems([file]))[0];
  if (!item) throw new Error('Image import produced no item');
  await stageContentImage({ importId, source, item: { name: item.name, mimeType: item.mimeType, bytes: item.bytes } });
  const asset = await contentImageApi().contentImageResolve(importId);
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
    `assets/upload-${crypto.randomUUID()}.${extension}`,
  );
}

export interface VideoDocumentWysiwygEditorLabels
  extends VideoDocumentTableControlsLabels, VideoDocumentImageControlsLabels {
  more: string;
  formatting: string;
  insert: string;
  articleTools: string;
  review: string;
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
  details: boolean;
  reveal: boolean;
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
  comments: readonly ContentCommentDto[];
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

export function FormatButton({
  label,
  active = false,
  disabled = false,
  expanded,
  onClick,
  children,
}: FormatButtonProps) {
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

export function HeadingMenu({
  editor,
  state,
  labels,
  textLabel = false,
}: {
  editor: Editor;
  state: VideoDocumentWysiwygToolbarState;
  labels: VideoDocumentWysiwygEditorLabels;
  textLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menu = useContentMenuAction();
  const options = [
    { level: 0 as const, label: labels.paragraph, shortcut: '' },
    ...([2, 3, 4, 5, 6] as const).map((level) => ({
      level,
      label: labels[`heading${level}`],
      shortcut: commandShortcutText(`format.heading.${level}`, window.desktopApi?.appPlatform ?? 'win32'),
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
          {textLabel
            ? state.headingLevel
              ? labels[`heading${state.headingLevel}`]
              : labels.paragraph
            : state.headingLevel
              ? `H${state.headingLevel}`
              : '¶'}
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1" onCloseAutoFocus={menu.onCloseAutoFocus}>
        {options.map((option) => (
          <Button
            key={option.level}
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start rounded-sm px-2 text-xs font-normal"
            onClick={() => {
              if (option.level === 0) editor.chain().focus().setParagraph().run();
              else editor.chain().focus().setHeading({ level: option.level }).run();
              menu.run(() => setOpen(false));
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

export function LinkMenu({
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
  const menu = useContentMenuAction();

  function apply() {
    const value = href.trim();
    if (!value) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
    menu.run(() => setOpen(false));
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
      <PopoverContent align="start" className="w-72 p-2" onCloseAutoFocus={menu.onCloseAutoFocus}>
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
                menu.run(() => setOpen(false));
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

export function ArticleElementReviewButtons({
  articleElementId,
  controls,
}: {
  articleElementId: string | null;
  controls: VideoDocumentArticleElementControls;
}) {
  return (
    <>
      <FormatButton
        label={controls.commentLabel}
        disabled={!articleElementId || controls.busy}
        onClick={controls.onAddComment}
      >
        <MessageSquarePlusIcon className="size-3.5" />
      </FormatButton>
      <ArticleEditTrailMenu controls={controls} />
    </>
  );
}

export interface Props {
  toolbarPreset?: 'full' | 'compact';
  figureAssetIds?: readonly string[];
  embedded?: boolean;
  outlineMode?: boolean;
  interactionsEnabled?: boolean;
  referenceAction?: ReactNode;
  onImageOperation?(operation: Promise<void>): void;
  importImage?: typeof importVideoDocumentEditorImage;
  editor: Editor;
  state: VideoDocumentWysiwygToolbarState;
  labels: VideoDocumentWysiwygEditorLabels;
  documentId?: string;
  sourceVideoUrl?: string;
  currentTimeMs?: number;
  durationMs?: number;
  timelineSegments?: readonly VideoDocumentTimelineSegment[];
  mediaBindings: readonly VideoDocumentMediaBinding[];
  onFrameCaptured?(result: VideoDocumentFrameCaptureResult): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageImportError(): void;
  searchOpen: boolean;
  onSearchToggle(): void;
  illustrationLabel?: string;
  onIllustrationRequest?(selectedText: string): void;
  articleElementControls?: VideoDocumentArticleElementControls;
}

export function ArticleInteractionButtons({
  editor,
  state,
}: {
  editor: Editor;
  state: VideoDocumentWysiwygToolbarState;
}) {
  const copy = useI18n().messages.videoDocuments.editor.richText;
  return (
    <>
      <FormatButton
        label={state.details ? copy.removeDetails : copy.details}
        active={state.details}
        disabled={state.reveal}
        onClick={() => {
          if (state.details) editor.chain().focus().unsetDetails().run();
          else editor.chain().focus().setDetails().insertContent(copy.detailsSummary).run();
        }}
      >
        {state.details ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
      </FormatButton>
      <FormatButton
        label={copy.clickReveal}
        disabled={state.reveal || state.details}
        onClick={() =>
          insertRevealBlock(editor, 'REVEAL', {
            initial: copy.questionText,
            answer: copy.answerText,
          })
        }
      >
        <ChevronRightIcon className="size-3.5" />
      </FormatButton>
      <FormatButton
        label={copy.imageSwap}
        disabled={state.reveal || state.details}
        onClick={() =>
          insertRevealBlock(editor, 'IMAGE_SWAP', {
            initial: copy.beforeImageText,
            answer: copy.afterImageText,
          })
        }
      >
        <ImagePlusIcon className="size-3.5" />
      </FormatButton>
    </>
  );
}

export function VideoDocumentWysiwygToolbar(props: Props) {
  return (
    <VideoDocumentWysiwygToolbarView {...props} importImage={props.importImage ?? importVideoDocumentEditorImage} />
  );
}
