import { useEffect, useRef } from 'react';
import type { AssetDto } from '@/shared/contracts';
import type { GifFrame, GifManifest } from '@/shared/contracts/gif-making';
import { gifImagePlacement } from '@/shared/gif-layout';

export function GifCanvas({
  manifest,
  frame,
  assets,
  label,
  onError,
}: {
  manifest: GifManifest;
  frame: GifFrame | undefined;
  assets: Map<string, AssetDto>;
  label: string;
  onError(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const backgroundCache = useRef<{ url: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async (id: string, background = false) => {
      const asset = assets.get(id);
      if (!asset) throw new Error('GIF_ASSET_UNAVAILABLE');
      if (background && backgroundCache.current?.url === asset.mediaUrl) return backgroundCache.current.image;
      const image = new Image();
      image.src = asset.mediaUrl;
      await image.decode();
      if (background && !cancelled) backgroundCache.current = { url: asset.mediaUrl, image };
      return image;
    };
    void (async () => {
      const [background, image] = await Promise.all([
        manifest.backgroundAssetId ? load(manifest.backgroundAssetId, true) : null,
        frame ? load(frame.assetId) : null,
      ]);
      if (cancelled || !canvas.current) return;
      const context = canvas.current.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, manifest.width, manifest.height);
      if (manifest.backgroundColor) {
        context.fillStyle = manifest.backgroundColor;
        context.fillRect(0, 0, manifest.width, manifest.height);
      }
      const draw = (source: HTMLImageElement, selectedFrame: GifFrame | null, isBackground: boolean) => {
        const placement = gifImagePlacement(
          manifest,
          { width: source.naturalWidth, height: source.naturalHeight },
          selectedFrame,
          isBackground,
        );
        const { crop } = placement;
        context.drawImage(
          source,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          placement.x,
          placement.y,
          placement.width,
          placement.height,
        );
      };
      if (background) draw(background, null, true);
      if (image && frame) draw(image, frame, false);
    })().catch(() => {
      if (!cancelled) onError();
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, frame, assets, onError]);
  return (
    <canvas
      ref={canvas}
      width={manifest.width}
      height={manifest.height}
      aria-label={label}
      className="max-h-full max-w-full object-contain"
    />
  );
}
