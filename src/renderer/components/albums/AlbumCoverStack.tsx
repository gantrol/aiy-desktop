import { useState, type CSSProperties } from 'react';
import { FolderIcon, type LucideIcon } from 'lucide-react';
import {
  albumCoverAssets,
  ALBUM_COVER_LAYERS,
  type AlbumCoverAsset,
} from '@/renderer/components/albums/albumCoverAssets';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { getSourceMediaAspectRatio } from '@/renderer/components/media/mediaAspectRatio';
import { stackedMediaFrameLayerClassName, stackedMediaFrameStyle } from '@/renderer/components/ui/stacked-media-frame';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

/** Hover previews stay local; the host owns opening, disclosure and dragging. */
export function AlbumCoverStack({
  assets,
  title,
  icon: Icon = FolderIcon,
  compact = false,
  className,
}: {
  assets: readonly AlbumCoverAsset[];
  title: string;
  icon?: LucideIcon;
  compact?: boolean;
  className?: string;
}) {
  const labels = useI18n().messages.gallery.albums;
  const layers = albumCoverAssets(assets, ALBUM_COVER_LAYERS);
  const [hovered, setHovered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const spread = hovered && layers.length > 1;

  function resetPreview() {
    setHovered(false);
    setActiveIndex(0);
  }

  return (
    <span
      data-slot="album-cover-stack"
      data-layer-count={layers.length}
      data-cover-spread={spread ? 'expanded' : 'collapsed'}
      data-active-cover={spread ? activeIndex : 0}
      aria-hidden="true"
      title={title}
      className={cn('group/cover relative isolate block min-h-0 min-w-0 flex-1 overflow-hidden rounded-md', className)}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') setHovered(true);
      }}
      onPointerLeave={resetPreview}
      onPointerCancel={resetPreview}
    >
      {layers.length ? (
        <span className="absolute inset-1 [container-type:size]">
          {layers.map((asset, index) => {
            const aspectRatio = getSourceMediaAspectRatio(asset.width ?? 0, asset.height ?? 0);
            const offset = index - (layers.length - 1) / 2;
            const step = spread
              ? compact
                ? 'clamp(6px, 16cqw, 10px)'
                : 'clamp(24px, 16cqw, 52px)'
              : `${compact ? 3 : 6}px`;
            return (
              <span
                key={asset.id}
                data-cover-layer={index}
                className={cn(
                  'pointer-events-none absolute left-1/2 top-1/2 isolate overflow-hidden rounded-md bg-surface-sunken ring-1 ring-border/50',
                  'transition-[width,transform] duration-200 ease-out motion-reduce:transition-none',
                  stackedMediaFrameLayerClassName,
                )}
                style={
                  {
                    ...stackedMediaFrameStyle(spread && index === activeIndex ? 20 : layers.length - index, {
                      // Fit the whole fan inside its host, including narrow list covers.
                      aspectRatio,
                      width: `min(calc(100cqw - ${layers.length - 1} * var(--cover-step) - 2px), ${96 * aspectRatio}cqh)`,
                      transform: `translate(-50%, -50%) translate(calc(${offset} * var(--cover-step)), ${spread ? 0 : index * -2}px) rotate(${spread ? 0 : index * 0.8}deg)`,
                    }),
                    '--cover-step': step,
                  } as CSSProperties
                }
              >
                <AssetThumbnail
                  asset={asset}
                  errorClassName="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2"
                  size={compact ? 128 : 512}
                  alt=""
                  className="absolute inset-0 size-full object-contain"
                />
              </span>
            );
          })}
          {layers.length > 1 && (
            <span className="absolute inset-0 z-30 flex">
              {layers.map((asset, index) => (
                // Stable hit areas prevent the lifted image from stealing hover
                // from the next cover as the fan animates underneath the pointer.
                <span
                  key={asset.id}
                  className="h-full min-w-0 flex-1"
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch') setActiveIndex(index);
                  }}
                />
              ))}
            </span>
          )}
        </span>
      ) : (
        <span className="absolute inset-px flex flex-col items-start justify-end gap-3 overflow-hidden rounded-md bg-surface-sunken p-4 text-muted-foreground">
          <Icon className={cn('shrink-0', compact ? 'size-5' : 'size-6')} />
          {!compact && <span className="text-xs leading-relaxed">{labels.noCover}</span>}
        </span>
      )}
    </span>
  );
}
