import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
  CreationLibraryBreadcrumb,
  CREATION_LIBRARY_PATH_HEIGHT,
  type CreationLibraryPathEntry,
} from '@/renderer/components/creator/CreationLibraryBreadcrumb';
import {
  creationLibraryRailConnection,
  measureCreationLibraryRails,
  type CreationLibraryPathConnection,
} from '@/renderer/components/creator/creationLibraryStickyConnection';

interface Branch extends CreationLibraryPathEntry {
  element: HTMLDivElement;
  open: boolean;
}

interface MeasuredBranch {
  branch: Branch;
  top: number;
  rowBottom: number;
  bottom: number;
}

interface StickyPath {
  branches: readonly Branch[];
  connection: CreationLibraryPathConnection | null;
}

const BranchContext = createContext<((branch: Branch | null, id: string) => void) | null>(null);

function pathHeight(viewport: HTMLDivElement) {
  return viewport.clientHeight >= CREATION_LIBRARY_PATH_HEIGHT * 3 ? CREATION_LIBRARY_PATH_HEIGHT : 0;
}

/** Reserve room for the target's ancestors before revealing a newly selected row. */
export function creationLibraryStickyInset(viewport: HTMLDivElement, target: HTMLElement) {
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== viewport) {
    if (
      ancestor.hasAttribute('data-creation-sticky-branch') &&
      ancestor.dataset.treeBranchId !== target.dataset.treeNodeId &&
      ancestor.dataset.state === 'open'
    )
      return pathHeight(viewport);
    ancestor = ancestor.parentElement;
  }
  return 0;
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
    });
  }
  return measured.sort((first, second) => first.top - second.top);
}

function pinnedBranches(viewport: HTMLDivElement, measured: readonly MeasuredBranch[]): Branch[] {
  const height = pathHeight(viewport);
  if (!height) return [];
  const cut = viewport.scrollTop + height;
  const path: MeasuredBranch[] = [];
  for (const entry of measured) {
    const last = path.at(-1);
    if (last && !last.branch.element.contains(entry.branch.element)) continue;
    // Every ancestor shares one header; retain the full path for the overflow menu.
    if (entry.top >= viewport.scrollTop || entry.rowBottom > cut || entry.bottom <= cut) continue;
    path.push(entry);
  }
  return path.map(({ branch }) => branch);
}

function restoreCollapsedBranch(viewport: HTMLDivElement, branch: Branch) {
  const row = branch.element.querySelector<HTMLElement>('[data-tree-node-id]');
  if (!row) return;
  // A shortened path may reveal another ancestor when this entry disappears.
  // Reserve one breadcrumb row only when another ancestor remains.
  const inset = creationLibraryStickyInset(viewport, row);
  viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - inset;
  const focused = document.activeElement?.closest<HTMLElement>('[data-creation-sticky-path-id]');
  if (focused?.dataset.creationStickyPathId === branch.id) {
    row.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
}

function useStickyBranches(viewportRef: RefObject<HTMLDivElement | null>) {
  const registry = useRef(new Map<string, Branch>());
  const pinnedRef = useRef<StickyPath>({ branches: [], connection: null });
  const refresh = useRef<() => void>(() => {});
  const [pinned, setPinned] = useState<StickyPath>(pinnedRef.current);
  const register = useCallback(
    (branch: Branch | null, id: string) => {
      const previous = registry.current.get(id);
      const index = pinnedRef.current.branches.findIndex((entry) => entry.id === id);
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
    let railOwner: Branch | undefined;
    let rails: ReturnType<typeof measureCreationLibraryRails> = [];
    const update = () => {
      frame = 0;
      if (dirty) measured = measureBranches(viewport, registry.current.values());
      const branches = pinnedBranches(viewport, measured);
      const owner = branches.at(-1);
      if (dirty || owner !== railOwner) {
        rails = owner ? measureCreationLibraryRails(owner.element, viewport) : [];
        railOwner = owner;
      }
      dirty = false;
      const connection = creationLibraryRailConnection(rails, viewport.scrollTop + pathHeight(viewport));
      viewport.style.scrollPaddingTop = `${branches.length ? pathHeight(viewport) : 0}px`;
      const previous = pinnedRef.current;
      const sameBranches =
        branches.length === previous.branches.length &&
        branches.every((entry, index) => entry === previous.branches[index]);
      const sameConnection = JSON.stringify(connection) === JSON.stringify(previous.connection);
      if (sameBranches && sameConnection) return;
      const next = { branches: sameBranches ? previous.branches : branches, connection };
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
    const finishRailTransition = (event: TransitionEvent) => {
      if (
        (event.propertyName === 'color' || event.propertyName === 'stroke-width') &&
        event.target instanceof Element &&
        event.target.closest('.tree-branch-line')
      )
        remeasure();
    };
    refresh.current = remeasure;
    const resize = new ResizeObserver(remeasure);
    resize.observe(viewport);
    if (viewport.firstElementChild) resize.observe(viewport.firstElementChild);
    viewport.addEventListener('scroll', schedule, { passive: true });
    viewport.addEventListener('transitionend', finishRailTransition);
    remeasure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      viewport.removeEventListener('scroll', schedule);
      viewport.removeEventListener('transitionend', finishRailTransition);
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
  const entries = useMemo(
    () =>
      pinned.branches.map((branch) => ({
        ...branch,
        onCollapse() {
          // Focus the surviving source before a menu or an ancestor unmounts.
          branch.element.querySelector<HTMLButtonElement>('[data-tree-node-id] button')?.focus({ preventScroll: true });
          branch.onCollapse();
        },
      })),
    [pinned.branches],
  );
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
        {pinned.branches.length > 0 && (
          <CreationLibraryBreadcrumb entries={entries} connection={pinned.connection} label={label} />
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
