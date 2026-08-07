import type { MediaStackPrimaryFrameBounds } from '@/renderer/components/media/MediaStackPreview';

const contentIndentX = 16;
const parentOutletX = 4;

export const TREE_CONNECTION_GEOMETRY = {
  rowHeight: 68,
  mediaStackHeight: 60,
  contentIndentX,
  parentOutletX,
  childIncomingX: parentOutletX - contentIndentX,
  /** `rounded-md` is 8px; include the outline offset so both contours share the same outer radius. */
  disclosureCornerRadius: 8.5,
  /** A 1.75px stroke overlaps the cover border by 0.375px, avoiding fractional-scale light seams. */
  disclosureOutlineOffset: 0.5,
  disclosureConnectorEndY: 68,
  /** Reach the child boundary on a straight tangent so both SVGs rasterize the seam as the same line. */
  disclosureConnectorStraightLength: 4,
} as const;

export type TreeBranchItemPosition = 'first' | 'middle' | 'last' | 'only';

export interface TreeBranchItemTopology {
  position: TreeBranchItemPosition;
  hasPredecessor: boolean;
  hasSuccessor: boolean;
}

/** Stable ports shared by the incoming parent rail and the node bracket. */
export interface TreeNodeAnchor {
  edgeX: number;
  topY: number;
  bottomY: number;
  contactY: number;
  capEndX: number;
}

function coordinate(value: number) {
  return Number(value.toFixed(2));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function continuousCornerControl(radius: number) {
  return coordinate(Math.min(3, radius / 3));
}

/**
 * Convert the first cover's stable media-stack bounds into row-local ports.
 * The outline sits mostly outside the image border with a tiny optical overlap.
 */
export function getTreeNodeAnchor(
  bounds: MediaStackPrimaryFrameBounds,
  rowInsetY = (TREE_CONNECTION_GEOMETRY.rowHeight - TREE_CONNECTION_GEOMETRY.mediaStackHeight) / 2,
): TreeNodeAnchor {
  const outlineOffset = TREE_CONNECTION_GEOMETRY.disclosureOutlineOffset;
  const edgeX = coordinate(bounds.left - outlineOffset);
  const topY = coordinate(clamp(rowInsetY + bounds.top - outlineOffset, 2.5, 52));
  const bottomY = coordinate(clamp(rowInsetY + bounds.bottom + outlineOffset, topY + 10, 64));
  const contactY = coordinate(clamp(topY + (bottomY - topY) * 0.56, topY + 5, bottomY - 4));
  const capEndX = coordinate(Math.max(edgeX + 12, Math.min(bounds.right - 4, edgeX + 30)));
  return { edgeX, topY, bottomY, contactY, capEndX };
}

/**
 * The dark album mark is allowed to deform with the cover. When open, the
 * same path bends all the way to the next level's outlet with vertical
 * tangents at both ends, avoiding a stitched dark/light elbow.
 */
export function getTreeDisclosurePath(anchor: TreeNodeAnchor, open: boolean) {
  const { edgeX, topY, bottomY, contactY, capEndX } = anchor;
  const cornerRadius = Math.min(TREE_CONNECTION_GEOMETRY.disclosureCornerRadius, (bottomY - topY) / 3);
  const cornerX = coordinate(edgeX + cornerRadius);
  const cornerControl = continuousCornerControl(cornerRadius);
  const cornerControlX = coordinate(edgeX + cornerControl);

  if (!open) {
    const turnY = coordinate(Math.max(contactY + 3, bottomY - cornerRadius));
    const lowerCornerRadius = coordinate(bottomY - turnY);
    const lowerCornerControl = continuousCornerControl(lowerCornerRadius);
    const tailX = coordinate(edgeX + lowerCornerRadius);
    return `M${capEndX} ${topY}H${cornerX}C${cornerControlX} ${topY} ${edgeX} ${coordinate(topY + cornerControl)} ${edgeX} ${coordinate(topY + cornerRadius)}V${turnY}C${edgeX} ${coordinate(bottomY - lowerCornerControl)} ${coordinate(edgeX + lowerCornerControl)} ${bottomY} ${tailX} ${bottomY}`;
  }

  const outletX = TREE_CONNECTION_GEOMETRY.parentOutletX;
  const outletBoundaryY = TREE_CONNECTION_GEOMETRY.disclosureConnectorEndY;
  const straightStartY = outletBoundaryY - TREE_CONNECTION_GEOMETRY.disclosureConnectorStraightLength;

  // When the fixed child rail sits inside the cover's leading edge, keep the
  // contour outside the image: round beneath the cover, then round down into
  // the rail. A single long cubic cuts visibly across the lower-left corner.
  if (outletX >= edgeX) {
    const travel = outletX - edgeX;
    if (travel === 0)
      return `M${capEndX} ${topY}H${cornerX}C${cornerControlX} ${topY} ${edgeX} ${coordinate(topY + cornerControl)} ${edgeX} ${coordinate(topY + cornerRadius)}V${outletBoundaryY}`;

    const availableTailHeight = Math.max(0, outletBoundaryY - bottomY);
    const railCornerRadius = coordinate(Math.min(1, availableTailHeight * 0.25, travel * 0.14));
    const coverCornerRadius = coordinate(Math.min(cornerRadius, travel - railCornerRadius));
    const coverTurnY = coordinate(bottomY - coverCornerRadius);
    const coverCornerEndX = coordinate(edgeX + coverCornerRadius);
    const coverCornerControl = continuousCornerControl(coverCornerRadius);
    const railCornerStartX = coordinate(outletX - railCornerRadius);
    const railCornerEndY = coordinate(bottomY + railCornerRadius);
    const railCornerControl = continuousCornerControl(railCornerRadius);
    return `M${capEndX} ${topY}H${cornerX}C${cornerControlX} ${topY} ${edgeX} ${coordinate(topY + cornerControl)} ${edgeX} ${coordinate(topY + cornerRadius)}V${coverTurnY}C${edgeX} ${coordinate(bottomY - coverCornerControl)} ${coordinate(edgeX + coverCornerControl)} ${bottomY} ${coverCornerEndX} ${bottomY}H${railCornerStartX}C${coordinate(outletX - railCornerControl)} ${bottomY} ${outletX} ${coordinate(bottomY + railCornerControl)} ${outletX} ${railCornerEndY}V${outletBoundaryY}`;
  }

  const bendHeight = clamp(17 + Math.abs(outletX - edgeX) * 0.52, 19, 29);
  const bendY = coordinate(Math.max(contactY + 5, straightStartY - bendHeight));
  const firstControlY = coordinate(bendY + (straightStartY - bendY) * 0.42);
  const secondControlY = coordinate(straightStartY - (straightStartY - bendY) * 0.38);
  return `M${capEndX} ${topY}H${cornerX}C${cornerControlX} ${topY} ${edgeX} ${coordinate(topY + cornerControl)} ${edgeX} ${coordinate(topY + cornerRadius)}V${bendY}C${edgeX} ${firstControlY} ${outletX} ${secondControlY} ${outletX} ${straightStartY}V${outletBoundaryY}`;
}

/**
 * Connect the parent rail to the current node. A continuing item adds a spur
 * to its owner's transit rail; a terminal item bends the incoming rail into
 * the node and ends there.
 */
export function getTreeBranchNodeConnectorPath(topology: TreeBranchItemTopology, anchor: TreeNodeAnchor) {
  const incomingX = TREE_CONNECTION_GEOMETRY.childIncomingX;
  const travel = Math.abs(anchor.edgeX - incomingX);
  const bendHeight = clamp(9 + travel * 0.22, 10, 17);
  const bendStartY = coordinate(Math.max(6, anchor.contactY - bendHeight));
  const controlDistance = coordinate(Math.max(3, (anchor.contactY - bendStartY) * 0.48));
  const prefix = topology.hasSuccessor ? `M${incomingX} ${bendStartY}` : `M${incomingX} 0V${bendStartY}`;
  return `${prefix}C${incomingX} ${coordinate(bendStartY + controlDistance)} ${anchor.edgeX} ${coordinate(anchor.contactY - controlDistance)} ${anchor.edgeX} ${anchor.contactY}`;
}

export function getTreeBranchItemTopology(index: number, itemCount: number): TreeBranchItemTopology {
  const position = getTreeBranchItemPosition(index, itemCount);
  return {
    position,
    hasPredecessor: index > 0,
    hasSuccessor: index >= 0 && index < itemCount - 1,
  };
}

export function getTreeBranchItemPosition(index: number, itemCount: number): TreeBranchItemPosition {
  if (itemCount <= 1) return 'only';
  if (index <= 0) return 'first';
  if (index >= itemCount - 1) return 'last';
  return 'middle';
}

export function treeBranchRailContinues(topology: TreeBranchItemTopology | TreeBranchItemPosition) {
  return typeof topology === 'string' ? topology === 'first' || topology === 'middle' : topology.hasSuccessor;
}
