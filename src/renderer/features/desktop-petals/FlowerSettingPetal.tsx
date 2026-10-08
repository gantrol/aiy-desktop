import type { CSSProperties, ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { PetalShape } from '@/renderer/features/desktop-petals/PetalShape';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import '@/renderer/features/desktop-petals/FlowerSettingPetal.css';

/** Finish the return motion before the native host shrinks around the flower. */
export async function foldFlowerSettingPetals(root: HTMLElement | null) {
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  await Promise.allSettled(
    Array.from(root.querySelectorAll<HTMLButtonElement>('.flower-setting-petal'), (petal) => {
      const style = getComputedStyle(petal);
      return petal.animate(
        [
          { opacity: style.opacity, transform: style.transform },
          {
            opacity: 0,
            transform: `translate(${style.getPropertyValue('--petal-from-x')}, ${style.getPropertyValue('--petal-from-y')}) scale(0.3)`,
          },
        ],
        { duration: 180, easing: 'ease-in', fill: 'forwards' },
      ).finished;
    }),
  );
}

export function FlowerSettingPetal({
  label,
  icon,
  selected,
  disabled,
  onClick,
  delay,
  travel,
}: {
  label: string;
  icon: ReactNode;
  selected: boolean;
  disabled: boolean;
  onClick(): void;
  delay: number;
  travel: { x: number; y: number };
}) {
  return (
    <Button
      variant="ghost"
      className="flower-setting-petal h-auto min-h-24 w-full flex-col gap-0 rounded-sm p-0 text-[var(--petal-ink)] hover:bg-transparent hover:brightness-95 [&_svg]:shrink-0"
      style={
        {
          ...appearanceStyle('rose'),
          '--petal-from-x': `${travel.x}px`,
          '--petal-from-y': `${travel.y}px`,
          animationDelay: `${delay}ms`,
        } as CSSProperties
      }
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={`relative block h-[82px] w-[66px] ${selected ? 'brightness-90' : ''}`}>
        <PetalShape />
        <span className="absolute left-1/2 top-[36%] -translate-x-1/2 [&_svg]:size-4">{icon}</span>
      </span>
      <span className="max-w-full px-1 text-xs leading-4 whitespace-normal">{label}</span>
    </Button>
  );
}
