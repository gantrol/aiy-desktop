import {
  ArchiveIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  FileTextIcon,
  HeartIcon,
  ImageIcon,
  VideoIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { AssetFileRevealContext, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { formatDateTime } from '@/renderer/lib/dateFormat';
import { cn } from '@/renderer/lib/utils';
import { itemActionVisibilityClassName } from '@/renderer/components/ui/item-actions';
import {
  MIN_MATERIAL_FRAME_RATIO,
  MAX_MATERIAL_FRAME_RATIO,
} from '@/renderer/components/gallery/materialMasonryLayout';
import { materialPinSource } from '@/renderer/components/gallery/MaterialPinAction';
import { usePinContentAction } from '@/renderer/features/desktop-petals/PinContentAction';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { useAssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import { AssetMedia, isVideoAsset } from '@/renderer/components/media/AssetMedia';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { MediaCardCaption } from '@/renderer/components/media/MediaCardCaption';
import { DEFAULT_MEDIA_ASPECT_RATIO, getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ActionContextMenuItems, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import type { GalleryViewMode } from '@/renderer/components/gallery/galleryPreferences';
import {
  hasMaterialLifecycleEntity,
  materialTitle,
  selectionModifiers,
  type MaterialLibraryItem,
  type SelectionModifiers,
} from '@/renderer/components/gallery/materialLibraryTypes';
import { useLongPressSelection } from '@/renderer/components/gallery/useLongPressSelection';

interface Props {
  item: MaterialLibraryItem;
  selected: boolean;
  checked?: boolean;
  selectionMode?: boolean;
  selectionAvailable?: boolean;
  viewMode: GalleryViewMode;
  frameAspectRatio?: number;
  showName?: boolean;
  onSelect(item: MaterialLibraryItem, modifiers?: SelectionModifiers): void;
  onEnterSelection(item: MaterialLibraryItem): void;
  onToggleSelection(item: MaterialLibraryItem): void;
  onCopyText(text: string): void;
  onArchive?(item: MaterialLibraryItem): void;
  onDelete?(item: MaterialLibraryItem): void;
  lifecycleBusy?: boolean;
  notify(message: string): void;
  onDragStart?(event: ReactDragEvent<HTMLElement>, item: MaterialLibraryItem): void;
  revealContext?: AssetFileRevealContext;
}

const MATERIAL_LIST_THUMBNAIL_SIZE = 320;
const MATERIAL_GRID_THUMBNAIL_SIZE = 512;
const MATERIAL_BACKDROP_THUMBNAIL_SIZE = 192;

function MaterialListPreview({
  item,
  video,
  failed,
  unavailableLabel,
  onError,
}: {
  item: MaterialLibraryItem;
  video: boolean;
  failed: boolean;
  unavailableLabel: string;
  onError(): void;
}) {
  if (item.kind === 'TEXT') {
    return (
      <div className="grid size-full place-items-center bg-surface-sunken/60 text-muted-foreground">
        <FileTextIcon className="size-5" />
      </div>
    );
  }
  if (failed) {
    return (
      <div className="grid size-full place-items-center bg-surface-sunken text-muted-foreground">
        {video ? <VideoIcon className="size-7 opacity-50" /> : <ImageIcon className="size-7 opacity-50" />}
        <span className="sr-only">{unavailableLabel}</span>
      </div>
    );
  }
  const previewUrl = video
    ? item.image.asset.mediaUrl
    : mediaThumbnailUrl(item.image.asset, MATERIAL_LIST_THUMBNAIL_SIZE);
  return (
    <>
      {!video && (
        <ImageAmbientBackdrop
          src={mediaThumbnailUrl(item.image.asset, MATERIAL_BACKDROP_THUMBNAIL_SIZE)}
          loading="lazy"
        />
      )}
      <AssetMedia
        asset={item.image.asset}
        src={previewUrl}
        className="relative z-10 size-full object-contain"
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={onError}
      />
    </>
  );
}

const DEFAULT_MATERIAL_ASPECT_RATIO = DEFAULT_MEDIA_ASPECT_RATIO;

const cardDateOptions: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDate(value: string, locale: Locale) {
  return formatDateTime(value, locale, cardDateOptions);
}

/**
 * Images keep their source dimensions. Text materials use a few predictable
 * reading lengths so their card and masonry measurements stay in sync.
 */
export function getMaterialCardAspectRatio(item: MaterialLibraryItem) {
  if (item.kind !== 'TEXT') {
    const { width, height } = item.image.asset;
    return getSourceMediaAspectRatio(width, height, DEFAULT_MATERIAL_ASPECT_RATIO);
  }

  const textLength = Array.from(item.text.text.trim()).length;
  if (textLength <= 55) return DEFAULT_MATERIAL_ASPECT_RATIO;
  if (textLength <= 140) return 1;
  return 4 / 5;
}

function SelectionCheckbox({
  visible,
  checked,
  label,
  onToggle,
  className,
}: {
  visible: boolean;
  checked: boolean;
  label: string;
  onToggle(): void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        itemActionVisibilityClassName,
        'absolute right-2 top-2 z-30 grid size-7 place-items-center rounded-sm border bg-overlay/95 backdrop-blur-sm',
        visible && 'pointer-events-auto opacity-100',
        className,
      )}
    >
      <Checkbox
        checked={checked}
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={onToggle}
      />
    </span>
  );
}

function sameRevealContext(a: AssetFileRevealContext | undefined, b: AssetFileRevealContext | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The gallery re-renders on every list mutation — a metadata save, a rating, a
 * favorite toggle. Without this the whole masonry re-renders for a one-item
 * change, which is what made saving feel like a freeze.
 */
export const MaterialCard = memo(MaterialCardImpl, (previous, next) => {
  const keys = Object.keys({ ...previous, ...next }) as Array<keyof Props>;
  return keys.every((key) =>
    key === 'revealContext'
      ? sameRevealContext(previous.revealContext, next.revealContext)
      : previous[key] === next[key],
  );
});

function MaterialCardImpl({
  item,
  selected,
  checked = false,
  selectionMode = false,
  selectionAvailable = true,
  viewMode,
  frameAspectRatio,
  showName = true,
  onSelect,
  onEnterSelection,
  onToggleSelection,
  onCopyText,
  onArchive,
  onDelete,
  lifecycleBusy = false,
  notify,
  onDragStart,
  revealContext,
}: Props) {
  const { locale, messages } = useI18n();
  const actions = useAssetMenuActions();
  const pinMaterial = usePinContentAction(notify);
  const l = messages.gallery.card;
  const [imageFailed, setImageFailed] = useState(false);
  const fallbackTitle =
    item.kind === 'TEXT' ? l.textMaterial : item.image.asset.kind === 'GENERATED' ? l.generated : l.reference;
  const title = materialTitle(item, fallbackTitle);
  const date = formatDate(item.createdAt, locale);
  const image = item.kind !== 'TEXT' ? item.image : null;
  const video = isVideoAsset(image?.asset);
  const materialId = item.kind !== 'TEXT' ? item.image.materialId : item.text.id;
  const creationRoles = image?.creation?.roles
    .map((role) =>
      role === 'OUTPUT'
        ? messages.gallery.inspector.roleOutput
        : role === 'SOURCE'
          ? messages.gallery.inspector.roleSource
          : messages.gallery.inspector.roleInput,
    )
    .join(' / ');
  const creationRelationship = image?.creation ? (creationRoles ? `${l.creation} · ${creationRoles}` : l.creation) : '';
  const relationship =
    image?.creation && image.dictionary
      ? `${creationRelationship} · ${l.dictionary}`
      : image?.creation
        ? creationRelationship
        : image?.dictionary
          ? l.dictionary
          : image?.favorite
            ? l.favorite
            : '';
  const cardAspectRatio = getMaterialCardAspectRatio(item);
  const longPress = useLongPressSelection(() => onEnterSelection(item), selectionMode || !selectionAvailable);
  function activate(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    if (!selectionAvailable) {
      onSelect(item);
      return;
    }
    const modifiers = selectionModifiers(event);
    onSelect(item, selectionMode && !modifiers.range && !modifiers.toggle ? { range: false, toggle: true } : modifiers);
  }
  const commonActions: ActionMenuAction[] = [
    {
      id: 'details',
      label: l.details,
      icon: EyeIcon,
      onSelect: () => onSelect(item),
    },
    ...(video && materialId && actions
      ? [
          {
            id: 'create-video-document',
            label: messages.videoDocuments.createFromVideo,
            icon: FileTextIcon,
            onSelect: () =>
              void actions.createDocumentFromVideo(
                materialId,
                revealContext?.kind === 'ALBUM' ? revealContext.albumId : null,
              ),
          } satisfies ActionMenuAction,
        ]
      : []),
  ];
  const lifecycleAvailable = hasMaterialLifecycleEntity(item);
  const lifecycleActions: ActionMenuAction[] = [
    ...(onArchive && lifecycleAvailable
      ? [
          {
            id: 'archive-material',
            label: messages.contentManagement.actions.archive,
            icon: ArchiveIcon,
            disabled: lifecycleBusy,
            onSelect: () => onArchive(item),
          } satisfies ActionMenuAction,
        ]
      : []),
    ...(onDelete && lifecycleAvailable
      ? [
          {
            id: 'delete-material',
            label: messages.contentManagement.actions.delete,
            icon: Trash2Icon,
            destructive: true,
            disabled: lifecycleBusy,
            onSelect: () => onDelete(item),
          } satisfies ActionMenuAction,
        ]
      : []),
  ];
  const textActions: ActionMenuAction[] =
    item.kind === 'TEXT'
      ? [
          ...commonActions,
          pinMaterial(materialPinSource(item)),
          { id: 'copy', label: l.copyText, icon: CopyIcon, onSelect: () => onCopyText(item.text.text) },
          ...lifecycleActions.map((action, index) => ({
            ...action,
            separatorBefore: index === 0,
          })),
        ]
      : commonActions;

  if (viewMode === 'LIST') {
    const card = (
      <article
        data-material-key={item.key}
        data-material-id={materialId ?? undefined}
        draggable={Boolean(onDragStart)}
        onDragStart={(event) => onDragStart?.(event, item)}
        className="group group/item relative border-b last:border-b-0"
      >
        <button
          type="button"
          data-action="material-open-inspector"
          data-material-key={item.key}
          data-material-id={materialId ?? undefined}
          aria-label={l.select(title)}
          aria-pressed={selected || checked}
          onClick={activate}
          {...longPress}
          className={cn(
            'flex w-full items-center gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            selected && 'bg-selected text-selected-foreground hover:bg-selected',
            checked && 'bg-selected/60',
          )}
        >
          <div
            className={cn(
              'relative isolate h-16 w-20 shrink-0 overflow-hidden rounded-md border',
              video ? 'bg-media-surround-dark' : 'bg-surface-sunken',
            )}
          >
            <MaterialListPreview
              item={item}
              video={video}
              failed={imageFailed}
              unavailableLabel={l.previewUnavailable}
              onError={() => setImageFailed(true)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <strong className="truncate text-sm font-medium">{title}</strong>
              {image?.favorite && (
                <HeartIcon className="size-3.5 shrink-0 fill-current text-relation-favorited" aria-label={l.favorite} />
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.kind === 'TEXT' ? item.text.text : relationship}
            </p>
          </div>
          {item.kind === 'TEXT' && (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{l.text}</span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">{date}</span>
        </button>
        {selectionAvailable && (
          <SelectionCheckbox
            visible={selectionMode || checked}
            checked={checked}
            label={l.select(title)}
            onToggle={() => onToggleSelection(item)}
            className="top-1/2 -translate-y-1/2"
          />
        )}
      </article>
    );
    return image ? (
      <AssetFileContextMenu
        pinSource={materialPinSource(item)}
        assetId={image.asset.id}
        notify={notify}
        actions={commonActions}
        lifecycleActions={onArchive || onDelete ? lifecycleActions : undefined}
        revealContext={revealContext}
        copyable={!video}
        usableInCreation={!video}
      >
        {card}
      </AssetFileContextMenu>
    ) : (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div onContextMenu={() => onSelect(item)}>{card}</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ActionContextMenuItems actions={textActions} />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  if (item.kind === 'TEXT') {
    const [lead = '', ...rest] = item.text.text.split(/\r?\n/);
    const body = rest.join('\n').trim();

    const card = (
      <article
        data-material-key={item.key}
        data-material-id={materialId}
        data-material-kind="TEXT"
        draggable={Boolean(onDragStart)}
        onDragStart={(event) => onDragStart?.(event, item)}
        data-material-aspect-ratio={cardAspectRatio.toFixed(3)}
        className={cn(
          'corner-continuous group group/item relative isolate w-full self-start overflow-hidden rounded-xl border bg-surface transition-colors duration-fast hover:border-border-strong',
          selected && 'border-border-strong ring-1 ring-border',
          checked && 'border-border-strong ring-1 ring-border',
        )}
        style={{ aspectRatio: cardAspectRatio }}
      >
        <button
          type="button"
          data-action="material-open-inspector"
          data-material-key={item.key}
          data-material-id={materialId}
          aria-label={l.select(title)}
          aria-pressed={selected || checked}
          onClick={activate}
          {...longPress}
          className="absolute inset-0 flex size-full flex-col bg-surface p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium">
              <FileTextIcon className="size-3.5" />
              {l.text}
            </span>
            <HeartIcon className="size-3.5 fill-current text-relation-favorited" aria-label={l.favorite} />
          </span>
          <span className="flex min-h-0 flex-1 flex-col justify-center py-3">
            <strong className={cn('break-words text-sm leading-5', body ? 'line-clamp-2' : 'line-clamp-6')}>
              {lead || title}
            </strong>
            {body && (
              <span className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/70">
                {body}
              </span>
            )}
          </span>
          <span className="flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
            <span className="truncate">{l.favorite}</span>
            <time className="shrink-0" dateTime={item.createdAt}>
              {date}
            </time>
          </span>
        </button>
        {selectionAvailable && (
          <SelectionCheckbox
            visible={selectionMode || checked}
            checked={checked}
            label={l.select(title)}
            onToggle={() => onToggleSelection(item)}
          />
        )}
      </article>
    );
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div onContextMenu={() => onSelect(item)}>{card}</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ActionContextMenuItems actions={textActions} />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  const imageItem = item.image;
  const previewUrl = video
    ? imageItem.asset.mediaUrl
    : mediaThumbnailUrl(imageItem.asset, MATERIAL_GRID_THUMBNAIL_SIZE);
  const shapeLabel =
    cardAspectRatio < MIN_MATERIAL_FRAME_RATIO
      ? l.longImage
      : cardAspectRatio > MAX_MATERIAL_FRAME_RATIO
        ? l.wideImage
        : null;

  return (
    <AssetFileContextMenu
      pinSource={materialPinSource(item)}
      assetId={imageItem.asset.id}
      notify={notify}
      actions={commonActions}
      lifecycleActions={onArchive || onDelete ? lifecycleActions : undefined}
      revealContext={revealContext}
      copyable={!video}
      usableInCreation={!video}
    >
      <article
        data-material-key={item.key}
        data-material-id={materialId ?? undefined}
        data-material-kind={video ? 'VIDEO' : 'IMAGE'}
        data-media-card
        draggable={Boolean(onDragStart)}
        onDragStart={(event) => onDragStart?.(event, item)}
        data-material-aspect-ratio={cardAspectRatio.toFixed(3)}
        className="group group/item relative isolate w-full min-w-0 self-start"
      >
        <div
          className={cn(
            'relative w-full overflow-hidden rounded-sm',
            video ? 'bg-media-surround-dark' : 'bg-surface-sunken',
          )}
          style={{ aspectRatio: frameAspectRatio ?? cardAspectRatio }}
        >
          <button
            type="button"
            data-action="material-open-inspector"
            data-material-key={item.key}
            data-material-id={materialId ?? undefined}
            aria-label={l.select(title)}
            aria-pressed={selected || checked}
            onClick={activate}
            {...longPress}
            className={cn('group/card absolute inset-0 block size-full text-left outline-none')}
          >
            {imageFailed ? (
              <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                {video ? <VideoIcon className="size-8 opacity-50" /> : <ImageIcon className="size-8 opacity-50" />}
                <span className="sr-only">{l.previewUnavailable}</span>
              </span>
            ) : (
              <AssetMedia
                asset={imageItem.asset}
                src={previewUrl}
                className="absolute inset-0 size-full object-contain"
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                muted
                onError={() => setImageFailed(true)}
              />
            )}
            {(imageItem.favorite || selected) && !checked && !selectionMode && (
              <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 bg-overlay/90 p-1 text-foreground">
                {imageItem.favorite && (
                  <HeartIcon className="size-3.5 fill-current text-relation-favorited" aria-label={l.favorite} />
                )}
                {selected && <CheckIcon className="size-3.5" aria-hidden="true" />}
              </span>
            )}
            {shapeLabel && !showName && (
              <span className="absolute bottom-2 right-2 bg-overlay/90 px-1.5 py-0.5 text-[10px] text-foreground group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:hidden">
                {shapeLabel}
              </span>
            )}
            {showName && (
              <MediaCardCaption
                data-material-overlay
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <strong className="block truncate text-sm font-semibold">{title}</strong>
                {shapeLabel && <span className="text-xs font-normal opacity-85">{shapeLabel}</span>}
              </MediaCardCaption>
            )}
            <span
              className={cn(
                'pointer-events-none absolute inset-0 z-20 group-focus-visible/card:ring-2 group-focus-visible/card:ring-inset group-focus-visible/card:ring-ring',
                (selected || checked) && 'ring-2 ring-inset ring-selected-border',
              )}
            />
          </button>
        </div>
        {selectionAvailable && (
          <SelectionCheckbox
            visible={selectionMode || checked}
            checked={checked}
            label={l.select(title)}
            onToggle={() => onToggleSelection(item)}
          />
        )}
      </article>
    </AssetFileContextMenu>
  );
}
