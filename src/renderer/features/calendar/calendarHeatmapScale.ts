/** Active days share quintile thresholds; ties always receive the same shade. */
export function calendarHeatmapScale(counts: readonly number[]) {
  const sorted = counts.filter((count) => count > 0).sort((a, b) => a - b);
  // Sparse or constant histories have no useful relative distribution yet.
  const thresholds =
    sorted.length < 5 || sorted[0] === sorted.at(-1)
      ? [5, 10, 20, 50]
      : [0.2, 0.4, 0.6, 0.8].map((percentile) => {
          const position = (sorted.length - 1) * percentile;
          const lower = Math.floor(position);
          return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
        });
  return (count: number) => (count > 0 ? 1 + thresholds.filter((threshold) => count >= threshold).length : 0);
}
