import { createContext, forwardRef, useContext, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { CollapsibleContent } from '@/renderer/components/ui/collapsible';
import './TreeDisclosureRail.css';
import {
  getTreeBranchNodeConnectorPath,
  getTreeDisclosurePath,
  TREE_CONNECTION_GEOMETRY,
  treeBranchRailContinues,
  type TreeBranchItemTopology,
  type TreeNodeAnchor,
} from '@/renderer/components/albums/treeConnectionGeometry';

interface TreeDisclosureRailProps extends Omit<ComponentProps<typeof Button>, 'children'> {
  open: boolean;
  label: string;
  attached?: boolean;
  anchor?: TreeNodeAnchor;
  rowHeight?: number;
  children?: ReactNode;
}

/**
 * Tree branch disclosure bracket. It follows the primary preview's top and
 * leading edges instead of occupying a separate control column. Its outgoing
 * connector appears only while the child bus is present.
 */
export const TreeDisclosureRail = forwardRef<HTMLButtonElement, TreeDisclosureRailProps>(function TreeDisclosureRail(
  {
    open,
    label,
    attached = false,
    anchor = { edgeX: 5, topY: 6, bottomY: 60, contactY: 36, capEndX: 34 },
    rowHeight = TREE_CONNECTION_GEOMETRY.rowHeight,
    className,
    style,
    children,
    ...props
  },
  ref,
) {
  if (!attached)
    return (
      <Button
        data-item-drag-ignore
        ref={ref}
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn('h-full w-full justify-start gap-2 text-muted-foreground', className)}
        style={style}
        aria-label={label}
        data-tree-disclosure
        data-state={open ? 'open' : 'closed'}
        {...props}
      >
        {children}
      </Button>
    );

  return (
    <Button
      data-item-drag-ignore
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        'pointer-events-none absolute left-0 top-1/2 z-20 w-5 -translate-y-1/2 overflow-visible rounded-full p-0',
        'hover:bg-transparent active:bg-transparent focus-visible:ring-2 focus-visible:ring-selected-foreground focus-visible:ring-offset-0',
        className,
      )}
      style={{ ...style, height: rowHeight }}
      aria-label={label}
      data-tree-disclosure
      data-tree-disclosure-attached
      data-state={open ? 'open' : 'closed'}
      {...props}
    >
      <svg
        className="tree-disclosure-mark h-full w-5 overflow-visible"
        viewBox={`0 0 20 ${rowHeight}`}
        fill="none"
        aria-hidden="true"
      >
        {[false, true].map((connected) => (
          <g
            key={String(connected)}
            data-tree-disclosure-shape={connected ? 'open' : 'closed'}
            className={connected === open ? undefined : 'hidden'}
          >
            <path
              className="tree-disclosure-path"
              d={getTreeDisclosurePath(anchor, connected, rowHeight)}
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="cursor-pointer"
              d={getTreeDisclosurePath(anchor, connected, rowHeight)}
              fill="none"
              stroke="transparent"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="stroke"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
    </Button>
  );
});

TreeDisclosureRail.displayName = 'TreeDisclosureRail';

interface TreeBranchTransitRailProps {
  topology: TreeBranchItemTopology;
}

/** The current content owner keeps this rail through an expanded child subtree. */
export function TreeBranchTransitRail({ topology }: TreeBranchTransitRailProps) {
  if (!treeBranchRailContinues(topology)) return null;
  return (
    <span
      data-tree-branch-transit-rail
      data-position={topology.position}
      className="tree-branch-line tree-branch-transit-rail pointer-events-none absolute bottom-0 left-0 top-0 z-0 w-5 overflow-visible"
      aria-hidden="true"
    >
      <svg className="block size-full overflow-visible" viewBox="0 0 20 1" preserveAspectRatio="none">
        <line
          x1={TREE_CONNECTION_GEOMETRY.childIncomingX}
          y1="0"
          x2={TREE_CONNECTION_GEOMETRY.childIncomingX}
          y2="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

interface TreeBranchNodeConnectorProps {
  topology: TreeBranchItemTopology;
  anchor: TreeNodeAnchor;
  rowHeight?: number;
}

const TreeBranchCollapseContext = createContext<(() => void) | null>(null);

interface TreeBranchCollapseProviderProps {
  children: ReactNode;
  onCollapse(): void;
}

/** Lets each direct child rail fold the content owner that drew it. */
export function TreeBranchCollapseProvider({ children, onCollapse }: TreeBranchCollapseProviderProps) {
  return <TreeBranchCollapseContext.Provider value={onCollapse}>{children}</TreeBranchCollapseContext.Provider>;
}

/** A node-local junction: either a spur from the transit rail or its terminal bend. */
export function TreeBranchNodeConnector({
  topology,
  anchor,
  rowHeight = TREE_CONNECTION_GEOMETRY.rowHeight,
}: TreeBranchNodeConnectorProps) {
  const onCollapse = useContext(TreeBranchCollapseContext);
  const connectorPath = getTreeBranchNodeConnectorPath(topology, anchor);
  return (
    <svg
      data-item-drag-ignore
      data-tree-branch-node-connector
      data-position={topology.position}
      className="tree-branch-line tree-branch-node-connector pointer-events-none absolute left-0 top-0 z-0 w-5 overflow-visible"
      style={{ height: rowHeight }}
      viewBox={`0 0 20 ${rowHeight}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d={connectorPath}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* A selected route turns into this node without tinting the rail below it. */}
      <path
        className="tree-branch-selected-connector hidden text-selected-foreground"
        d={getTreeBranchNodeConnectorPath({ ...topology, hasSuccessor: false }, anchor)}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {onCollapse && (
        <path
          data-tree-branch-node-hit-target
          className="tree-branch-hit-target"
          d={connectorPath}
          fill="none"
          pointerEvents="stroke"
          style={{ cursor: 'pointer', stroke: 'transparent', strokeWidth: 8 }}
          onClick={(event) => {
            event.stopPropagation();
            onCollapse();
          }}
        />
      )}
    </svg>
  );
}

interface TreeBranchCollapseRailProps {
  label: string;
  rowHeight?: number;
  onCollapse(): void;
}

/** The visible child rail doubles as a generous, but visually quiet, fold target. */
export function TreeBranchCollapseRail({
  label,
  rowHeight = TREE_CONNECTION_GEOMETRY.rowHeight,
  onCollapse,
}: TreeBranchCollapseRailProps) {
  return (
    <Button
      data-item-drag-ignore
      type="button"
      variant="ghost"
      size="icon-sm"
      data-tree-branch-collapse-rail
      className="tree-branch-collapse-rail absolute bottom-0 left-[-2px] z-30 h-auto w-4 cursor-pointer rounded-full p-0 hover:bg-transparent active:bg-transparent"
      style={{ top: rowHeight }}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onCollapse();
      }}
    />
  );
}

interface TreeBranchContentProps extends Omit<ComponentProps<typeof CollapsibleContent>, 'children'> {
  children: ReactNode | (() => ReactNode);
}

function TreeBranchChildren({ render }: { render(): ReactNode }) {
  return render();
}

/** Keeps the visual indent and the connector geometry on the same source of truth. */
export function TreeBranchContent({ className, style, children, ...props }: TreeBranchContentProps) {
  return (
    <CollapsibleContent
      className={cn('tree-branch-content relative overflow-x-visible overflow-y-clip', className)}
      style={{ ...style, paddingLeft: TREE_CONNECTION_GEOMETRY.contentIndentX }}
      {...props}
    >
      {/* Radix owns mount/unmount, including the exit animation. Defer expensive
          child trees without emptying them as soon as logical open turns false. */}
      {typeof children === 'function' ? <TreeBranchChildren render={children} /> : children}
    </CollapsibleContent>
  );
}
