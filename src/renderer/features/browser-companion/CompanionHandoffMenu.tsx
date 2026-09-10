import { useI18n } from '@/renderer/i18n/useI18n';
import { ChevronDownIcon, CloudUploadIcon, ImagesIcon, LoaderCircleIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { CompanionDestinationSettingsSubmenu } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import { CompanionWatermarkSubmenu } from '@/renderer/features/browser-companion/CompanionWatermarkMenu';
import {
  readBrowserCompanionWatermarkSelection,
  writeBrowserCompanionWatermarkSelection,
} from '@/renderer/features/browser-companion/browserCompanionWatermarkPreference';
import type { BrowserCompanionTarget, BrowserCompanionWatermarkSelection } from '@/shared/contracts';

interface HandoffOptions {
  busy: boolean;
  disabled: boolean;
  onHandoff(target: BrowserCompanionTarget, watermark: BrowserCompanionWatermarkSelection): void;
  targets: readonly BrowserCompanionTarget[];
  watermarkAvailable: boolean;
  zh?: boolean;
}

export function useWatermarkSelection() {
  const [selection, setSelection] = useState(readBrowserCompanionWatermarkSelection);
  function select(selection: BrowserCompanionWatermarkSelection) {
    setSelection(selection);
    writeBrowserCompanionWatermarkSelection(selection);
  }
  return { selection, select };
}

function CompanionHandoffItems({
  busy,
  onHandoff,
  targets,
  watermarkAvailable,
  watermark,
}: Omit<HandoffOptions, 'disabled'> & { watermark: ReturnType<typeof useWatermarkSelection> }) {
  const copy = useI18n().messages.browserCompanion;
  return (
    <>
      {targets.map((target) => (
        <DropdownMenuItem
          key={target}
          data-browser-companion-target={target}
          disabled={busy}
          onSelect={() => onHandoff(target, watermarkAvailable ? watermark.selection : { kind: 'NONE' })}
        >
          <DropdownMenuIcon>
            <CloudUploadIcon />
          </DropdownMenuIcon>
          {copy.targets[target]}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      {watermarkAvailable && (
        <>
          <CompanionWatermarkSubmenu busy={busy} selection={watermark.selection} onSelectionChange={watermark.select} />
          <DropdownMenuSeparator />
        </>
      )}
      <CompanionDestinationSettingsSubmenu busy={busy} targets={targets} />
    </>
  );
}

export function CompanionHandoffSubmenu(
  options: HandoffOptions & { watermark?: ReturnType<typeof useWatermarkSelection> },
) {
  const copy = useI18n().messages.browserCompanion;
  const localWatermark = useWatermarkSelection();
  const watermark = options.watermark ?? localWatermark;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        data-action="image-post-upload"
        disabled={options.busy || options.disabled || options.targets.length === 0}
      >
        <DropdownMenuIcon>
          <ImagesIcon />
        </DropdownMenuIcon>
        <span className="min-w-0 flex-1">{copy.imagePostUpload}</span>
        {options.watermarkAvailable && (
          <span className="text-xs text-muted-foreground">
            {watermark.selection.kind === 'NONE' ? copy.noWatermark : copy.watermark}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <CompanionHandoffItems {...options} watermark={watermark} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function CompanionHandoffMenu({
  busy,
  disabled,
  onHandoff,
  targets,
  variant = 'default',
  watermarkAvailable,
}: HandoffOptions & {
  variant?: ComponentProps<typeof Button>['variant'];
}) {
  const watermark = useWatermarkSelection();
  const copy = useI18n().messages.browserCompanion;
  const label = busy
    ? copy.uploading
    : watermarkAvailable
      ? `${copy.upload} · ${watermark.selection.kind === 'NONE' ? copy.noWatermark : copy.watermark}`
      : copy.upload;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-action="content-upload"
          variant={variant}
          size="sm"
          disabled={busy || disabled || targets.length === 0}
          aria-busy={busy || undefined}
        >
          {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CloudUploadIcon className="size-4" />}
          {label}
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <CompanionHandoffItems
          busy={busy}
          onHandoff={onHandoff}
          targets={targets}
          watermarkAvailable={watermarkAvailable}
          watermark={watermark}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
