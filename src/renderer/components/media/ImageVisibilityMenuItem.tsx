import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { ContextMenuIcon, ContextMenuItem } from '@/renderer/components/ui/context-menu';
import { useImageVisibility } from '@/renderer/components/media/ImageVisibilityProvider';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ImageVisibilityMenuItem({ assetId, enabled }: { assetId: string; enabled: boolean }) {
  const visibility = useImageVisibility();
  const copy = useI18n().messages.assetFile;
  if (!visibility || !enabled) return null;
  const hidden = visibility.hiddenIds.has(assetId);
  return (
    <ContextMenuItem
      disabled={!visibility.ready || visibility.busy}
      onSelect={() => void visibility.setHidden([assetId], !hidden)}
    >
      <ContextMenuIcon>{hidden ? <EyeIcon /> : <EyeOffIcon />}</ContextMenuIcon>
      {hidden ? copy.unhideImage : copy.hideImage}
    </ContextMenuItem>
  );
}
