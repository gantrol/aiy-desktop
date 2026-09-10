/** Disambiguate equal labels with content identity, independent of list order or revision. */
export function creationWorkTitleSuffixes(items: readonly { id: string; title: string }[]) {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const ids = groups.get(item.title) ?? [];
    ids.push(item.id);
    groups.set(item.title, ids);
  }
  const suffixes = new Map<string, string>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    let length = 6;
    const maximum = ids.reduce((maximum, id) => Math.max(maximum, id.length), length);
    while (length < maximum && new Set(ids.map((id) => id.slice(-length))).size < ids.length) length += 1;
    for (const id of ids) suffixes.set(id, id.slice(-length));
  }
  return suffixes;
}
