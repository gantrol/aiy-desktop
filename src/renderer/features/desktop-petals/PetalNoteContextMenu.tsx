import type { ReactNode } from 'react';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { usePetalMenu } from '@/renderer/features/desktop-petals/use-petal-menu';
import { PetalMenuWindow } from '@/renderer/features/desktop-petals/PetalMenuWindow';

export function PetalNoteContextMenu({ children, ...actions }: PetalNoteMenuActions & { children: ReactNode }) {
  const menu = usePetalMenu(!actions.disabled, actions.onError);
  return (
    <div className="contents" {...menu.contextHandlers}>
      {children}
      <PetalMenuWindow surface={menu.surface} control={menu} menu={{ kind: 'note', actions }} />
    </div>
  );
}
