import type { Editor } from '@tiptap/core';
import {
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  LoaderCircleIcon,
  ReplaceIcon,
  TextCursorInputIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { VideoDocumentMediaBinding } from '@/shared/contracts';
import { copyAssetImage } from '@/renderer/components/media/AssetImageCopyButton';
import { useAssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface VideoDocumentImageControlsLabels {
  image: string;
  replaceImage: string;
  imageAltText: string;
  applyImageAltText: string;
  removeImage: string;
}

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

export function documentImageAssetId(sourcePath: string | null, mediaBindings: readonly VideoDocumentMediaBinding[]) {
  if (!sourcePath) return null;
  const normalizedSource = normalizedMediaPath(sourcePath);
  return (
    mediaBindings.find((binding) => binding.kind === 'IMAGE' && normalizedMediaPath(binding.path) === normalizedSource)
      ?.assetId ?? internalImageAssetId(sourcePath)
  );
}

function ImageOperationButton({
  children,
  disabled,
  destructive = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onClick(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="2xs"
      className={
        destructive
          ? 'gap-1.5 px-2 font-normal text-destructive hover:bg-destructive-surface'
          : 'gap-1.5 px-2 font-normal'
      }
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function VideoDocumentImageOperations({
  altText,
  editor,
  labels,
  mediaBindings,
  replacing,
  sourcePath,
  onReplace,
}: {
  altText: string;
  editor: Editor;
  labels: VideoDocumentImageControlsLabels;
  mediaBindings: readonly VideoDocumentMediaBinding[];
  replacing: boolean;
  sourcePath: string | null;
  onReplace(): void;
}) {
  const { messages } = useI18n();
  const menuActions = useAssetMenuActions();
  const [fileAction, setFileAction] = useState<'COPY' | 'SAVE_AS' | null>(null);
  const [altOpen, setAltOpen] = useState(false);
  const [altDraft, setAltDraft] = useState(altText);
  const assetId = documentImageAssetId(sourcePath, mediaBindings);
  const notify = menuActions?.notify ?? (() => undefined);

  async function runFileAction(action: 'COPY' | 'SAVE_AS') {
    if (!assetId || fileAction) return;
    setFileAction(action);
    try {
      if (action === 'COPY') {
        await copyAssetImage(assetId, messages.assetFile, notify);
      } else {
        const result = await window.desktopApi.assetFileSaveAs(assetId);
        if (result.status === 'saved') notify(messages.assetFile.saved);
      }
    } catch (reason) {
      if (action === 'SAVE_AS') {
        notify(`${messages.assetFile.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } finally {
      setFileAction(null);
    }
  }

  function applyAltText() {
    editor
      .chain()
      .focus()
      .updateAttributes('image', { alt: altDraft.trim() || null })
      .run();
    setAltOpen(false);
  }

  return (
    <div
      data-slot="video-document-image-operations"
      role="toolbar"
      aria-label={labels.image}
      className="sticky top-9 z-30 flex min-h-8 items-center gap-0.5 overflow-x-auto border-b bg-background/96 px-1.5 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="flex shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium text-foreground-secondary">
        <ImageIcon className="size-3.5" />
        {labels.image}
      </span>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <ImageOperationButton disabled={!assetId || Boolean(fileAction)} onClick={() => void runFileAction('COPY')}>
        {fileAction === 'COPY' ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
        {messages.assetFile.copy}
      </ImageOperationButton>
      <ImageOperationButton disabled={!assetId || Boolean(fileAction)} onClick={() => void runFileAction('SAVE_AS')}>
        {fileAction === 'SAVE_AS' ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : (
          <DownloadIcon className="size-3.5" />
        )}
        {messages.assetFile.saveAs}
      </ImageOperationButton>
      <ImageOperationButton disabled={replacing} onClick={onReplace}>
        {replacing ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <ReplaceIcon className="size-3.5" />}
        {labels.replaceImage}
      </ImageOperationButton>
      <Popover
        open={altOpen}
        onOpenChange={(open) => {
          setAltOpen(open);
          if (open) setAltDraft(altText);
        }}
      >
        <PopoverTrigger asChild>
          <span>
            <ImageOperationButton onClick={() => setAltOpen(true)}>
              <TextCursorInputIcon className="size-3.5" />
              {labels.imageAltText}
            </ImageOperationButton>
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2" onCloseAutoFocus={(event) => event.preventDefault()}>
          <div className="flex items-center gap-1.5">
            <Input
              value={altDraft}
              className="h-8 min-w-0 text-xs"
              aria-label={labels.imageAltText}
              placeholder={labels.imageAltText}
              onChange={(event) => setAltDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                applyAltText();
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              title={labels.applyImageAltText}
              aria-label={labels.applyImageAltText}
              onClick={applyAltText}
            >
              <TextCursorInputIcon className="size-3.5" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <ImageOperationButton destructive onClick={() => editor.chain().focus().deleteSelection().run()}>
        <Trash2Icon className="size-3.5" />
        {labels.removeImage}
      </ImageOperationButton>
    </div>
  );
}
