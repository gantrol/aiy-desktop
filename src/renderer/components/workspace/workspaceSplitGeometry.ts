export function clampWorkspaceRatio(ratio: number) {
  return Math.min(Math.max(Math.round(Number.isFinite(ratio) ? ratio : 5_000), 2_500), 7_500);
}

/** Matching track types interpolate in both directions; the separator never changes size. */
export function workspaceSplitTracks(
  ratio: number,
  firstCollapsed: boolean,
  secondCollapsed: boolean,
  columns: boolean,
) {
  const share = clampWorkspaceRatio(ratio) / 10_000;
  const rail = columns ? '2rem' : '2.25rem';
  const first = firstCollapsed
    ? rail
    : secondCollapsed
      ? `calc(100% - ${rail} - 1px)`
      : `calc((100% - 1px) * ${share})`;
  const second = secondCollapsed
    ? rail
    : firstCollapsed
      ? `calc(100% - ${rail} - 1px)`
      : `calc((100% - 1px) * ${1 - share})`;
  return `${first} 1px ${second}`;
}
