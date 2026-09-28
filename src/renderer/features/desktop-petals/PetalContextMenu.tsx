import type { ReactNode } from 'react';
import { usePetalMenu } from '@/renderer/features/desktop-petals/use-petal-menu';
import { PetalMenuWindow } from '@/renderer/features/desktop-petals/PetalMenuWindow';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';

export function PetalContextMenu({
  snapshot,
  onError,
  children,
}: {
  snapshot: DesktopPetalSnapshot;
  onError(error: unknown): void;
  children: ReactNode;
}) {
  const menu = usePetalMenu(snapshot.hubView === 'flower', onError);
  return (
    <div className="contents" {...menu.contextHandlers}>
      {children}
      <PetalMenuWindow surface={menu.surface} control={menu} menu={{ kind: 'hub', snapshot, onError }} />
    </div>
  );
}
