import type { AssetDto } from '@/shared/contracts';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

/** Reference images without a creation workspace still open the exact selected asset. */
export function CreationLibraryAssetPreview({ asset, onClose }: { asset: AssetDto | null; onClose(): void }) {
  const labels = useI18n().messages.gallery.inspector;
  return (
    <Dialog open={Boolean(asset)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-[min(96vw,96rem)] rounded-md p-2">
        <DialogTitle className="sr-only">{labels.preview}</DialogTitle>
        {asset && <img src={asset.mediaUrl} alt="" className="max-h-[90vh] w-full object-contain" />}
      </DialogContent>
    </Dialog>
  );
}
