import type {
  CreationAlbumChildVisibilityEntry,
  CreationAlbumChildVisibilityProjection,
  useCreationAlbumChildVisibility,
} from '@/renderer/components/creator/useCreationAlbumChildVisibility';
import { outlineAncestors, type OutlineRow, type OutlineTree } from '@/renderer/features/creation-outline/outline-tree';

export interface OutlineBrowseDisclosure {
  kind: 'disclosure';
  key: string;
  albumId: string;
  depth: number;
  entries: CreationAlbumChildVisibilityEntry[];
  visibility: CreationAlbumChildVisibilityProjection;
}

export type OutlineBrowseRow = { kind: 'node'; row: OutlineRow } | OutlineBrowseDisclosure;

/** Clip only album children, using the same recency window and manual boundary as the directory. */
export function projectOutlineBrowseRows(
  tree: OutlineTree,
  scope: string | null,
  sourceRows: readonly OutlineRow[],
  expanded: ReadonlySet<string>,
  currentKey: string | null,
  searching: boolean,
  project: ReturnType<typeof useCreationAlbumChildVisibility>['project'],
) {
  const required = new Set(
    currentKey ? [...outlineAncestors(tree, currentKey).map((node) => node.key), currentKey] : [],
  );
  const admitted = new Map<string, Set<string>>();
  const disclosures = new Map<string, OutlineBrowseDisclosure>();
  function projectAlbum(key: string, depth: number) {
    const node = tree.nodes.get(key);
    if (node?.kind !== 'album') return;
    const entries = node.children.flatMap((child) => tree.nodes.get(child)?.libraryEntry ?? []);
    const albumId = node.target!.id;
    const visibility = project(albumId, entries, required, searching);
    admitted.set(key, new Set(entries.slice(0, visibility.visibleCount).map((entry) => entry.key)));
    if (visibility.disclosure)
      disclosures.set(key, {
        kind: 'disclosure',
        key: 'disclosure:' + key,
        albumId,
        depth: depth + 1,
        entries,
        visibility,
      });
  }
  if (scope) projectAlbum(scope, -1);
  for (const row of sourceRows) if (expanded.has(row.node.key)) projectAlbum(row.node.key, row.depth);

  const visible = new Set<string>();
  const rows = sourceRows.filter((row) => {
    const parent = row.node.parent;
    if (parent && row.depth > 0 && !visible.has(parent)) return false;
    const siblings = parent ? admitted.get(parent) : undefined;
    if (siblings && !siblings.has(row.node.key)) return false;
    visible.add(row.node.key);
    return true;
  });
  const browseRows: OutlineBrowseRow[] = [];
  const pending: OutlineBrowseDisclosure[] = [];
  const scopeDisclosure = scope ? disclosures.get(scope) : undefined;
  if (scopeDisclosure) pending.push(scopeDisclosure);
  for (const row of rows) {
    while (pending.length && pending[pending.length - 1].depth > row.depth) browseRows.push(pending.pop()!);
    browseRows.push({ kind: 'node', row });
    const disclosure = disclosures.get(row.node.key);
    if (disclosure) pending.push(disclosure);
  }
  while (pending.length) browseRows.push(pending.pop()!);
  return { rows, browseRows };
}
