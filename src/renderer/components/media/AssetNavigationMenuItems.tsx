import { ImagesIcon, LinkIcon } from 'lucide-react';
import { ContextMenuIcon, ContextMenuItem, ContextMenuSeparator } from '@/renderer/components/ui/context-menu';
import { useAssetNavigation } from '@/renderer/components/media/AssetNavigationProvider';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AssetNavigationMenuItems({
  assetId,
  showMaterial,
  hasDetails,
}: {
  assetId: string;
  showMaterial?: boolean;
  hasDetails: boolean;
}) {
  const navigation = useAssetNavigation();
  const { messages } = useI18n();
  if (!navigation) return null;
  return (
    <>
      {showMaterial !== false && !hasDetails && navigation.currentAssetId !== assetId && (
        <ContextMenuItem
          disabled={navigation.busyAssetId === assetId}
          onSelect={() => void navigation.open(assetId, 'MATERIAL')}
        >
          <ContextMenuIcon>
            <ImagesIcon />
          </ContextMenuIcon>
          {messages.assetFile.viewMaterial}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        disabled={navigation.busyAssetId === assetId}
        onSelect={() => void navigation.open(assetId, 'SOURCES')}
      >
        <ContextMenuIcon>
          <LinkIcon />
        </ContextMenuIcon>
        {messages.assetFile.sources}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}
