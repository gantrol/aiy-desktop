import type { PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { petalIcons, PetalNoteIcon } from '@/renderer/features/desktop-petals/petal-appearance';
import { PetalColorPicker } from '@/renderer/features/desktop-petals/PetalColorPicker';
import { useI18n } from '@/renderer/i18n/useI18n';
export function NoteAppearancePicker({
  note,
  onChange,
  disabled = false,
}: {
  note: { color: PetalColor; icon: PetalIcon };
  onChange: (patch: { color?: PetalColor; icon?: PetalIcon }) => void;
  disabled?: boolean;
}) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.appearance;
  return (
    <div className="space-y-2">
      <PetalColorPicker value={note.color} disabled={disabled} onChange={(color) => onChange({ color })} />
      <div className="grid grid-cols-4 gap-1 border-t border-border pt-2" role="group" aria-label={copy.icons}>
        {(Object.keys(petalIcons) as PetalIcon[]).map((icon) => (
          <DropdownMenuItem
            key={icon}
            asChild
            role="menuitemradio"
            aria-checked={note.icon === icon}
            disabled={disabled}
            textValue={copy.icon[icon]}
            className="h-8 w-full min-w-0 justify-center p-1"
            onSelect={(event) => {
              event.preventDefault();
              if (note.icon !== icon) onChange({ icon });
            }}
          >
            <PetalIconButton
              label={copy.icon[icon]}
              disabled={disabled}
              className={
                note.icon === icon
                  ? 'bg-selected text-selected-foreground ring-1 ring-inset ring-current/40 hover:bg-selected data-[highlighted]:bg-selected'
                  : 'text-muted-foreground'
              }
            >
              <PetalNoteIcon icon={icon} />
            </PetalIconButton>
          </DropdownMenuItem>
        ))}
      </div>
    </div>
  );
}
