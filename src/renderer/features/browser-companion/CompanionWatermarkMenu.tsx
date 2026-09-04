import { CheckIcon, CircleSlashIcon, ImageIcon, LoaderCircleIcon, StarIcon } from 'lucide-react';
import { useState } from 'react';
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
  zh: boolean,
) {
  if (selection.kind === 'NONE') return zh ? '无' : 'None';
  if (selection.kind === 'PREFERRED') {
    const preferred = configuration?.profiles.find(({ id }) => id === configuration.preferredProfileId);
    return preferred?.name ?? (zh ? '首选' : 'Preferred');
  }
  return configuration?.profiles.find(({ id }) => id === selection.profileId)?.name ?? (zh ? '指定方案' : 'Profile');
}

function SelectionIcon({ selected }: { selected: boolean }) {
  return <DropdownMenuIcon>{selected ? <CheckIcon /> : <span />}</DropdownMenuIcon>;
}

export function CompanionWatermarkSubmenu({
  busy,
  selection,
  zh,
  onSelectionChange,
}: {
  busy: boolean;
  selection: BrowserCompanionWatermarkSelection;
  zh: boolean;
  onSelectionChange(selection: BrowserCompanionWatermarkSelection): void;
}) {
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
        <span className="min-w-0 flex-1 truncate">{zh ? '水印' : 'Watermark'}</span>
        <span className="max-w-24 truncate text-xs text-muted-foreground">
          {selectionLabel(selection, configuration, zh)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuItem disabled={busy} onSelect={() => onSelectionChange({ kind: 'NONE' })}>
          <SelectionIcon selected={selection.kind === 'NONE'} />
          {zh ? '无水印' : 'No watermark'}
        </DropdownMenuItem>
        {loading && !configuration ? (
          <DropdownMenuItem disabled>
            <DropdownMenuIcon>
              <LoaderCircleIcon className="animate-spin" />
            </DropdownMenuIcon>
            {zh ? '读取方案' : 'Loading profiles'}
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
                {zh ? '首选' : 'Preferred'} ·{' '}
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
