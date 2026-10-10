import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { PetalWindowToolsMenu } from '@/renderer/features/desktop-petals/PetalWindowToolsMenu';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { PetalNoteIcon } from '@/renderer/features/desktop-petals/petal-appearance';
import { PetalNoteMenu, type PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { useI18n } from '@/renderer/i18n/useI18n';

export function PetalNoteOperations({ compact = false, ...actions }: PetalNoteMenuActions & { compact?: boolean }) {
  const copy = useI18n().messages.desktopPetals;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (actions.disabled) setOpen(false);
  }, [actions.disabled]);
  return (
    <PetalNoteMenu
      {...actions}
      showAppearance={false}
      showWindowControls={false}
      windowTools={
        compact ? <PetalWindowToolsMenu disabled={Boolean(actions.disabled)} onError={actions.onError} /> : undefined
      }
      open={open}
      onOpenChange={setOpen}
      close={async () => setOpen(false)}
      align="start"
      trigger={
        <PetalIconButton
          label={copy.actions.noteActions}
          disabled={actions.disabled}
          className="[-webkit-app-region:no-drag]"
        >
          {compact ? <MoreHorizontal /> : <PetalNoteIcon icon={actions.note.icon} />}
        </PetalIconButton>
      }
    />
  );
}
