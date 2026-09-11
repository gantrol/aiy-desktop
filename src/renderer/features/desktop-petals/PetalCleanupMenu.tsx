import { useRef, useState } from 'react';
import { BrushCleaning } from 'lucide-react';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { PetalColorPicker } from '@/renderer/features/desktop-petals/PetalColorPicker';
import { PetalMenuSection } from '@/renderer/features/desktop-petals/PetalMenu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { DEFAULT_PETAL_COLOR, type PetalColor } from '@/shared/contracts/petal-appearance';

/** Selecting a color only changes the filter; cleanup remains an explicit menu action. */
export function PetalCleanupMenu({
  disabled = false,
  close,
  onError,
}: {
  disabled?: boolean;
  close?: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const [color, setColor] = useState<PetalColor>(DEFAULT_PETAL_COLOR);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const blocked = disabled || busy;
  const cleanup = async () => {
    if (disabled || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await close?.();
      await window.desktopPetals.cleanup(color);
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <PetalMenuSection icon={BrushCleaning} label={copy.cleanup.title} disabled={blocked} hoverOpen>
      <PetalColorPicker value={color} onChange={setColor} disabled={blocked} />
      <DropdownMenuItem
        disabled={blocked}
        className="mt-1 whitespace-normal"
        onSelect={(event) => {
          if (close) event.preventDefault();
          void cleanup();
        }}
      >
        <BrushCleaning className="size-4 shrink-0" />
        {copy.cleanup.action.replace('{color}', copy.appearance.color[color])}
      </DropdownMenuItem>
    </PetalMenuSection>
  );
}
