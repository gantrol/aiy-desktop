import type { RefObject, MouseEvent } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Bookmark } from 'lucide-react';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import { PETAL_DRAWER, type PetalDrawerFrame } from '@/shared/contracts/petal-drawer';
import type { useDrawerPull } from '@/renderer/features/desktop-petals/use-drawer-pull';

export function PetalDrawerHandle({
  name,
  count,
  frame,
  handle,
  handlers,
  onContextMenu,
}: {
  name: string;
  count: number;
  frame: PetalDrawerFrame;
  handle: RefObject<HTMLButtonElement | null>;
  handlers: ReturnType<typeof useDrawerPull>;
  onContextMenu(event: MouseEvent): void;
}) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.drawer;
  const title = name || copy.title;
  return (
    <Button
      ref={handle}
      type="button"
      variant="ghost"
      aria-label={`${title} · ${copy.count.replace('{count}', String(count))}`}
      aria-expanded={frame.progress === 1}
      title={title}
      className="absolute flex-col justify-start gap-0 rounded-none bg-transparent p-0 shadow-none hover:bg-transparent active:bg-transparent cursor-grab active:cursor-grabbing text-[var(--petal-ink)]"
      style={{
        ...appearanceStyle('cream'),
        left: frame.handleX,
        top: frame.handleY,
        width: PETAL_DRAWER.handle,
        height: PETAL_DRAWER.handleHeight,
      }}
      {...handlers}
      onContextMenu={onContextMenu}
    >
      <svg viewBox="0 0 80 152" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
        <path
          d="M10 4H70Q74 4 74 8V146L40 126L6 146V8Q6 4 10 4Z"
          fill="var(--petal-surface)"
          stroke="var(--petal-edge)"
          strokeOpacity=".55"
        />
      </svg>
      <Bookmark aria-hidden="true" className="pointer-events-none relative mt-6 size-[18px] shrink-0 stroke-[1.4]" />
      <span
        aria-hidden="true"
        className="pointer-events-none relative mt-4 line-clamp-2 w-16 whitespace-normal break-words px-1 text-center text-xs font-medium leading-5"
      >
        {title}
      </span>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-[101px] text-center text-[10px] font-normal tabular-nums opacity-60"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Button>
  );
}
