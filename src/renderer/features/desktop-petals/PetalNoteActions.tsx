import { useRef, useState } from 'react';
import { Minimize2, Pin, PinOff } from 'lucide-react';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { useI18n } from '@/renderer/i18n/useI18n';

/** Frequent window actions remain one click away. */
export function PetalNoteActions({ onCollapse, ...actions }: PetalNoteMenuActions & { onCollapse(): Promise<void> }) {
  const copy = useI18n().messages.desktopPetals;
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const pin = async () => {
    if (actions.disabled || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await window.desktopPetals.setAlwaysOnTop(!actions.alwaysOnTop);
    } catch (reason) {
      actions.onError(reason);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <PetalIconButton
        label={actions.alwaysOnTop ? copy.actions.pauseAlwaysOnTop : copy.actions.resumeAlwaysOnTop}
        aria-pressed={actions.alwaysOnTop}
        disabled={actions.disabled || busy}
        onClick={() => void pin()}
      >
        {actions.alwaysOnTop ? <Pin /> : <PinOff />}
      </PetalIconButton>
      <PetalIconButton
        label={copy.note.collapse}
        disabled={actions.disabled || busy}
        onClick={() => void onCollapse().catch(actions.onError)}
      >
        <Minimize2 />
      </PetalIconButton>
    </div>
  );
}
