import { createContext, forwardRef, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { CollapsibleContent } from '@/renderer/components/ui/collapsible';
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
  children?: ReactNode;
}

/**
 * Album disclosure bracket. In an album preview it follows the primary
 * thumbnail's top and leading edges instead of occupying a separate control
 * column. Its light connector appears only while the child bus is present.
 */
export const TreeDisclosureRail = forwardRef<HTMLButtonElement, TreeDisclosureRailProps>(function TreeDisclosureRail(
  {
    open,
    label,
    attached = false,
    anchor = { edgeX: 5, topY: 6, bottomY: 60, contactY: 36, capEndX: 34 },
    className,
    style,
    children,
    ...props
  },
  ref,
) {
  const gradientId = `tree-disclosure-${useId().replaceAll(':', '')}`;
  if (!attached)
    return (
      <Button
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

  const disclosurePath = getTreeDisclosurePath(anchor, open);

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        'pointer-events-none absolute left-0 top-1/2 z-20 h-[68px] w-5 -translate-y-1/2 overflow-visible rounded-full p-0',
        'hover:bg-transparent active:bg-transparent focus-visible:ring-2 focus-visible:ring-selected-foreground focus-visible:ring-offset-0',
        className,
      )}
      style={style}
      aria-label={label}
      data-tree-disclosure
      data-tree-disclosure-attached
      data-state={open ? 'open' : 'closed'}
      {...props}
    >
      <svg
        className="tree-disclosure-mark h-[68px] w-5 overflow-visible"
        viewBox="0 0 20 68"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1={anchor.topY}
            x2="0"
            y2={TREE_CONNECTION_GEOMETRY.disclosureConnectorEndY}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="var(--selected-foreground)" />
            <stop offset="0.52" stopColor="var(--selected-foreground)" />
            <stop offset="0.82" stopColor="var(--tree-branch-color, var(--hierarchy-accent))" />
            <stop offset="1" stopColor="var(--tree-branch-color, var(--hierarchy-accent))" />
          </linearGradient>
        </defs>
        <path
          className="tree-disclosure-path"
          d={disclosurePath}
          stroke={open ? `url(#${gradientId})` : 'currentColor'}
          strokeWidth={open ? 1.75 : 2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="cursor-pointer"
          d={disclosurePath}
          fill="none"
          stroke="transparent"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          vectorEffect="non-scaling-stroke"
        />
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
export function TreeBranchNodeConnector({ topology, anchor }: TreeBranchNodeConnectorProps) {
  const onCollapse = useContext(TreeBranchCollapseContext);
  const connectorPath = getTreeBranchNodeConnectorPath(topology, anchor);
  return (
    <svg
      data-tree-branch-node-connector
      data-position={topology.position}
      className="tree-branch-line tree-branch-node-connector pointer-events-none absolute left-0 top-0 z-0 h-[68px] w-5 overflow-visible"
      viewBox="0 0 20 68"
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
  onCollapse(): void;
}

/** The visible child rail doubles as a generous, but visually quiet, fold target. */
export function TreeBranchCollapseRail({ label, onCollapse }: TreeBranchCollapseRailProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-tree-branch-collapse-rail
      className="tree-branch-collapse-rail absolute bottom-0 left-[-2px] top-[4.25rem] z-30 h-auto w-4 cursor-pointer rounded-full p-0 hover:bg-transparent active:bg-transparent"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onCollapse();
      }}
    />
  );
}

type TreeBranchContentProps = ComponentProps<typeof CollapsibleContent>;

/** Keeps the visual indent and the connector geometry on the same source of truth. */
export function TreeBranchContent({ className, style, ...props }: TreeBranchContentProps) {
  return (
    <CollapsibleContent
      className={cn('tree-branch-content relative overflow-x-visible overflow-y-clip', className)}
      style={{ ...style, paddingLeft: TREE_CONNECTION_GEOMETRY.contentIndentX }}
      {...props}
    />
  );
}
