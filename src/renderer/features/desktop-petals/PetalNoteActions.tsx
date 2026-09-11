import { useEffect, useState } from 'react';
import { Ellipsis, Minimize2 } from 'lucide-react';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { PetalNoteMenu, type PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { useI18n } from '@/renderer/i18n/useI18n';

export function PetalNoteActions({
  onCollapse,
  ...actions
}: PetalNoteMenuActions & { onCollapse: () => Promise<void> }) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!actions.disabled) return;
    setOpen(false);
  }, [actions.disabled]);
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <PetalNoteMenu
        {...actions}
        showAppearance={false}
        open={open}
        onOpenChange={setOpen}
        close={async () => setOpen(false)}
        trigger={
          <PetalIconButton label={copy.actions.more} disabled={actions.disabled}>
            <Ellipsis />
          </PetalIconButton>
        }
      />
      <PetalIconButton
        label={copy.note.collapse}
        disabled={actions.disabled || open}
        onClick={() => void onCollapse().catch(actions.onError)}
      >
        <Minimize2 />
      </PetalIconButton>
    </div>
  );
}
