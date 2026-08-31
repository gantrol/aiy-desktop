import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { AssetDto, AssetFileRevealContext, Locale } from '@/shared/contracts';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { MediaActionMenu } from '@/renderer/components/media/MediaActionMenu';
import { MediaOrderHandle } from '@/renderer/components/media/MediaOrderHandle';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { cn } from '@/renderer/lib/utils';

interface Props {
  asset: AssetDto;
  referenceAssets: AssetDto[];
  copyingAssetId: string | null;
  copyLabel: string;
  dragTargetId: string | null;
  index: number;
  locale: Locale;
  moreActionsLabel: string;
  revealContext?: AssetFileRevealContext;
  notify(message: string): void;
  onCopy(assetId: string): void;
  onDragTargetIdChange(assetId: string | null): void;
  onPreview(assetId: string): void;
  onReferenceAssetsChange(assets: AssetDto[]): void;
  onRemove(assetId: string): void;
}

const creatorReferenceMediaDragType = 'application/x-aiy-creator-reference-media';

function startReferenceMediaDrag(event: ReactDragEvent<HTMLElement>, assetId: string) {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(creatorReferenceMediaDragType, assetId);
}

function move<T>(items: readonly T[], index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function moveTo<T>(items: readonly T[], sourceIndex: number, targetIndex: number) {
  if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) return [...items];
  const next = [...items];
  const [item] = next.splice(sourceIndex, 1);
  if (item === undefined) return [...items];
  next.splice(targetIndex, 0, item);
  return next;
}

export function CreatorReferenceImageCard({
  asset,
  referenceAssets,
  copyingAssetId,
  copyLabel,
  dragTargetId,
  index,
  locale,
  moreActionsLabel,
  revealContext,
  notify,
  onCopy,
  onDragTargetIdChange,
  onPreview,
  onReferenceAssetsChange,
  onRemove,
}: Props) {
  const actions: ActionMenuAction[] = [
    {
      id: 'creator-reference-move-earlier',
      label: locale === 'zh' ? '前移' : 'Move earlier',
      icon: ArrowLeftIcon,
      disabled: index === 0,
      onSelect: () => onReferenceAssetsChange(move(referenceAssets, index, -1)),
    },
    {
      id: 'creator-reference-move-later',
      label: locale === 'zh' ? '后移' : 'Move later',
      icon: ArrowRightIcon,
      disabled: index === referenceAssets.length - 1,
      onSelect: () => onReferenceAssetsChange(move(referenceAssets, index, 1)),
    },
    {
      id: 'creator-reference-copy',
      label: copyLabel,
      icon: copyingAssetId === asset.id ? LoaderCircleIcon : CopyIcon,
      busy: copyingAssetId === asset.id,
      disabled: Boolean(copyingAssetId),
      onSelect: () => onCopy(asset.id),
    },
    {
      id: 'creator-reference-remove',
      label: locale === 'zh' ? '从创作移除' : 'Remove from creation',
      icon: Trash2Icon,
      destructive: true,
      separatorBefore: true,
      onSelect: () => onRemove(asset.id),
    },
  ];
  const contextActions = actions.filter(
    (action) => action.id !== 'creator-reference-copy' && action.id !== 'creator-reference-remove',
  );

  return (
    <figure
      className={cn(
        'group relative aspect-square min-w-0 overflow-hidden rounded-lg border bg-surface-sunken',
        dragTargetId === asset.id && 'ring-2 ring-selected-border',
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(creatorReferenceMediaDragType)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        onDragTargetIdChange(asset.id);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragTargetIdChange(null);
      }}
      onDrop={(event) => {
        const sourceId = event.dataTransfer.getData(creatorReferenceMediaDragType);
        if (!sourceId) return;
        event.preventDefault();
        event.stopPropagation();
        onDragTargetIdChange(null);
        onReferenceAssetsChange(
          moveTo(
            referenceAssets,
            referenceAssets.findIndex((candidate) => candidate.id === sourceId),
            index,
          ),
        );
      }}
    >
      <AssetFileContextMenu
        assetId={asset.id}
        notify={notify}
        revealContext={revealContext}
        actions={contextActions}
        draggable={false}
      >
        <button
          type="button"
          draggable
          className="relative size-full cursor-grab overflow-hidden outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          title={locale === 'zh' ? '拖动调整顺序，单击放大' : 'Drag to reorder, click to enlarge'}
          aria-label={
            locale === 'zh'
              ? `第 ${index + 1} 张图片：拖动调整顺序，单击放大`
              : `Image ${index + 1}: drag to reorder, click to enlarge`
          }
          onDragStart={(event) => startReferenceMediaDrag(event, asset.id)}
          onDragEnd={() => onDragTargetIdChange(null)}
          onClick={() => onPreview(asset.id)}
        >
          <img
            src={mediaThumbnailUrl(asset, 512)}
            alt=""
            width={asset.width}
            height={asset.height}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="pointer-events-none size-full bg-media-surround-light object-contain"
          />
        </button>
      </AssetFileContextMenu>
      <MediaOrderHandle
        draggable
        className="absolute top-1.5 left-1.5 z-20 tabular-nums"
        label={locale === 'zh' ? `拖动第 ${index + 1} 张图片调整顺序` : `Drag image ${index + 1} to reorder`}
        onDragStart={(event) => startReferenceMediaDrag(event, asset.id)}
        onDragEnd={() => onDragTargetIdChange(null)}
      >
        {index + 1}
      </MediaOrderHandle>
      <MediaActionMenu
        actions={actions}
        label={moreActionsLabel}
        className="absolute right-1.5 bottom-1.5 z-20 size-7"
      />
    </figure>
  );
}
