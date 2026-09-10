export function PetalCaption({ title, visible = true }: { title: string; visible?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{ visibility: visible ? 'visible' : 'hidden', height: PETAL_SHAPE_LAYOUT.captionHeight }}
      className="pointer-events-none block w-full shrink-0 truncate rounded-sm bg-[var(--petal-surface)] px-1 text-center text-xs font-medium leading-4 text-[var(--petal-ink)]"
    >
      {title}
    </span>
  );
}
import { PETAL_SHAPE_LAYOUT } from '@/renderer/features/desktop-petals/petal-shape-layout';
