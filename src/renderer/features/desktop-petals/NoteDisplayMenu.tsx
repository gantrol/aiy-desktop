import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Minus, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from '@/renderer/components/ui/dropdown-menu';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { PetalMenuContent } from '@/renderer/features/desktop-petals/PetalMenu';
import { NoteAppearancePicker } from '@/renderer/features/desktop-petals/NoteAppearancePicker';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { stepPetalContentScale, PETAL_NOTE_SIZE_PRESETS } from '@/shared/petal-display';
import { PetalWindowToolsMenu } from '@/renderer/features/desktop-petals/PetalWindowToolsMenu';

export function NoteDisplayMenu({
  scale,
  actions,
  fullWindow,
  onFullWindowChange,
  applicationsVisible,
  onApplicationsChange,
}: {
  scale?: number;
  actions: PetalNoteMenuActions;
  fullWindow?: boolean;
  onFullWindowChange?(value: boolean): void;
  applicationsVisible?: boolean;
  onApplicationsChange?(value: boolean): void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const disabled = actions.disabled || busy;
  useEffect(() => {
    if (actions.disabled) setOpen(false);
  }, [actions.disabled]);
  const change = async (action: () => Promise<void>) => {
    if (actions.disabled || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      actions.onError(reason);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <PetalIconButton
          label={copy.display.settings}
          disabled={actions.disabled}
          className="[-webkit-app-region:no-drag]"
        >
          <SlidersHorizontal />
        </PetalIconButton>
      </DropdownMenuTrigger>
      <PetalMenuContent
        align="end"
        aria-label={copy.display.settings}
        className="w-56 max-w-[calc(100vw-24px)] [-webkit-app-region:no-drag]"
      >
        <DropdownMenuLabel>{copy.display.window}</DropdownMenuLabel>
        <div className="grid grid-cols-3 gap-1 px-1">
          {Object.entries(PETAL_NOTE_SIZE_PRESETS).map(([name, size]) => (
            <DropdownMenuItem
              key={name}
              className="justify-center"
              disabled={disabled}
              title={`${size.width} × ${size.height}`}
              onSelect={(event) => {
                event.preventDefault();
                void change(() => window.desktopPetals.resize(size));
              }}
            >
              {copy.display[name as keyof typeof PETAL_NOTE_SIZE_PRESETS]}
            </DropdownMenuItem>
          ))}
        </div>
        {scale !== undefined && (
          <>
            <DropdownMenuLabel>{copy.display.content}</DropdownMenuLabel>
            <div className="grid grid-cols-[auto_1fr_auto] gap-1 px-1">
              <DropdownMenuItem
                aria-label={copy.display.zoomOut}
                title={copy.display.zoomOut}
                disabled={disabled || stepPetalContentScale(scale, -1) === scale}
                onSelect={(event) => {
                  event.preventDefault();
                  void change(() => window.desktopPetals.setContentScale(stepPetalContentScale(scale, -1)));
                }}
              >
                <Minus />
              </DropdownMenuItem>
              <DropdownMenuItem
                className="justify-center tabular-nums"
                title={copy.display.resetZoom}
                aria-label={`${copy.display.content} · ${Math.round(scale * 100)}% · ${copy.display.resetZoom}`}
                disabled={disabled || scale === 1}
                onSelect={(event) => {
                  event.preventDefault();
                  void change(() => window.desktopPetals.setContentScale(1));
                }}
              >
                {Math.round(scale * 100)}%
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={copy.display.zoomIn}
                title={copy.display.zoomIn}
                disabled={disabled || stepPetalContentScale(scale, 1) === scale}
                onSelect={(event) => {
                  event.preventDefault();
                  void change(() => window.desktopPetals.setContentScale(stepPetalContentScale(scale, 1)));
                }}
              >
                <Plus />
              </DropdownMenuItem>
            </div>
          </>
        )}
        <DropdownMenuSeparator />
        <div className="p-1">
          <NoteAppearancePicker
            note={actions.note}
            disabled={disabled}
            onChange={(patch) => void change(() => actions.onAppearance(patch))}
          />
        </div>
        {onFullWindowChange && (
          <DropdownMenuCheckboxItem checked={fullWindow} disabled={disabled} onCheckedChange={onFullWindowChange}>
            {fullWindow ? copy.display.exitFullWindow : copy.display.fullWindow}
          </DropdownMenuCheckboxItem>
        )}
        {onApplicationsChange && (
          <DropdownMenuCheckboxItem
            checked={applicationsVisible}
            disabled={disabled}
            onCheckedChange={onApplicationsChange}
          >
            {copy.externalApplications.show}
          </DropdownMenuCheckboxItem>
        )}
        <PetalWindowToolsMenu disabled={disabled} onError={actions.onError} />
      </PetalMenuContent>
    </DropdownMenu>
  );
}
