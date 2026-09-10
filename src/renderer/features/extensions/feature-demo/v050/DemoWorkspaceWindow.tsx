import { useEffect, useMemo } from 'react';
import { PetalContextMenu } from '@/renderer/features/desktop-petals/PetalContextMenu';
import { demoCues, demoMenuAt } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import { useDemoWorkspaceTargets } from '@/renderer/features/extensions/feature-demo/v050/useDemoWorkspaceTargets';
import { DemoCreationShell } from '@/renderer/features/extensions/feature-demo/v050/DemoCreationShell';
import { DemoCreationInput } from '@/renderer/features/extensions/feature-demo/v050/DemoCreationInput';
import { DemoCreationOutput } from '@/renderer/features/extensions/feature-demo/v050/DemoCreationOutput';
import { DemoGifEntry } from '@/renderer/features/extensions/feature-demo/v050/DemoGifEntry';
import { useDemoSmileMedia } from '@/renderer/features/extensions/feature-demo/v050/useDemoSmileMedia';
import { demoWorkspaceLayout } from '@/renderer/features/extensions/feature-demo/v050/demoWorkspaceScene';
import type { DemoWindowDetail } from '@/renderer/features/extensions/feature-demo/v050/demoProtocol';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';

interface Props {
  time: number;
  snapshot: DesktopPetalSnapshot;
  requestMenu(): void;
  notify(message: DemoWindowDetail): void;
}

export function DemoWorkspaceWindow({ time, snapshot, requestMenu, notify }: Props) {
  const menuOpen = demoMenuAt(time);
  const gif = time >= demoCues.gifWorkspace;
  const motionReady = useDemoSmileMedia(gif, notify);
  const fail = useMemo(() => () => notify({ type: 'failed' }), [notify]);
  useDemoWorkspaceTargets(time, notify);
  useEffect(() => {
    if (menuOpen) requestMenu();
  }, [menuOpen, requestMenu]);

  return (
    <>
      {menuOpen && (
        <PetalContextMenu snapshot={snapshot} onError={fail}>
          <span />
        </PetalContextMenu>
      )}
      <div className="absolute inset-0" style={{ visibility: time >= demoCues.workspace ? 'visible' : 'hidden' }}>
        <DemoCreationShell gif={gif}>
          <div className="relative min-h-0 min-w-0">
            <div
              className="grid size-full min-h-0"
              style={{
                gridTemplateColumns: `${demoWorkspaceLayout.input}px ${demoWorkspaceLayout.output}px`,
                visibility: gif ? 'hidden' : 'inherit',
              }}
            >
              <DemoCreationInput time={time} onError={fail} />
              <DemoCreationOutput time={time} onError={fail} />
            </div>
            <div className="absolute inset-0" style={{ visibility: gif ? 'inherit' : 'hidden' }}>
              <DemoGifEntry time={time} mediaReady={motionReady} onError={fail} />
            </div>
          </div>
        </DemoCreationShell>
      </div>
    </>
  );
}
