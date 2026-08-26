import {
  ArchiveIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HeartIcon,
  HeartOffIcon,
  LoaderCircleIcon,
  SquarePenIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import type { AssetFileRevealContext } from '@/shared/contracts';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { useAssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { Button } from '@/renderer/components/ui/button';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  hasMaterialLifecycleEntity,
  type MaterialLibraryItem,
} from '@/renderer/components/gallery/materialLibraryTypes';

interface MaterialDetailHeaderProps {
  title: string;
  position: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  copyBusy: boolean;
  canCopy: boolean;
  onClose(): void;
  onPrevious(): void;
  onNext(): void;
  onCopyImage(): void;
}

export function MaterialDetailHeader({
  title,
  position,
  total,
  hasPrevious,
  hasNext,
  copyBusy,
  canCopy,
  onClose,
  onPrevious,
  onNext,
  onCopyImage,
}: MaterialDetailHeaderProps) {
  const { messages } = useI18n();
  const l = messages.gallery.inspector;
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-action="material-inspector-close"
        aria-label={l.back}
        onClick={onClose}
      >
        <ArrowLeftIcon className="size-4" />
        {l.back}
      </Button>
      <div className="min-w-0 flex-1">
        <MetaText as="p" className="truncate">
          {l.title}
        </MetaText>
        <h1 className="truncate text-base font-semibold" title={title}>
          {title}
        </h1>
      </div>
      <MetaText as="span" className="shrink-0" aria-live="polite">
        {l.position(position, total)}
      </MetaText>
      <div className="flex shrink-0 items-center gap-1" aria-label={l.browseLabel}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          data-action="material-detail-previous"
          aria-label={l.previous}
          title={l.previous}
          disabled={!hasPrevious}
          onClick={onPrevious}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          data-action="material-detail-next"
          aria-label={l.next}
          title={l.next}
          disabled={!hasNext}
          onClick={onNext}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
        {canCopy && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            data-action="asset-file-copy"
            aria-label={messages.assetFile.copy}
            aria-busy={copyBusy ? 'true' : 'false'}
            disabled={copyBusy}
            onClick={onCopyImage}
          >
            {copyBusy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CopyIcon className="size-4" />}
          </Button>
        )}
      </div>
    </header>
  );
}

interface MaterialDetailPreviewProps {
  item: MaterialLibraryItem;
  title: string;
  video: boolean;
  notify(message: string): void;
  revealContext?: AssetFileRevealContext;
  lifecycleBusy: boolean;
  onArchive(): void;
  onDelete(): void;
}

export function MaterialDetailPreview({
  item,
  title,
  video,
  notify,
  revealContext,
  lifecycleBusy,
  onArchive,
  onDelete,
}: MaterialDetailPreviewProps) {
  const { messages } = useI18n();
  const l = messages.gallery.inspector;
  const lifecycleActions: ActionMenuAction[] = hasMaterialLifecycleEntity(item)
    ? [
        {
          id: 'archive-material',
          label: messages.contentManagement.actions.archive,
          icon: ArchiveIcon,
          disabled: lifecycleBusy,
          onSelect: onArchive,
        },
        {
          id: 'delete-material',
          label: messages.contentManagement.actions.delete,
          icon: Trash2Icon,
          destructive: true,
          disabled: lifecycleBusy,
          onSelect: onDelete,
        },
      ]
    : [];
  return (
    <section className="min-h-0 min-w-0 bg-surface-sunken p-4 sm:p-6" aria-label={l.preview}>
      {item.kind !== 'TEXT' ? (
        <AssetFileContextMenu
          assetId={item.image.asset.id}
          notify={notify}
          revealContext={revealContext}
          copyable={!video}
          usableInCreation={!video}
          lifecycleActions={lifecycleActions}
        >
          <div
            className={cn(
              'relative isolate grid size-full min-h-0 place-items-center overflow-hidden rounded-xl border',
              video ? 'bg-media-surround-dark' : 'bg-surface-sunken',
            )}
          >
            {!video && <ImageAmbientBackdrop src={item.image.asset.mediaUrl} />}
            <AssetMedia
              asset={item.image.asset}
              className="relative z-10 max-h-full size-full object-contain"
              alt={title}
              draggable={false}
              controls={video}
              preload={video ? 'auto' : 'metadata'}
            />
          </div>
        </AssetFileContextMenu>
      ) : (
        <ScrollArea className="size-full rounded-xl border bg-background">
          <p className="mx-auto max-w-3xl whitespace-pre-wrap break-words p-8 text-base leading-7">{item.text.text}</p>
        </ScrollArea>
      )}
    </section>
  );
}

interface MaterialDetailActionsProps {
  item: MaterialLibraryItem;
  video: boolean;
  favorited: boolean;
  favoriteBusy: boolean;
  onCopyText(text: string): void;
  onAddFavorite(): void;
  onRemoveFavorite(): void;
  onOpenResult(seriesId: string, assetId: string): void;
  onOpenTerm(termId: string): void;
  onRequestExit(action: () => void): void;
  lifecycleBusy: boolean;
  onArchive(item: MaterialLibraryItem): void;
  onDelete(item: MaterialLibraryItem): void;
  notify(message: string): void;
  revealContext?: AssetFileRevealContext;
}

export function MaterialDetailActions({
  item,
  video,
  favorited,
  favoriteBusy,
  onCopyText,
  onAddFavorite,
  onRemoveFavorite,
  onOpenResult,
  onOpenTerm,
  onRequestExit,
  lifecycleBusy,
  onArchive,
  onDelete,
  notify,
  revealContext,
}: MaterialDetailActionsProps) {
  const { messages } = useI18n();
  const l = messages.gallery.inspector;
  const fileLabels = messages.assetFile;
  const assetActions = useAssetMenuActions();
  const image = item.kind === 'TEXT' ? null : item.image;
  const lifecycleAvailable = hasMaterialLifecycleEntity(item);
  const [creationBusy, setCreationBusy] = useState(false);

  async function sendToCreation() {
    if (!image || !assetActions || creationBusy) return;
    setCreationBusy(true);
    try {
      await assetActions.useInCreation(image.asset.id);
      notify(fileLabels.addedToCreation);
    } catch (reason) {
      notify(`${fileLabels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      setCreationBusy(false);
    }
  }

  const favoriteButton = (image || favorited) && (
    <Button
      type="button"
      data-action="material-favorite-toggle"
      variant="outline"
      className="w-full"
      disabled={favoriteBusy}
      aria-busy={favoriteBusy}
      aria-pressed={favorited}
      onClick={favorited ? onRemoveFavorite : onAddFavorite}
    >
      {favoriteBusy ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : favorited ? (
        <HeartOffIcon className="size-4" />
      ) : (
        <HeartIcon className="size-4" />
      )}
      {favorited ? l.unfavorite : l.favorite}
    </Button>
  );

  if (item.kind === 'TEXT') {
    return (
      <div className="grid gap-2">
        <Button type="button" className="w-full" onClick={() => onCopyText(item.text.text)}>
          <CopyIcon className="size-4" />
          {l.copyText}
        </Button>
        {favoriteButton}
        <Button
          type="button"
          variant="outline"
          disabled={lifecycleBusy}
          onClick={() => onRequestExit(() => onArchive(item))}
        >
          <ArchiveIcon className="size-4" />
          {messages.contentManagement.actions.archive}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={lifecycleBusy}
          onClick={() => onRequestExit(() => onDelete(item))}
        >
          <Trash2Icon className="size-4" />
          {messages.contentManagement.actions.delete}
        </Button>
      </div>
    );
  }
  if (!image) return null;

  return (
    <div className="grid gap-2">
      {!video && assetActions && (
        <Button
          type="button"
          className="w-full"
          disabled={creationBusy}
          aria-busy={creationBusy}
          onClick={() => onRequestExit(() => void sendToCreation())}
        >
          {creationBusy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SquarePenIcon className="size-4" />}
          {fileLabels.useInCreation}
        </Button>
      )}
      {video && image.materialId && assetActions && (
        <Button
          type="button"
          className="w-full"
          onClick={() =>
            onRequestExit(
              () =>
                void assetActions.createDocumentFromVideo(
                  image.materialId!,
                  revealContext?.kind === 'ALBUM' ? revealContext.albumId : null,
                ),
            )
          }
        >
          <FileTextIcon className="size-4" />
          {messages.videoDocuments.createFromVideo}
        </Button>
      )}
      {image.creation && (
        <Button type="button" className="w-full" onClick={() => onOpenResult(image.creation!.seriesId, image.asset.id)}>
          <SquarePenIcon className="size-4" />
          {l.openCreation}
          <ExternalLinkIcon className="ml-auto size-3.5 opacity-60" />
        </Button>
      )}
      {!image.creation && image.dictionary && (
        <Button type="button" className="w-full" onClick={() => onOpenTerm(image.dictionary!.termId)}>
          <BookOpenIcon className="size-4" />
          {l.openDictionary}
          <ExternalLinkIcon className="ml-auto size-3.5 opacity-60" />
        </Button>
      )}
      {favoriteButton}
      {lifecycleAvailable && (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={lifecycleBusy}
            onClick={() => onRequestExit(() => onArchive(item))}
          >
            <ArchiveIcon className="size-4" />
            {messages.contentManagement.actions.archive}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={lifecycleBusy}
            onClick={() => onRequestExit(() => onDelete(item))}
          >
            <Trash2Icon className="size-4" />
            {messages.contentManagement.actions.delete}
          </Button>
        </>
      )}
    </div>
  );
}
