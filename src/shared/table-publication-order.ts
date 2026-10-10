/** Insert indivisible table groups between their manuscript neighbours without resetting a saved gallery order. */
export function tablePublicationOrder(
  natural: readonly string[],
  preferred: readonly string[] | null,
  groups: readonly (readonly string[])[],
) {
  if (!preferred) return [...natural];
  const generated = new Set(groups.flat());
  const originals = natural.filter((id) => !generated.has(id));
  if (preferred.some((id) => !originals.includes(id))) throw new Error('PUBLISHING_MASK_MEDIA_CHANGED');
  const ordered = [...preferred, ...originals.filter((id) => !preferred.includes(id))];
  for (const group of groups) {
    const at = natural.indexOf(group[0]!);
    const previous = natural
      .slice(0, at)
      .reverse()
      .find((id) => ordered.includes(id));
    const next = natural.slice(at + group.length).find((id) => ordered.includes(id));
    const left = previous ? ordered.indexOf(previous) : -1;
    const right = next ? ordered.indexOf(next) : ordered.length;
    if (left >= right) throw new Error('TABLE_ORDER_CONFLICT');
    ordered.splice(left + 1, 0, ...group);
  }
  return ordered;
}

export function assertTableGroups(
  order: readonly string[],
  expected: readonly string[],
  groups: readonly (readonly string[])[],
) {
  if (
    order.length !== expected.length ||
    new Set(order).size !== order.length ||
    expected.some((id) => !order.includes(id))
  )
    throw new Error('TABLE_ORDER_CONFLICT');
  for (const group of groups) {
    const start = order.indexOf(group[0]!);
    if (start < 0 || group.some((id, offset) => order[start + offset] !== id)) throw new Error('TABLE_ORDER_CONFLICT');
  }
}
