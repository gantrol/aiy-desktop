import { useMemo } from 'react';
import { PetalHubMenu } from '@/renderer/features/desktop-petals/PetalHubMenu';
import type { PetalMenuControl } from '@/renderer/features/desktop-petals/petal-menu-api';
import { demoCues, demoMenuAt } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import { demoFlowerCenter } from '@/renderer/features/extensions/feature-demo/v050/demoDesktopScene';
import { demoAsyncNoop, demoNoop } from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
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
  notify(message: DemoWindowDetail): void;
}

const [menuX, menuY] = demoFlowerCenter(demoCues.menuOpen);
// The timeline owns the menu; native overlay windows cannot run inside the demo subframe.
const demoMenu = {
  anchor: { x: menuX, y: menuY },
  close: demoAsyncNoop,
  dismiss: demoNoop,
  select: demoNoop,
  restoreFocus: demoNoop,
} satisfies PetalMenuControl;

export function DemoWorkspaceWindow({ time, snapshot, notify }: Props) {
  const menuOpen = demoMenuAt(time);
  const gif = time >= demoCues.gifWorkspace;
  const motionReady = useDemoSmileMedia(gif, notify);
  const fail = useMemo(() => () => notify({ type: 'failed' }), [notify]);
  useDemoWorkspaceTargets(time, notify);
  return (
    <>
      {menuOpen && <PetalHubMenu snapshot={snapshot} onError={fail} menu={demoMenu} />}
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
