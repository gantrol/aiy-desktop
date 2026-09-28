import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';

/** One tab stop; menus retain their own keyboard navigation, including when portalled. */
export function ContentToolbar({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children(narrow: boolean, width: number): ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const [width, setWidth] = useState(0);
  const buttons = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const select = (button: HTMLButtonElement | null) => {
    active.current = button;
    for (const candidate of buttons()) candidate.tabIndex = candidate === button ? 0 : -1;
  };

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      restoreFocus.current = element.contains(document.activeElement);
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const candidates = buttons();
    const previous = active.current;
    const next = previous && candidates.includes(previous) ? previous : (candidates[0] ?? null);
    select(next);
    if (restoreFocus.current && previous !== next) {
      (root.current?.querySelector<HTMLButtonElement>('[data-content-toolbar-more]') ?? next)?.focus();
    }
    restoreFocus.current = false;
  });

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        'flex min-h-9 min-w-0 flex-wrap items-center gap-0.5 border-b bg-background px-1.5 py-0.5',
        className,
      )}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLButtonElement && root.current?.contains(event.target)) select(event.target);
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (!root.current?.contains(event.target as Node) || !(event.target instanceof HTMLButtonElement)) return;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const candidates = buttons();
        const index = candidates.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? candidates.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + candidates.length) % candidates.length;
        candidates[next]?.focus();
      }}
    >
      {children(width < 440, width)}
    </div>
  );
}
