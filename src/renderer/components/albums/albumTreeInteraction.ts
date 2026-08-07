export const ALBUM_TREE_INTERACTION = {
  hoverSpreadStepPx: 24,
  pullDownArmDelayMs: 220,
  verticalGestureDistancePx: 27,
} as const;

export function hasAlbumTreeVerticalTravel(originY: number, currentY: number, direction: 'up' | 'down') {
  const distance = direction === 'up' ? originY - currentY : currentY - originY;
  return distance >= ALBUM_TREE_INTERACTION.verticalGestureDistancePx;
}

export function shouldExpandAlbumFromPullDown({
  armed,
  originY,
  currentY,
}: {
  armed: boolean;
  originY: number;
  currentY: number;
}) {
  return armed && hasAlbumTreeVerticalTravel(originY, currentY, 'down');
}

export function trackAlbumTreeRetreat(originY: number, currentY: number) {
  const retreated = hasAlbumTreeVerticalTravel(originY, currentY, 'up');
  return {
    retreated,
    originY: retreated ? currentY : Math.max(originY, currentY),
  };
}
