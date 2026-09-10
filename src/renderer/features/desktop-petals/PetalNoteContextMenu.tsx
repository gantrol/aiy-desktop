import type { ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { PetalNoteMenu, type PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { usePetalMenu } from '@/renderer/features/desktop-petals/use-petal-menu';

export function PetalNoteContextMenu({ children, ...actions }: PetalNoteMenuActions & { children: ReactNode }) {
  const menu = usePetalMenu(!actions.disabled, actions.onError);
  return (
    <div className="contents" {...menu.contextHandlers}>
      {children}
      <PetalNoteMenu
        {...actions}
        open={menu.anchor !== null && !actions.disabled}
        onOpenChange={(open) => {
          if (!open) menu.dismiss();
        }}
        close={menu.close}
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          menu.restoreFocus();
        }}
        trigger={
          <Button
            variant="ghost"
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none fixed size-px border-0 p-0 opacity-0"
            style={{ left: menu.anchor?.x ?? 0, top: menu.anchor?.y ?? 0 }}
          />
        }
      />
    </div>
  );
}
