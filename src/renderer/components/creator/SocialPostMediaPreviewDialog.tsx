import type { AssetDto, Locale } from '@/shared/contracts';
import { MediaPreviewDialog } from '@/renderer/components/media/MediaPreviewDialog';

interface Props {
  assetIds: readonly string[];
  assetsById: ReadonlyMap<string, AssetDto>;
  coverAssetId: string | null;
  copyingAssetId: string | null;
  copyLabel: string;
  locale: Locale;
  openAssetId: string | null;
  notify(message: string): void;
  onCopy(assetId: string): void;
  onOpenAssetIdChange(assetId: string | null): void;
  onRemove(assetId: string): void;
  onSetCover(assetId: string): void;
}

export function SocialPostMediaPreviewDialog({
  assetIds,
  assetsById,
  coverAssetId,
  copyingAssetId,
  copyLabel,
  locale,
  openAssetId,
  notify,
  onCopy,
  onOpenAssetIdChange,
  onRemove,
  onSetCover,
}: Props) {
  return (
    <MediaPreviewDialog
      assetIds={assetIds}
      assetsById={assetsById}
      coverAssetId={coverAssetId}
      copyingAssetId={copyingAssetId}
      copyLabel={copyLabel}
      dataDialog="social-post-media-preview"
      locale={locale}
      openAssetId={openAssetId}
      notify={notify}
      onCopy={onCopy}
      onOpenAssetIdChange={onOpenAssetIdChange}
      onRemove={onRemove}
      onSetCover={onSetCover}
    />
  );
}
