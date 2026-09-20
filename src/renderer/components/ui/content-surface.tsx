import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import './content-surface.css';

interface Props {
  kind: 'paper' | 'media';
  title: string;
  titlesVisible?: boolean;
  tools: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  resize?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/** One content-first shell: paper needs reading space; media must not acquire a paper frame. */
export function ContentSurface({
  kind,
  title,
  titlesVisible = true,
  tools,
  children,
  status,
  resize,
  style,
  className = '',
}: Props) {
  return (
    <section
      className={cn(
        'content-surface group/content-surface relative isolate flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md',
        kind === 'media'
          ? 'bg-[var(--media-surround-dark)] text-[var(--media-checker-a)]'
          : 'bg-[var(--petal-surface,var(--surface))] text-[var(--petal-ink,var(--foreground))]',
        className,
      )}
      data-surface-kind={kind}
      style={style}
      aria-label={title}
    >
      <header
        className={cn(
          'content-surface__chrome flex min-h-10 shrink-0 items-center gap-1 px-2 py-1 select-none',
          kind === 'media' &&
            'pointer-events-none absolute inset-x-0 top-0 z-30 bg-linear-to-b from-[color-mix(in_srgb,var(--media-surround-dark)_85%,transparent)] to-transparent opacity-0 transition-opacity duration-fast group-hover/content-surface:pointer-events-auto group-hover/content-surface:opacity-100 group-focus-within/content-surface:pointer-events-auto group-focus-within/content-surface:opacity-100 group-has-[[data-state=open]]/content-surface:pointer-events-auto group-has-[[data-state=open]]/content-surface:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
        )}
      >
        <span className="content-surface__drag-title min-w-8 flex-1 truncate text-[13px] font-medium" title={title}>
          {kind === 'paper' ? title : ''}
        </span>
        <div className="content-surface__tools flex items-center gap-0.5 [@media(hover:none)]:[&_button]:min-h-9 [@media(hover:none)]:[&_button]:min-w-9">
          {tools}
        </div>
      </header>
      <div
        className={cn(
          'content-surface__body min-h-0 flex-1',
          kind === 'media'
            ? 'relative grid overflow-hidden p-0 [&_img]:block [&_img]:size-full [&_img]:min-h-0 [&_img]:object-contain [&_video]:block [&_video]:size-full [&_video]:min-h-0 [&_video]:object-contain'
            : 'overflow-auto p-4',
        )}
      >
        {children}
      </div>
      {kind === 'media' && titlesVisible && (
        <div className="content-surface__caption pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-[image:var(--image-overlay-copy-scrim)] px-3.5 pt-10 pb-3.5 text-[13px] leading-normal">
          <strong className="block truncate font-medium">{title}</strong>
        </div>
      )}
      {status && (
        <div
          className="content-surface__status relative z-40 bg-surface px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {status}
        </div>
      )}
      {resize}
    </section>
  );
}
