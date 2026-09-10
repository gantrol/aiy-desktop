import { MousePointer2 } from 'lucide-react';
import type { Point } from '@/renderer/features/extensions/feature-demo/v050/demoProjection';

export function DemoPointer({
  scene,
}: {
  scene: { cursor: Point; cursorVisible: boolean; pressed: boolean; pulse: boolean };
}) {
  if (!scene.cursorVisible) return null;
  return (
    <div className="pointer-events-none absolute" style={{ left: scene.cursor[0], top: scene.cursor[1] }}>
      {scene.pulse && <span className="absolute -left-3 -top-3 size-8 rounded-full border-2 border-media-surround" />}
      <MousePointer2
        className={`size-9 text-media-surround-dark ${scene.pressed ? 'fill-selected' : 'fill-media-checker-a'}`}
      />
    </div>
  );
}
