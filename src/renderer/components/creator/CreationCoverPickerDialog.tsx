import { CheckIcon, GripVerticalIcon, ImagesIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { MAX_PROMPT_SERIES_COVERS } from '@/shared/contracts/creation-output-presentation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';

interface CreationCoverOptionProps {
  selected: boolean;
  selectionOrder: number | null;
  disabled: boolean;
  label: string;
  children: ReactNode;
  onSelect(): void;
}

function CreationCoverOption({
  selected,
  selectionOrder,
  disabled,
  label,
  children,
  onSelect,
}: CreationCoverOptionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        'group relative isolate aspect-[4/3] min-w-0 overflow-hidden rounded-lg border bg-surface-sunken text-left outline-none transition-colors duration-fast hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
        selected ? 'border-selected-border ring-2 ring-ring' : 'border-border',
      )}
      onClick={onSelect}
    >
      {children}
      {selected && (
        <span className="absolute top-2 right-2 z-20 grid size-6 place-items-center rounded-md border border-selected-border bg-selected text-xs font-semibold tabular-nums text-selected-foreground">
          {selectionOrder ?? <CheckIcon className="size-3.5" aria-hidden="true" />}
        </span>
      )}
    </button>
  );
}

function sameOrderedIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((assetId, index) => assetId === right[index]);
}

function reorderCoverIds(assetIds: readonly string[], sourceId: string, targetId: string, placeAfterTarget: boolean) {
  const sourceIndex = assetIds.indexOf(sourceId);
  const targetIndex = assetIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...assetIds];
  const next = assetIds.filter((assetId) => assetId !== sourceId);
  const adjustedTargetIndex = next.indexOf(targetId);
  next.splice(adjustedTargetIndex + Number(placeAfterTarget), 0, sourceId);
  return next;
}

interface Props {
  open: boolean;
  seriesTitle: string;
  assets: readonly AssetDto[];
  explicitCoverAssetIds: readonly string[];
  busy: boolean;
  onOpenChange(open: boolean): void;
  onApply(imageAssetIds: readonly string[]): void;
}

export function CreationCoverPickerDialog({
  open,
  seriesTitle,
  assets,
  explicitCoverAssetIds,
  busy,
  onOpenChange,
  onApply,
}: Props) {
  const { messages } = useI18n();
  const copy = messages.creator.outputPresentation;
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([...explicitCoverAssetIds]);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const selectedAssets = useMemo(() => {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return selectedAssetIds.flatMap((assetId) => {
      const asset = byId.get(assetId);
      return asset ? [asset] : [];
    });
  }, [assets, selectedAssetIds]);

  useEffect(() => {
    if (open) setSelectedAssetIds([...explicitCoverAssetIds]);
  }, [explicitCoverAssetIds, open, seriesTitle]);

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((current) => {
      if (current.includes(assetId)) return current.filter((selectedId) => selectedId !== assetId);
      if (current.length >= MAX_PROMPT_SERIES_COVERS) return current;
      return [...current, assetId];
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle>{copy.coverPickerTitle(seriesTitle)}</DialogTitle>
          <DialogDescription>{copy.coverPickerDescription}</DialogDescription>
        </DialogHeader>

        {selectedAssets.length > 0 ? (
          <div className="border-y bg-muted/20 px-6 py-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{copy.selectedOrder}</span>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline">{copy.dragToReorder}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="2xs"
                  disabled={busy}
                  onClick={() => setSelectedAssetIds([])}
                >
                  {copy.useAutomaticCover}
                </Button>
              </div>
            </div>
            <div role="list" aria-label={copy.selectedOrder} className="flex gap-2 overflow-x-auto pb-1">
              {selectedAssets.map((asset, index) => {
                const thumbnailUrl = mediaThumbnailUrl(asset, 160);
                return (
                  <div
                    key={asset.id}
                    role="listitem"
                    draggable={!busy}
                    data-dragging={draggingAssetId === asset.id ? 'true' : undefined}
                    className="relative aspect-[4/3] h-16 shrink-0 cursor-grab overflow-hidden rounded-md border bg-surface opacity-100 outline-none active:cursor-grabbing data-[dragging=true]:opacity-50"
                    title={copy.dragToReorder}
                    onDragStart={(event) => {
                      setDraggingAssetId(asset.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', asset.id);
                    }}
                    onDragEnd={() => setDraggingAssetId(null)}
                    onDragOver={(event) => {
                      const sourceId = draggingAssetId ?? event.dataTransfer.getData('text/plain');
                      if (!sourceId || sourceId === asset.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId = draggingAssetId ?? event.dataTransfer.getData('text/plain');
                      const bounds = event.currentTarget.getBoundingClientRect();
                      if (sourceId && sourceId !== asset.id) {
                        setSelectedAssetIds((current) =>
                          reorderCoverIds(current, sourceId, asset.id, event.clientX >= bounds.left + bounds.width / 2),
                        );
                      }
                      setDraggingAssetId(null);
                    }}
                  >
                    <img
                      src={thumbnailUrl}
                      alt=""
                      className="size-full bg-media-surround-light object-contain"
                      draggable={false}
                    />
                    <span className="absolute top-1 left-1 grid size-5 place-items-center rounded bg-overlay/90 text-[10px] font-semibold tabular-nums text-foreground">
                      {index + 1}
                    </span>
                    <span className="absolute right-8 bottom-1 left-1 flex items-center gap-1 truncate rounded bg-overlay/90 px-1.5 py-0.5 text-[10px] text-foreground">
                      <GripVerticalIcon className="size-3" aria-hidden="true" />
                      {copy.coverPosition(index + 1)}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      className="absolute top-1 right-1 z-10 size-6 bg-overlay/90"
                      disabled={busy}
                      aria-label={copy.deselectCover(index + 1)}
                      title={copy.deselectCover(index + 1)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => toggleAsset(asset.id)}
                    >
                      <XIcon className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div />
        )}

        <div className="min-h-0 overflow-y-auto px-6 py-1">
          <div className="grid grid-cols-2 gap-3 pb-3 sm:grid-cols-3 md:grid-cols-4">
            <CreationCoverOption
              selected={selectedAssetIds.length === 0}
              selectionOrder={null}
              disabled={busy}
              label={copy.automaticCover}
              onSelect={() => setSelectedAssetIds([])}
            >
              <span className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
                <span className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <ImagesIcon className="size-5" aria-hidden="true" />
                </span>
                <strong className="text-sm font-medium text-foreground">{copy.automaticCover}</strong>
                <span className="text-xs leading-5 text-muted-foreground">{copy.automaticCoverDescription}</span>
              </span>
            </CreationCoverOption>

            {assets.map((asset, index) => {
              const thumbnailUrl = mediaThumbnailUrl(asset, 320);
              const selectedIndex = selectedAssetIds.indexOf(asset.id);
              return (
                <CreationCoverOption
                  key={asset.id}
                  selected={selectedIndex >= 0}
                  selectionOrder={selectedIndex >= 0 ? selectedIndex + 1 : null}
                  disabled={busy || (selectedIndex < 0 && selectedAssetIds.length >= MAX_PROMPT_SERIES_COVERS)}
                  label={copy.coverImage(index + 1, asset.width, asset.height)}
                  onSelect={() => toggleAsset(asset.id)}
                >
                  <ImageAmbientBackdrop src={thumbnailUrl} loading="lazy" />
                  <img
                    src={thumbnailUrl}
                    alt=""
                    className="relative z-10 size-full object-contain"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </CreationCoverOption>
              );
            })}
          </div>
        </div>

        <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {copy.selectedCovers(selectedAssetIds.length, MAX_PROMPT_SERIES_COVERS)}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={busy || sameOrderedIds(selectedAssetIds, explicitCoverAssetIds)}
              onClick={() => onApply(selectedAssetIds)}
            >
              {busy && <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />}
              {copy.applyCover}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
