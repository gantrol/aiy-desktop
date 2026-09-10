import { CheckIcon, CircleSlashIcon, ImageIcon, LoaderCircleIcon, StarIcon } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/types';
import type { BrowserCompanionWatermarkSelection, NaturalWatermarkConfiguration } from '@/shared/contracts';
import {
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/renderer/components/ui/dropdown-menu';

function selectionLabel(
  selection: BrowserCompanionWatermarkSelection,
  configuration: NaturalWatermarkConfiguration | null,
  copy: MessageCatalog['browserCompanion'],
) {
  if (selection.kind === 'NONE') return copy.noWatermark;
  if (selection.kind === 'PREFERRED') {
    const preferred = configuration?.profiles.find(({ id }) => id === configuration.preferredProfileId);
    return preferred?.name ?? copy.preferredWatermark;
  }
  return configuration?.profiles.find(({ id }) => id === selection.profileId)?.name ?? copy.watermarkProfile;
}

function SelectionIcon({ selected }: { selected: boolean }) {
  return <DropdownMenuIcon>{selected ? <CheckIcon /> : <span />}</DropdownMenuIcon>;
}

export function CompanionWatermarkSubmenu({
  busy,
  selection,
  onSelectionChange,
}: {
  busy: boolean;
  selection: BrowserCompanionWatermarkSelection;
  zh?: boolean;
  onSelectionChange(selection: BrowserCompanionWatermarkSelection): void;
}) {
  const copy = useI18n().messages.browserCompanion;
  const [configuration, setConfiguration] = useState<NaturalWatermarkConfiguration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      setConfiguration(await window.desktopApi.naturalWatermarkConfigurationGet());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <DropdownMenuSub onOpenChange={(open) => open && void refresh()}>
      <DropdownMenuSubTrigger data-browser-companion-watermark-menu disabled={busy}>
        <DropdownMenuIcon>
          <ImageIcon />
        </DropdownMenuIcon>
        <span className="min-w-0 flex-1 truncate">{copy.watermark}</span>
        <span className="max-w-24 truncate text-xs text-muted-foreground">
          {selectionLabel(selection, configuration, copy)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuItem disabled={busy} onSelect={() => onSelectionChange({ kind: 'NONE' })}>
          <SelectionIcon selected={selection.kind === 'NONE'} />
          {copy.noWatermark}
        </DropdownMenuItem>
        {loading && !configuration ? (
          <DropdownMenuItem disabled>
            <DropdownMenuIcon>
              <LoaderCircleIcon className="animate-spin" />
            </DropdownMenuIcon>
            {copy.loadingWatermarks}
          </DropdownMenuItem>
        ) : error ? (
          <DropdownMenuItem disabled>
            <DropdownMenuIcon>
              <CircleSlashIcon />
            </DropdownMenuIcon>
            <span className="truncate">{error}</span>
          </DropdownMenuItem>
        ) : configuration ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onSelect={() => onSelectionChange({ kind: 'PREFERRED' })}>
              <SelectionIcon selected={selection.kind === 'PREFERRED'} />
              <StarIcon className="size-3.5 fill-current" />
              <span className="truncate">
                {copy.preferredWatermark} ·{' '}
                {configuration.profiles.find(({ id }) => id === configuration.preferredProfileId)?.name}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {configuration.profiles.map((profile) => (
              <DropdownMenuItem
                key={profile.id}
                disabled={busy}
                onSelect={() => onSelectionChange({ kind: 'PROFILE', profileId: profile.id })}
              >
                <SelectionIcon selected={selection.kind === 'PROFILE' && selection.profileId === profile.id} />
                <span className="truncate">{profile.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
