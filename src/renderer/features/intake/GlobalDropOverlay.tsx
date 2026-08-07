import { ImagesIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';

interface Props {
  active: boolean;
  label: string;
  className?: string;
}

/** Shared E3 drop target, mounted only while a supported drag is active. */
export function GlobalDropOverlay({ active, label, className }: Props) {
  if (!active) return null;

  return (
    <div
      data-slot="global-drop-overlay"
      className={cn(
        'pointer-events-none absolute inset-0 z-40 grid place-items-center bg-background/80 p-4 backdrop-blur-sm',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="grid justify-items-center gap-2 rounded-xl border bg-overlay px-5 py-4 text-sm font-medium shadow-overlay">
        <ImagesIcon className="size-7" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}
