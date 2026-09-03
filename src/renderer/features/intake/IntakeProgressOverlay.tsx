import { LoaderCircleIcon } from 'lucide-react';

interface Props {
  active: boolean;
  label: string;
}

/** Non-modal feedback while image intake work continues in the foreground. */
export function IntakeProgressOverlay({ active, label }: Props) {
  if (!active) return null;

  return (
    <div
      data-slot="intake-progress-overlay"
      className="pointer-events-none absolute right-4 top-16 z-40 max-w-[min(22rem,calc(100%-2rem))]"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex items-center gap-2 rounded-xl border bg-overlay/95 px-4 py-3 text-sm font-medium shadow-overlay backdrop-blur-sm">
        <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}
