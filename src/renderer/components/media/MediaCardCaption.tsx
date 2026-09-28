import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';
import './MediaCardCaption.css';

/** Keep image copy inside the media frame with the dictionary gallery's contrast treatment. */
export function MediaCardCaption({ children, className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      {...props}
      className={cn(
        'media-card-caption pointer-events-none absolute inset-x-0 bottom-0 z-20 isolate flex min-w-0 flex-col gap-1 whitespace-normal px-3 py-2.5 text-left text-media-checker-a transition-[opacity,translate] duration-overlay ease-enter motion-reduce:transition-none motion-reduce:translate-none',
        className,
      )}
    >
      <span
        data-image-overlay-copy-scrim
        aria-hidden="true"
        className="absolute inset-x-0 -top-5 bottom-0 -z-10 [background:var(--image-overlay-copy-scrim)]"
      />
      {children}
    </span>
  );
}
