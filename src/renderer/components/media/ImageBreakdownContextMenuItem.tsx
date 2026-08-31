import { LoaderCircleIcon, ScanSearchIcon } from 'lucide-react';
import { useState } from 'react';
import { useAssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import { ContextMenuIcon, ContextMenuItem } from '@/renderer/components/ui/context-menu';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ImageBreakdownContextMenuItem({
  assetId,
  sourceFormId,
  disabled = false,
  notify,
}: {
  assetId: string;
  sourceFormId: string | null;
  disabled?: boolean;
  notify(message: string): void;
}) {
  const labels = useI18n().messages.assetFile;
  const menuActions = useAssetMenuActions();
  const [busy, setBusy] = useState(false);

  async function createBreakdown() {
    if (!menuActions || busy || disabled) return;
    setBusy(true);
    try {
      await menuActions.createImageBreakdown(assetId, sourceFormId);
      notify(labels.imageBreakdownCreated);
    } catch (reason) {
      notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ContextMenuItem disabled={disabled || !menuActions || busy} onSelect={() => void createBreakdown()}>
      <ContextMenuIcon>{busy ? <LoaderCircleIcon className="animate-spin" /> : <ScanSearchIcon />}</ContextMenuIcon>
      {labels.imageBreakdown}
    </ContextMenuItem>
  );
}
