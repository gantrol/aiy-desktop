import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** One tab stop; menus retain their own keyboard navigation, including when portalled. */
export function ContentToolbar({ label, children }: { label: string; children(narrow: boolean): ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLButtonElement | null>(null);
  const [narrow, setNarrow] = useState(true);
  const buttons = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const select = (button: HTMLButtonElement | null) => {
    active.current = button;
    for (const candidate of buttons()) candidate.tabIndex = candidate === button ? 0 : -1;
  };

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 440));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const candidates = buttons();
    select(active.current && candidates.includes(active.current) ? active.current : (candidates[0] ?? null));
  });

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className="flex min-h-9 min-w-0 flex-wrap items-center gap-0.5 border-b bg-background px-1.5 py-0.5"
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
      {children(narrow)}
    </div>
  );
}
