import { Search, X } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { screenMagnifierRunning, type ScreenMagnifierState } from '@/shared/contracts/screen-magnifier';

export function MagnifierCenter({ state, scale }: { state?: ScreenMagnifierState; scale: number }) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.magnifier;
  const running = screenMagnifierRunning(state);
  return (
    <span className="pointer-events-none flex size-full flex-col items-center justify-center gap-0.5 text-[10px] leading-none">
      {running ? <X className="size-4" /> : <Search className="size-4" />}
      <span>{running ? copy.close : `${scale}×`}</span>
    </span>
  );
}
