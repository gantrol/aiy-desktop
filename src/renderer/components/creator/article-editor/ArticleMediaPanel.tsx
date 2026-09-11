import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  GripVerticalIcon,
  HashIcon,
  ImagesIcon,
  LayoutGridIcon,
  LocateIcon,
  Trash2Icon,
  StarIcon,
} from 'lucide-react';
import { ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { ContentMediaThumbnail } from '@/renderer/features/content-editor/ContentMediaThumbnail';
import {
  useContentWorkspacePanelToolbar,
  useRestoreContentWorkspace,
} from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { ArticleMediaCover } from '@/renderer/components/creator/article-editor/ArticleMediaCover';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { ArticleImagePlacement } from '@/renderer/features/video-documents/articleImageOperations';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { createPortal } from 'react-dom';

const reorderType = 'application/x-aiy-article-image-order';

function useImageHandleFocus(
  images: readonly ArticleImagePlacement[],
  focusRef: RefObject<string | null>,
  handles: RefObject<Map<string, HTMLButtonElement>>,
) {
  useLayoutEffect(() => {
    if (!focusRef.current) return;
    const handle = handles.current?.get(focusRef.current);
    handle?.focus({ preventScroll: true });
    handle?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    focusRef.current = null;
  }, [focusRef, handles, images]);
}

function handleMediaHistoryShortcut(
  event: ReactKeyboardEvent<HTMLElement>,
  onUndo: () => boolean,
  onRedo: () => boolean,
) {
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable=true]'))
  )
    return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  event.preventDefault();
  event.stopPropagation();
  if (key === 'y' || event.shiftKey) onRedo();
  else onUndo();
}

export function ArticleMediaPanel({
  images,
  media,
  onMove,
  onRemove,
  onLocate,
  onUndo,
  onRedo,
}: {
  images: readonly ArticleImagePlacement[];
  media: readonly VideoDocumentRevisionMediaDto[];
  onMove(elementId: string, targetId: string): boolean;
  onRemove(elementId: string): boolean;
  onLocate(elementId: string): void;
  onUndo(): boolean;
  onRedo(): boolean;
}) {
  const copy = useI18n().messages.contentEditor;
  const session = useArticleEditorSession();
  const restoreWorkspace = useRestoreContentWorkspace();
  const toolbarRoot = useContentWorkspacePanelToolbar();
  const [large, setLarge] = useState(false);
  const [dropId, setDropId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const sourceRef = useRef<string | null>(null);
  const focusRef = useRef<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const sectionRef = useRef<HTMLElement>(null);
  const assets = new Map(media.map((asset) => [asset.assetId, asset]));
  useImageHandleFocus(images, focusRef, handles);

  function move(elementId: string, targetIndex: number) {
    const target = images[targetIndex];
    if (!target || target.elementId === elementId) return false;
    focusRef.current = elementId;
    if (!onMove(elementId, target.elementId)) {
      focusRef.current = null;
      setNotice(copy.imageMoveFailed);
      return false;
    }
    setNotice(copy.imageMoved.replace('{index}', String(targetIndex + 1)).replace('{count}', String(images.length)));
    return true;
  }

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={copy.media}
      className="flex min-h-full min-w-0 flex-col gap-2"
      onKeyDown={(event) => handleMediaHistoryShortcut(event, onUndo, onRedo)}
    >
      {toolbarRoot &&
        createPortal(
          <>
            <ArticleMediaCover media={media} />
            {images.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={large ? copy.smallThumbnails : copy.largeThumbnails}
                title={large ? copy.smallThumbnails : copy.largeThumbnails}
                aria-pressed={large}
                onClick={() => setLarge((value) => !value)}
              >
                <LayoutGridIcon className="size-4" />
              </Button>
            )}
          </>,
          toolbarRoot,
        )}
      <div className={notice === copy.imageMoveFailed ? 'text-xs text-destructive' : 'sr-only'} role="status">
        {notice}
      </div>
      {!images.length && (
        <div className="grid min-h-24 flex-1 place-items-center text-muted-foreground">
          <ImagesIcon className="size-5" aria-label={copy.media} />
        </div>
      )}
      <div
        className={cn(
          'grid content-start gap-2',
          large
            ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))]'
            : 'grid-cols-[repeat(auto-fill,minmax(min(100%,7rem),1fr))]',
        )}
      >
        {images.map((image, index) => {
          const asset = assets.get(image.assetId);
          const label = copy.reorderImage.replace('{index}', String(index + 1));
          const actions = imageActions({
            index,
            count: images.length,
            copy,
            canSetCover: Boolean(asset),
            onCover: () => session.coverChanged(image.assetId),
            onLocate: () => {
              restoreWorkspace();
              window.requestAnimationFrame(() => onLocate(image.elementId));
            },
            onMove: (to) => move(image.elementId, to),
            onPosition: () => setMoveId(image.elementId),
            onRemove: () => {
              focusRef.current = images[index + 1]?.elementId ?? images[index - 1]?.elementId ?? null;
              if (!onRemove(image.elementId)) {
                focusRef.current = null;
                setNotice(copy.imageMoveFailed);
              } else if (images.length === 1) sectionRef.current?.focus({ preventScroll: true });
            },
          });
          return (
            <div
              key={image.elementId}
              className={cn('min-w-0 rounded-sm', dropId === image.elementId && 'ring-2 ring-ring')}
              onDragOver={(event) => {
                if (!sourceRef.current || !event.dataTransfer.types.includes(reorderType)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                setDropId(image.elementId);
              }}
              onDragLeave={(event) => {
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
                  setDropId(null);
              }}
              onDrop={(event) => {
                if (!sourceRef.current || !event.dataTransfer.types.includes(reorderType)) return;
                event.preventDefault();
                event.stopPropagation();
                move(sourceRef.current, index);
                sourceRef.current = null;
                setDropId(null);
              }}
            >
              <ContentMediaThumbnail
                assetId={image.assetId || undefined}
                mediaUrl={asset?.mediaUrl}
                index={index}
                actions={actions}
                controls={
                  <div className="absolute inset-x-1 top-1 flex items-center justify-between gap-1">
                    <Button
                      ref={(node) => {
                        if (node) handles.current.set(image.elementId, node);
                        else handles.current.delete(image.elementId);
                      }}
                      variant="secondary"
                      size="icon-sm"
                      className="h-7 w-auto min-w-7 cursor-grab gap-0.5 rounded-sm bg-background/95 px-1 text-2xs tabular-nums active:cursor-grabbing"
                      draggable={images.length > 1}
                      aria-label={label}
                      title={label}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        sourceRef.current = image.elementId;
                        event.dataTransfer.setData(reorderType, image.elementId);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        sourceRef.current = null;
                        setDropId(null);
                      }}
                      onKeyDown={(event) => {
                        const destination =
                          event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                            ? index - 1
                            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                              ? index + 1
                              : event.key === 'Home'
                                ? 0
                                : event.key === 'End'
                                  ? images.length - 1
                                  : null;
                        if (destination === null) return;
                        event.preventDefault();
                        event.stopPropagation();
                        move(image.elementId, destination);
                      }}
                    >
                      <GripVerticalIcon className="size-3" />
                      {index + 1}
                    </Button>
                    <ActionMenuButton
                      actions={actions}
                      label={copy.imageMenu.replace('{index}', String(index + 1))}
                      variant="secondary"
                      className="rounded-sm bg-background/95"
                      side="bottom"
                      align="end"
                    />
                  </div>
                }
              />
            </div>
          );
        })}
      </div>
      {moveId && (
        <ArticleImagePositionDialog
          key={moveId}
          imageId={moveId}
          images={images}
          onMove={move}
          onClose={() => setMoveId(null)}
          onRestoreFocus={() => handles.current.get(moveId)?.focus()}
        />
      )}
    </section>
  );
}

function ArticleImagePositionDialog({
  imageId,
  images,
  onMove,
  onClose,
  onRestoreFocus,
}: {
  imageId: string;
  images: readonly ArticleImagePlacement[];
  onMove(elementId: string, index: number): boolean;
  onClose(): void;
  onRestoreFocus(): void;
}) {
  const copy = useI18n().messages.contentEditor;
  const [position, setPosition] = useState(String(images.findIndex((image) => image.elementId === imageId) + 1));
  const requested = Number(position);
  const valid =
    images.some((image) => image.elementId === imageId) &&
    Number.isInteger(requested) &&
    requested >= 1 &&
    requested <= images.length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-xs rounded-sm"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogTitle>{copy.moveImageTo}</DialogTitle>
        <form
          className="flex min-w-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && (images[requested - 1]?.elementId === imageId || onMove(imageId, requested - 1))) onClose();
          }}
        >
          <Input
            type="number"
            min={1}
            max={images.length}
            step={1}
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            aria-label={copy.imagePosition}
            autoFocus
          />
          <Button type="submit" disabled={!valid}>
            {copy.moveImageApply}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function imageActions({
  index,
  count,
  copy,
  canSetCover,
  onCover,
  onLocate,
  onMove,
  onPosition,
  onRemove,
}: {
  index: number;
  count: number;
  copy: ReturnType<typeof useI18n>['messages']['contentEditor'];
  canSetCover: boolean;
  onCover(): void;
  onLocate(): void;
  onMove(index: number): void;
  onPosition(): void;
  onRemove(): void;
}): ActionMenuAction[] {
  return [
    { id: 'cover', label: copy.useAsArticleCover, icon: StarIcon, disabled: !canSetCover, onSelect: onCover },
    { id: 'locate', label: copy.locateImage, icon: LocateIcon, onSelect: onLocate },
    {
      id: 'previous',
      label: copy.moveImageEarlier,
      icon: ArrowUpIcon,
      disabled: index === 0,
      onSelect: () => onMove(index - 1),
    },
    {
      id: 'next',
      label: copy.moveImageLater,
      icon: ArrowDownIcon,
      disabled: index === count - 1,
      onSelect: () => onMove(index + 1),
    },
    {
      id: 'first',
      label: copy.moveImageFirst,
      icon: ArrowUpToLineIcon,
      disabled: index === 0,
      onSelect: () => onMove(0),
    },
    {
      id: 'last',
      label: copy.moveImageLast,
      icon: ArrowDownToLineIcon,
      disabled: index === count - 1,
      onSelect: () => onMove(count - 1),
    },
    { id: 'position', label: copy.moveImageTo, icon: HashIcon, disabled: count < 2, onSelect: onPosition },
    {
      id: 'remove',
      label: copy.removeImageOccurrence,
      icon: Trash2Icon,
      destructive: true,
      separatorBefore: true,
      onSelect: onRemove,
    },
  ];
}
