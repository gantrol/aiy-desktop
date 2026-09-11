import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuTrigger } from '@/renderer/components/ui/dropdown-menu';
import { NoteAppearancePicker } from '@/renderer/features/desktop-petals/NoteAppearancePicker';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { PetalMenuContent } from '@/renderer/features/desktop-petals/PetalMenu';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { noteAppearanceStyle, PetalNoteIcon } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';

export function NoteAppearanceMenu({
  note,
  disabled = false,
  onAppearance,
  onError,
}: Pick<PetalNoteMenuActions, 'note' | 'disabled' | 'onAppearance' | 'onError'>) {
  const copy = useI18n().messages.desktopPetals;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const change = async (patch: Parameters<typeof onAppearance>[0]) => {
    if (disabled || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await onAppearance(patch);
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <DropdownMenu open={open && !disabled} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <PetalIconButton
          label={copy.actions.appearance}
          disabled={disabled}
          className="cursor-default text-muted-foreground hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground [-webkit-app-region:no-drag]"
        >
          <PetalNoteIcon icon={note.icon} />
        </PetalIconButton>
      </DropdownMenuTrigger>
      <PetalMenuContent
        align="start"
        side="bottom"
        aria-label={copy.actions.appearance}
        style={noteAppearanceStyle(note.color)}
        className="p-2 [-webkit-app-region:no-drag]"
      >
        <NoteAppearancePicker note={note} disabled={disabled || busy} onChange={(patch) => void change(patch)} />
      </PetalMenuContent>
    </DropdownMenu>
  );
}
