import { Check } from 'lucide-react';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalColorSchema, type PetalColor } from '@/shared/contracts/petal-appearance';

export function PetalColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PetalColor;
  onChange: (color: PetalColor) => void;
  disabled?: boolean;
}) {
  const copy = useI18n().messages.desktopPetals.appearance;
  return (
    <div className="grid grid-cols-6 gap-0.5" role="group" aria-label={copy.colors}>
      {petalColorSchema.options.map((color) => (
        <DropdownMenuItem
          key={color}
          asChild
          role="menuitemradio"
          aria-checked={value === color}
          disabled={disabled}
          textValue={copy.color[color]}
          className="min-h-7 justify-center p-1"
          onSelect={(event) => {
            event.preventDefault();
            onChange(color);
          }}
        >
          <PetalIconButton label={copy.color[color]} disabled={disabled} style={appearanceStyle(color)}>
            <span className="grid size-4 place-items-center rounded-full border border-[var(--petal-edge)] bg-[var(--petal-surface)] text-[var(--petal-ink)]">
              {value === color && <Check className="size-3" />}
            </span>
          </PetalIconButton>
        </DropdownMenuItem>
      ))}
    </div>
  );
}
