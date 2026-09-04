export function formatCodexUsageTokenRange(minimum: number, maximum: number | null, tokens: Intl.NumberFormat) {
  if (maximum === null) return `≥${tokens.format(minimum)}`;
  if (minimum === maximum) return `≈${tokens.format(minimum)}`;
  return `≈${tokens.format(minimum)}–${tokens.format(maximum)}`;
}
