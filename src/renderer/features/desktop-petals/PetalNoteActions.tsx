import { useEffect, useState } from 'react';
import { Ellipsis, Minimize2 } from 'lucide-react';
import { useHoverIntent } from '@/renderer/components/ui/use-hover-intent';
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
  const hover = useHoverIntent();
  const changeOpen = (value: boolean) => {
    hover.cancel();
    setOpen(value);
  };
  useEffect(() => {
    if (!actions.disabled) return;
    hover.cancel();
    setOpen(false);
  }, [actions.disabled, hover]);
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      {/* React pointer events keep the trigger and portalled panels in one hover region. */}
      <span
        className="contents"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return;
          hover.cancel();
          if (!open) hover.schedule(() => setOpen(true), !actions.disabled);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse') return;
          hover.cancel();
          if (open) hover.schedule(() => setOpen(false));
        }}
        onPointerDownCapture={hover.cancel}
        onKeyDownCapture={hover.cancel}
      >
        <PetalNoteMenu
          {...actions}
          open={open}
          onOpenChange={changeOpen}
          close={async () => changeOpen(false)}
          trigger={
            <PetalIconButton label={copy.actions.more} disabled={actions.disabled}>
              <Ellipsis />
            </PetalIconButton>
          }
        />
      </span>
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
