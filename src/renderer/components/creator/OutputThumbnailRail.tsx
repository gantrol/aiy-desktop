import { LoaderCircleIcon, PanelRightOpenIcon, UploadIcon } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AssetDto, AssetFileRevealContext } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { AssetHoverPreview } from '@/renderer/components/creator/AssetHoverPreview';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';

interface Props {
  assets: AssetDto[];
  selectedAssetId: string | null;
  label?: string;
  expandLabel: string;
  resizeLabel?: string;
  resizeValue?: number;
  resizeMin?: number;
  resizeMax?: number;
  onResizeValueChange?(value: number): void;
  importLabel: string;
  importing: boolean;
  onExpand(): void;
  onImport(): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onSelect(assetId: string): void;
  notify(message: string): void;
  revealContextForAsset?(assetId: string): AssetFileRevealContext | undefined;
  actionsForAsset?(assetId: string): readonly ActionMenuAction[];
  thumbnailLabel?(asset: AssetDto, index: number): string;
}

export function OutputThumbnailRail({
  assets,
  selectedAssetId,
  label,
  expandLabel,
  resizeLabel,
  resizeValue,
  resizeMin,
  resizeMax,
  onResizeValueChange,
  importLabel,
  importing,
  onExpand,
  onImport,
  onResizeStart,
  onSelect,
  notify,
  revealContextForAsset,
  actionsForAsset,
  thumbnailLabel,
}: Props) {
  return (
    <aside
      aria-label={label ?? expandLabel}
      className="relative flex size-full min-h-0 flex-col border-l bg-surface-sunken"
    >
      <CreatorPaneResizeHandle
        edge="left"
        label={resizeLabel ?? expandLabel}
        value={resizeValue}
        min={resizeMin}
        max={resizeMax}
        onValueChange={onResizeValueChange}
        onPointerDown={onResizeStart}
      />
      <div className="grid h-14 shrink-0 place-items-center border-b border-border/60">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={importing}
          title={importLabel}
          aria-label={importLabel}
          onClick={onImport}
        >
          {importing ? <LoaderCircleIcon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
        </Button>
      </div>
      <ScrollArea type="always" className="min-h-0 flex-1">
        <div className="flex flex-col items-center gap-2 px-2 pt-3 pb-14">
          {assets.map((asset, index) => {
            const accessibleLabel = thumbnailLabel?.(asset, index) ?? `${expandLabel} ${index + 1}`;
            return (
              <AssetFileContextMenu
                key={asset.id}
                assetId={asset.id}
                notify={notify}
                revealContext={revealContextForAsset?.(asset.id)}
                actions={actionsForAsset?.(asset.id)}
              >
                <AssetHoverPreview asset={asset} side="left">
                  <button
                    type="button"
                    aria-label={accessibleLabel}
                    aria-pressed={asset.id === selectedAssetId}
                    title={accessibleLabel}
                    className={cn(
                      'relative isolate h-14 w-11 overflow-hidden rounded-md border-2 border-transparent bg-surface-sunken p-0.5 outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      asset.id === selectedAssetId && 'border-selected-border ring-2 ring-ring',
                    )}
                    onClick={() => {
                      onSelect(asset.id);
                      onExpand();
                    }}
                  >
                    <ImageAmbientBackdrop src={asset.mediaUrl} loading="lazy" />
                    <img
                      src={asset.mediaUrl}
                      alt=""
                      className="relative z-10 size-full rounded-sm object-contain"
                      loading="lazy"
                      draggable={false}
                    />
                  </button>
                </AssetHoverPreview>
              </AssetFileContextMenu>
            );
          })}
        </div>
      </ScrollArea>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 shadow-overlay"
        title={expandLabel}
        aria-label={expandLabel}
        onClick={onExpand}
      >
        <PanelRightOpenIcon className="size-4" />
      </Button>
    </aside>
  );
}
