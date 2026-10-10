import { ExternalLinkIcon, ImagesIcon, LinkIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useAssetNavigation, type AssetNavigationIntent } from '@/renderer/components/media/AssetNavigationProvider';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AssetNavigationButton({
  assetId,
  intent,
  disabled,
}: {
  assetId: string;
  intent: AssetNavigationIntent;
  disabled?: boolean;
}) {
  const navigation = useAssetNavigation();
  const { messages } = useI18n();
  if (!navigation || (intent === 'MATERIAL' && navigation.currentAssetId === assetId)) return null;
  const busy = navigation.busyAssetId === assetId;
  const label =
    intent === 'MATERIAL'
      ? messages.assetFile.viewMaterial
      : intent === 'SOURCES'
        ? messages.assetFile.sources
        : messages.workbench.openSource;
  const Icon = busy
    ? LoaderCircleIcon
    : intent === 'MATERIAL'
      ? ImagesIcon
      : intent === 'SOURCES'
        ? LinkIcon
        : ExternalLinkIcon;
  const open = () => {
    void navigation.open(assetId, intent);
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled || busy}
            aria-busy={busy}
            onClick={open}
          >
            <Icon aria-hidden className={busy ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
