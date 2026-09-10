import { Check } from 'lucide-react';
import type { PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import {
  appearanceStyle,
  petalColors,
  petalIcons,
  PetalNoteIcon,
} from '@/renderer/features/desktop-petals/petal-appearance';
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
      <div className="flex flex-wrap" role="group" aria-label={copy.colors}>
        {(Object.keys(petalColors) as PetalColor[]).map((color) => (
          <DropdownMenuItem
            key={color}
            asChild
            role="menuitemradio"
            aria-checked={note.color === color}
            disabled={disabled}
            textValue={copy.color[color]}
            className="min-h-7 justify-center p-1"
            onSelect={(event) => {
              event.preventDefault();
              onChange({ color });
            }}
          >
            <PetalIconButton label={copy.color[color]} disabled={disabled} style={appearanceStyle(color)}>
              <span className="grid size-4 place-items-center rounded-full border border-[var(--petal-edge)] bg-[var(--petal-surface)] text-[var(--petal-ink)]">
                {note.color === color && <Check className="size-3" />}
              </span>
            </PetalIconButton>
          </DropdownMenuItem>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(36px,1fr))] gap-1" role="group" aria-label={copy.icons}>
        {(Object.keys(petalIcons) as PetalIcon[]).map((icon) => (
          <DropdownMenuItem
            key={icon}
            asChild
            role="menuitemradio"
            aria-checked={note.icon === icon}
            disabled={disabled}
            textValue={copy.icon[icon]}
            className="min-h-7 justify-center p-1"
            onSelect={(event) => {
              event.preventDefault();
              onChange({ icon });
            }}
          >
            <PetalIconButton
              label={copy.icon[icon]}
              disabled={disabled}
              className={`relative ${note.icon === icon ? 'bg-selected' : ''}`}
            >
              <PetalNoteIcon icon={icon} />
              {note.icon === icon && <Check className="absolute -right-0.5 -top-0.5 size-2.5!" />}
            </PetalIconButton>
          </DropdownMenuItem>
        ))}
      </div>
    </div>
  );
}
