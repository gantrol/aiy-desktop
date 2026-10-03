import { ChevronDownIcon, type LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';

const rowHeight = 28;
const maximumRows = 4;

interface Branch {
  id: string;
  element: HTMLDivElement;
  open: boolean;
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

interface MeasuredBranch {
  branch: Branch;
  top: number;
  rowBottom: number;
  bottom: number;
  left: number;
}

interface PinnedBranch {
  branch: Branch;
  left: number;
}

const BranchContext = createContext<((branch: Branch | null, id: string) => void) | null>(null);

function rowLimit(viewport: HTMLDivElement) {
  return Math.max(0, Math.min(maximumRows, Math.floor(viewport.clientHeight / (rowHeight * 3))));
}

/** Reserve room for the target's ancestors before revealing a newly selected row. */
export function creationLibraryStickyInset(viewport: HTMLDivElement, target: HTMLElement) {
  let count = 0;
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== viewport) {
    if (
      ancestor.hasAttribute('data-creation-sticky-branch') &&
      ancestor.dataset.treeBranchId !== target.dataset.treeNodeId &&
      ancestor.dataset.state === 'open'
    )
      count++;
    ancestor = ancestor.parentElement;
  }
  return Math.min(count, rowLimit(viewport)) * rowHeight;
}

function measureBranches(viewport: HTMLDivElement, branches: Iterable<Branch>): MeasuredBranch[] {
  const bounds = viewport.getBoundingClientRect();
  const measured: MeasuredBranch[] = [];
  for (const branch of branches) {
    if (!branch.open || branch.element.parentElement?.closest('[data-tree-branch-id][data-state="closed"]')) continue;
    const rect = branch.element.getBoundingClientRect();
    if (!rect.height) continue;
    const row = branch.element.querySelector<HTMLElement>('[data-tree-node-id]');
    if (!row) continue;
    measured.push({
      branch,
      top: rect.top - bounds.top + viewport.scrollTop,
      rowBottom: row.getBoundingClientRect().bottom - bounds.top + viewport.scrollTop,
      bottom: rect.bottom - bounds.top + viewport.scrollTop,
      left: Math.max(8, Math.min(rect.left - bounds.left, viewport.clientWidth - 120)),
    });
  }
  return measured.sort((first, second) => first.top - second.top);
}

function pinnedBranches(viewport: HTMLDivElement, measured: readonly MeasuredBranch[]): PinnedBranch[] {
  const limit = rowLimit(viewport);
  if (!limit) return [];
  const path: MeasuredBranch[] = [];
  for (const entry of measured) {
    const last = path.at(-1);
    if (last && !last.branch.element.contains(entry.branch.element)) continue;
    const top = viewport.scrollTop + Math.min(path.length, limit - 1) * rowHeight;
    // Wait until the compact replacement covers the source row's remaining area.
    if (entry.top >= top || entry.rowBottom > top + rowHeight || entry.bottom <= top + rowHeight) continue;
    path.push(entry);
  }
  // Keep the nearest ancestors when a deep tree would crowd out the content.
  return path.slice(-limit).map(({ branch, left }) => ({ branch, left }));
}

function restoreCollapsedBranch(viewport: HTMLDivElement, branch: Branch) {
  const row = branch.element.querySelector<HTMLElement>('[data-tree-node-id]');
  if (!row) return;
  // A shortened path may reveal another ancestor when this entry disappears.
  // Reserve the new ancestor stack, rather than reusing this entry's old slot.
  const inset = creationLibraryStickyInset(viewport, row);
  viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - inset;
  const focused = document.activeElement?.closest<HTMLElement>('[data-creation-sticky-path-id]');
  if (focused?.dataset.creationStickyPathId === branch.id) {
    row.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
}

function useStickyBranches(viewportRef: RefObject<HTMLDivElement | null>) {
  const registry = useRef(new Map<string, Branch>());
  const pinnedRef = useRef<PinnedBranch[]>([]);
  const refresh = useRef<() => void>(() => {});
  const [pinned, setPinned] = useState<PinnedBranch[]>([]);
  const register = useCallback(
    (branch: Branch | null, id: string) => {
      const previous = registry.current.get(id);
      const index = pinnedRef.current.findIndex((entry) => entry.branch.id === id);
      if (previous?.open && branch && !branch.open && index >= 0 && viewportRef.current) {
        restoreCollapsedBranch(viewportRef.current, branch);
      }
      if (branch) registry.current.set(id, branch);
      else registry.current.delete(id);
      refresh.current();
    },
    [viewportRef],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    let dirty = true;
    let measured: MeasuredBranch[] = [];
    const update = () => {
      frame = 0;
      if (dirty) measured = measureBranches(viewport, registry.current.values());
      dirty = false;
      const next = pinnedBranches(viewport, measured);
      viewport.style.scrollPaddingTop = `${next.length * rowHeight}px`;
      const previous = pinnedRef.current;
      if (
        next.length === previous.length &&
        next.every((entry, index) => entry.branch === previous[index].branch && entry.left === previous[index].left)
      )
        return;
      pinnedRef.current = next;
      setPinned(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const remeasure = () => {
      dirty = true;
      schedule();
    };
    refresh.current = remeasure;
    const resize = new ResizeObserver(remeasure);
    resize.observe(viewport);
    if (viewport.firstElementChild) resize.observe(viewport.firstElementChild);
    viewport.addEventListener('scroll', schedule, { passive: true });
    remeasure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      viewport.removeEventListener('scroll', schedule);
      viewport.style.removeProperty('scroll-padding-top');
      refresh.current = () => {};
    };
  }, [viewportRef]);

  return { pinned, register };
}

export function CreationLibraryTreeViewport({
  viewportRef,
  label,
  children,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  label: string;
  children: ReactNode;
}) {
  const { pinned, register } = useStickyBranches(viewportRef);
  return (
    <BranchContext.Provider value={register}>
      <div className="relative min-h-0 flex-1">
        <ScrollArea
          type="always"
          className="h-full [overflow-anchor:none] [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:min-h-full"
          viewportRef={viewportRef}
        >
          {children}
        </ScrollArea>
        {pinned.length > 0 && (
          <nav
            aria-label={label}
            data-creation-sticky-path
            className="absolute inset-x-0 top-0 z-40 overflow-hidden border-b border-border/60 bg-surface-sunken pr-2.5"
          >
            {pinned.map(({ branch, left }) => {
              const Icon = branch.icon;
              return (
                <div
                  key={branch.id}
                  data-creation-sticky-path-id={branch.id}
                  {...branch.dropTarget?.handlers}
                  className={cn(
                    'flex min-w-0 items-center',
                    branch.selected && 'bg-selected text-selected-foreground',
                    branch.dropTarget?.active && 'bg-accent ring-1 ring-inset ring-ring',
                  )}
                  style={{ height: rowHeight, paddingLeft: left }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0 rounded-sm"
                    aria-label={`${branch.collapseLabel}: ${branch.title}`}
                    aria-expanded
                    onClick={branch.onCollapse}
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 min-w-0 flex-1 justify-start gap-1.5 rounded-sm px-1 text-sm font-normal"
                    aria-label={branch.openLabel}
                    aria-current={branch.selected ? 'page' : undefined}
                    title={branch.title}
                    onClick={branch.onOpen}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{branch.title}</span>
                  </Button>
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </BranchContext.Provider>
  );
}

type StickyBranchProps = ComponentProps<typeof Collapsible> & {
  path: Omit<Branch, 'element' | 'open'>;
};

export function CreationLibraryStickyBranch({ path, ...props }: StickyBranchProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const register = useContext(BranchContext);
  useLayoutEffect(() => {
    if (elementRef.current) register?.({ ...path, element: elementRef.current, open: Boolean(props.open) }, path.id);
  });
  useLayoutEffect(() => () => register?.(null, path.id), [path.id, register]);
  return <Collapsible {...props} ref={elementRef} data-creation-sticky-branch />;
}
