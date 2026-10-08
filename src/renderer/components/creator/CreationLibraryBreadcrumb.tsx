import { ChevronDownIcon, ChevronRightIcon, EllipsisIcon, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  creationLibraryPathConnectionShape,
  type CreationLibraryPathConnection,
} from '@/renderer/components/creator/creationLibraryStickyConnection';

export const CREATION_LIBRARY_PATH_HEIGHT = 36;

export interface CreationLibraryPathEntry {
  id: string;
  title: string;
  icon: LucideIcon;
  openLabel: string;
  collapseLabel: string;
  selected?: boolean;
  dropTarget?: {
    active: boolean;
    handlers: Pick<ComponentProps<'div'>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  };
  onOpen(): void;
  onCollapse(): void;
}

function AncestorsMenu({ entries }: { entries: readonly CreationLibraryPathEntry[] }) {
  const labels = useI18n().messages.creator.results;
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="size-7 rounded-sm p-0"
          aria-label={labels.hiddenAncestors}
          title={labels.hiddenAncestors}
          onDragEnter={() => setOpen(true)}
        >
          <EllipsisIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {entries.map((entry) => (
          <DropdownMenuSub key={entry.id}>
            <DropdownMenuSubTrigger
              {...entry.dropTarget?.handlers}
              onDrop={(event) => {
                entry.dropTarget?.handlers.onDrop?.(event);
                setOpen(false);
              }}
              className={cn('max-w-72', entry.dropTarget?.active && 'bg-accent ring-1 ring-inset ring-ring')}
            >
              <entry.icon className="size-3.5" />
              <span className="truncate" title={entry.title}>
                {entry.title}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-creation-sticky-path-id={entry.id}>
              <DropdownMenuItem onSelect={entry.onOpen}>{entry.openLabel}</DropdownMenuItem>
              <DropdownMenuItem onSelect={entry.onCollapse}>{entry.collapseLabel}</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CreationLibraryBreadcrumb({
  entries,
  connection,
  label,
}: {
  entries: readonly CreationLibraryPathEntry[];
  connection: CreationLibraryPathConnection | null;
  label: string;
}) {
  const labels = useI18n().messages.creator.results;
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLLIElement>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);
  const last = entries.at(-1)!;
  const hidden = Math.min(hiddenCount, entries.length - 1);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const fit = () => {
      const widths = [...measure.children].map((child) => child.getBoundingClientRect().width);
      // Reserve padding and the last branch's independent collapse button.
      const available = nav.clientWidth - 16 - 28;
      let count = 0;
      let width = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, widths.length - 1) * 12;
      if (width > available && widths.length > 1) {
        width += 28 + 12;
        while (count < widths.length - 1 && width > available) width -= widths[count++] + 12;
      }
      setHiddenCount(count);
    };
    const resize = new ResizeObserver(fit);
    resize.observe(nav);
    resize.observe(measure);
    fit();
    return () => resize.disconnect();
  }, [entries]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const tail = lastRef.current;
    if (!nav || !tail) return;
    const place = () => setStartX(tail.getBoundingClientRect().left - nav.getBoundingClientRect().left);
    const resize = new ResizeObserver(place);
    resize.observe(nav);
    resize.observe(tail);
    place();
    return () => resize.disconnect();
  }, [entries, hidden]);

  return (
    <nav
      ref={navRef}
      aria-label={`${label} · ${labels.browsingPath}`}
      data-creation-sticky-path
      className="absolute inset-x-0 top-0 z-40 bg-surface-sunken px-2"
      style={{ height: CREATION_LIBRARY_PATH_HEIGHT }}
    >
      <div aria-hidden="true" className="pointer-events-none invisible absolute h-0 w-0 overflow-hidden">
        <div ref={measureRef} className="flex w-max whitespace-nowrap text-sm font-normal">
          {entries.map((entry, index) => (
            <span key={entry.id} className="inline-flex items-center gap-1 px-1">
              {index === entries.length - 1 && <entry.icon className="size-3.5 shrink-0" />}
              {entry.title}
            </span>
          ))}
        </div>
      </div>
      <ol className="flex h-7 min-w-0 items-center">
        {hidden > 0 && (
          <li className="flex shrink-0 items-center">
            <AncestorsMenu entries={entries.slice(0, hidden)} />
            <ChevronRightIcon aria-hidden="true" className="size-3 text-muted-foreground" />
          </li>
        )}
        {entries.slice(hidden).map((entry, index) => {
          const terminal = entry.id === last.id;
          return (
            <li
              key={entry.id}
              ref={terminal ? lastRef : undefined}
              data-creation-sticky-path-id={entry.id}
              className={cn('flex min-w-0 items-center', terminal ? 'flex-1' : 'shrink-0')}
            >
              {index > 0 && <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />}
              <div
                {...entry.dropTarget?.handlers}
                className={cn(
                  'min-w-0',
                  terminal && 'flex-1',
                  entry.dropTarget?.active && 'bg-accent ring-1 ring-inset ring-ring',
                )}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={entry.openLabel}
                      aria-current={entry.selected ? 'page' : undefined}
                      title={entry.title}
                      onClick={entry.onOpen}
                      className={cn(
                        'h-7 min-w-0 max-w-full justify-start gap-1 rounded-sm px-1 text-sm font-normal',
                        entry.selected && 'bg-selected text-selected-foreground',
                      )}
                    >
                      {terminal && <entry.icon className="size-3.5 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{entry.title}</span>
                    </Button>
                  </ContextMenuTrigger>
                  <ContextMenuContent data-creation-sticky-path-id={entry.id}>
                    <ContextMenuItem onSelect={entry.onOpen}>{entry.openLabel}</ContextMenuItem>
                    <ContextMenuItem onSelect={entry.onCollapse}>{entry.collapseLabel}</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            </li>
          );
        })}
        <li className="shrink-0" data-creation-sticky-path-id={last.id}>
          <Button
            type="button"
            variant="ghost"
            className="size-7 rounded-sm p-0"
            aria-expanded
            aria-label={`${last.collapseLabel}: ${last.title}`}
            title={`${last.collapseLabel}: ${last.title}`}
            onClick={last.onCollapse}
          >
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </li>
      </ol>
      {connection && startX !== null && (
        <svg
          aria-hidden="true"
          data-creation-sticky-connection
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          fill="none"
        >
          <path
            d={creationLibraryPathConnectionShape(
              startX + (entries.length - hidden > 1 ? 12 : 0),
              connection,
              CREATION_LIBRARY_PATH_HEIGHT,
            )}
            stroke={connection.color}
            strokeWidth={connection.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </nav>
  );
}
