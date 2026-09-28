import { PetalShape } from '@/renderer/features/desktop-petals/PetalShape';
import { PetalCaption } from '@/renderer/features/desktop-petals/PetalCaption';
import { PETAL_SHAPE_LAYOUT, PETAL_SHAPE_ANCHOR } from '@/renderer/features/desktop-petals/petal-shape-layout';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';

export function DetachedPetal({ x, y, opacity, moving }: { x: number; y: number; opacity: number; moving: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute flex flex-col items-center justify-center ease-out motion-reduce:duration-0 ${moving ? '' : 'transition-[left,top,opacity] duration-180'}`}
      aria-hidden="true"
      style={{
        ...appearanceStyle('rose'),
        left: x - PETAL_SHAPE_ANCHOR.x,
        top: y - PETAL_SHAPE_ANCHOR.y,
        ...PETAL_WINDOW_SIZES.collapsed,
        opacity,
      }}
    >
      <span className="block shrink-0" style={{ width: PETAL_SHAPE_LAYOUT.width, height: PETAL_SHAPE_LAYOUT.height }}>
        <PetalShape icon="feather" />
      </span>
      <PetalCaption title="" visible={false} />
    </div>
  );
}
