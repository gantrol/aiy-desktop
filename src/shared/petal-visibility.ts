/** Collection is not temporary hiding. Missing/legacy hidden placements stay collected. */
export interface PetalVisibility {
  visible: boolean;
  hiddenByHub?: boolean;
}

export type PetalVisibilityChange<T extends PetalVisibility> = Omit<T, keyof PetalVisibility> & PetalVisibility;

export function canRevealPetal(placement: PetalVisibility | undefined): boolean {
  return placement?.visible === true || placement?.hiddenByHub === true;
}

export function hidePetalByHub<T extends PetalVisibility>(placement: T): PetalVisibilityChange<T> {
  return { ...placement, visible: false, hiddenByHub: canRevealPetal(placement) };
}

export function revealPetalByHub<T extends PetalVisibility>(placement: T): PetalVisibilityChange<T> {
  return { ...placement, visible: canRevealPetal(placement), hiddenByHub: false };
}

/** Explicit show AND explicit collection consume the temporary-hide marker. */
export function setPetalVisibility<T extends PetalVisibility>(
  placement: T,
  visible: boolean,
): PetalVisibilityChange<T> {
  return { ...placement, visible, hiddenByHub: false };
}

export function normalizePetalVisibility<T extends PetalVisibility>(placement: T): PetalVisibilityChange<T> {
  return placement.visible ? setPetalVisibility(placement, true) : placement;
}

/** This is placement intent, not native window visibility or a layer's visibility. */
export function petalPlacementState(placement: PetalVisibility | undefined) {
  if (!placement) return 'unplaced' as const;
  if (placement.visible) return 'active' as const;
  return placement.hiddenByHub ? ('temporary' as const) : ('collected' as const);
}
