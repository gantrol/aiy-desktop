export const TREE_BRANCH_INTERACTION = {
  previewSpreadStepPx: 14,
  pullDownArmDelayMs: 220,
  verticalGestureDistancePx: 27,
} as const;

export function hasTreeBranchVerticalTravel(originY: number, currentY: number, direction: 'up' | 'down') {
  const distance = direction === 'up' ? originY - currentY : currentY - originY;
  return distance >= TREE_BRANCH_INTERACTION.verticalGestureDistancePx;
}

export function shouldExpandTreeBranchFromPullDown({
  armed,
  originY,
  currentY,
}: {
  armed: boolean;
  originY: number;
  currentY: number;
}) {
  return armed && hasTreeBranchVerticalTravel(originY, currentY, 'down');
}

export function trackTreeBranchRetreat(originY: number, currentY: number) {
  const retreated = hasTreeBranchVerticalTravel(originY, currentY, 'up');
  return {
    retreated,
    originY: retreated ? currentY : Math.max(originY, currentY),
  };
}
