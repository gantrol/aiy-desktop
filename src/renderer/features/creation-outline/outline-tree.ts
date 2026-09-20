import type { AlbumDto } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { buildAlbumTreeIndex, compareSidebarRootSortOrder } from '@/renderer/components/albums/albumTree';
import { creationCoverFirstAssets } from '@/renderer/components/creator/creationCoverFirstAssets';
import {
  creationFormPreviewAssetIds,
  creationFormTitle,
  creationFormKindLabel,
  type CreationFormProjection,
  type CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import type { CreationOutlineTarget } from '@/shared/contracts/creation-outline';

export interface OutlineNode {
  key: string;
  title: string;
  label: string;
  parent: string | null;
  children: string[];
  kind: 'album' | 'creation' | 'form' | 'series';
  previewAssetId?: string;
  target?: CreationOutlineTarget;
  form?: CreationFormProjection;
  seriesId?: string;
}
export interface OutlineTree {
  nodes: Map<string, OutlineNode>;
  roots: string[];
}
export interface OutlineRow {
  node: OutlineNode;
  depth: number;
}

function formPreviewAssetId(form: CreationFormProjection | null) {
  return form ? creationFormPreviewAssetIds(form)[0] : undefined;
}

export function createOutlineTree(
  albums: readonly AlbumDto[],
  creations: readonly CreationItemProjection[],
  labels: MessageCatalog['creator']['album'],
): OutlineTree {
  const tree = buildAlbumTreeIndex(albums);
  const nodes = new Map<string, OutlineNode>();
  const albumKey = (id: string) => 'album:' + id;
  for (const album of albums) {
    if (tree.effectivelyArchived.has(album.id)) continue;
    const parentId = tree.parentById.get(album.id) ?? null;
    nodes.set(albumKey(album.id), {
      key: albumKey(album.id),
      title: album.title,
      label: labels.albumLabel,
      kind: 'album',
      previewAssetId: album.previewAssets[0]?.id ?? album.documentPreviewAssets?.[0]?.id,
      parent: parentId ? albumKey(parentId) : null,
      children: [],
      target: { kind: 'ALBUM', id: album.id, expectedAlbumId: parentId },
    });
  }
  for (const creation of creations) {
    if (
      creation.item.lifecycle !== 'ACTIVE' ||
      (creation.item.albumId && tree.effectivelyArchived.has(creation.item.albumId))
    )
      continue;
    const parent =
      creation.item.albumId && nodes.has(albumKey(creation.item.albumId)) ? albumKey(creation.item.albumId) : null;
    const itemKey = 'creation:' + creation.key;
    nodes.set(itemKey, {
      key: itemKey,
      title: creation.title,
      label: labels.creations,
      kind: 'creation',
      previewAssetId: formPreviewAssetId(creation.defaultForm),
      parent,
      children: [],
      target: { kind: 'CREATION_ITEM', id: creation.key, expectedAlbumId: creation.item.albumId },
      form: creation.defaultForm ?? undefined,
    });
    for (const form of creation.orderedForms) {
      const formKey = 'form:' + form.form.id;
      const formNode: OutlineNode = {
        key: formKey,
        title: creationFormTitle(form, labels),
        label: creationFormKindLabel(form, labels),
        kind: 'form',
        previewAssetId: formPreviewAssetId(form),
        parent: itemKey,
        children: [],
        form,
      };
      nodes.set(formKey, formNode);
      nodes.get(itemKey)!.children.push(formKey);
      if (form.role === 'IMAGE_CREATION' && form.session) {
        for (const series of form.session.memberSeries) {
          if (series.id === form.entityRef.id) continue;
          const seriesKey = formKey + ':series:' + series.id;
          nodes.set(seriesKey, {
            key: seriesKey,
            title: series.title || labels.formKinds.IMAGE_CREATION,
            label: labels.directionExperiment,
            kind: 'series',
            previewAssetId: creationCoverFirstAssets(series)[0]?.id,
            parent: formKey,
            children: [],
            seriesId: series.id,
          });
          formNode.children.push(seriesKey);
        }
      }
    }
  }
  const roots: string[] = [];
  for (const node of nodes.values()) {
    if (node.kind !== 'album' && node.kind !== 'creation') continue;
    if (node.parent && nodes.has(node.parent)) nodes.get(node.parent)!.children.push(node.key);
    else roots.push(node.key);
  }
  const creationsById = new Map(creations.map((creation) => [creation.key, creation]));
  const memberOrder = new Map(
    albums.map((album) => [
      albumKey(album.id),
      new Map(album.members.map((member) => [member.targetType + ':' + member.targetId, member.sortOrder])),
    ]),
  );
  const compare = (leftKey: string, rightKey: string) => {
    const left = nodes.get(leftKey)!;
    const right = nodes.get(rightKey)!;
    const leftAlbum = left.kind === 'album' ? tree.byId.get(left.target!.id) : undefined;
    const rightAlbum = right.kind === 'album' ? tree.byId.get(right.target!.id) : undefined;
    const leftCreation = left.kind === 'creation' ? creationsById.get(left.target!.id) : undefined;
    const rightCreation = right.kind === 'creation' ? creationsById.get(right.target!.id) : undefined;
    const pinned =
      Number(rightAlbum?.pinned ?? rightCreation?.item.pinned) - Number(leftAlbum?.pinned ?? leftCreation?.item.pinned);
    if (pinned) return pinned;
    if (left.parent) {
      const members = memberOrder.get(left.parent);
      const order = (node: OutlineNode) =>
        members?.get(node.target!.kind + ':' + node.target!.id) ?? Number.MAX_SAFE_INTEGER;
      const difference = order(left) - order(right);
      if (difference) return difference;
    } else {
      const difference = compareSidebarRootSortOrder(
        leftAlbum?.creatorRootSortOrder ?? leftCreation?.item.creatorRootSortOrder,
        rightAlbum?.creatorRootSortOrder ?? rightCreation?.item.creatorRootSortOrder,
      );
      if (difference) return difference;
    }
    return (
      (rightAlbum?.activityAt ?? rightCreation?.activityAt ?? '').localeCompare(
        leftAlbum?.activityAt ?? leftCreation?.activityAt ?? '',
      ) || left.key.localeCompare(right.key)
    );
  };
  roots.sort(compare);
  for (const node of nodes.values()) if (node.kind === 'album') node.children.sort(compare);
  return { nodes, roots };
}

export function outlineAncestors(tree: OutlineTree, key: string): OutlineNode[] {
  const result: OutlineNode[] = [];
  const visited = new Set([key]);
  let parent = tree.nodes.get(key)?.parent;
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const node = tree.nodes.get(parent);
    if (!node) break;
    result.unshift(node);
    parent = node.parent;
  }
  return result;
}

export function outlineRows(
  tree: OutlineTree,
  scope: string | null,
  expanded: ReadonlySet<string>,
  query: string,
): OutlineRow[] {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = new Set<string>();
  if (normalized)
    for (const node of tree.nodes.values()) {
      if (!(node.title + ' ' + node.label).toLocaleLowerCase().includes(normalized)) continue;
      matches.add(node.key);
      outlineAncestors(tree, node.key).forEach((ancestor) => matches.add(ancestor.key));
    }
  const rows: OutlineRow[] = [];
  const visited = new Set<string>();
  const visit = (key: string, depth: number) => {
    if (visited.has(key) || (normalized && !matches.has(key))) return;
    visited.add(key);
    const node = tree.nodes.get(key);
    if (!node) return;
    rows.push({ node, depth });
    if (expanded.has(key)) node.children.forEach((child) => visit(child, depth + 1));
  };
  (scope ? (tree.nodes.get(scope)?.children ?? []) : tree.roots).forEach((key) => visit(key, 0));
  return rows;
}

export function outlineBranchKeys(tree: OutlineTree, scope: string | null, includeScope = false): string[] {
  const pending = scope ? (includeScope ? [scope] : [...(tree.nodes.get(scope)?.children ?? [])]) : [...tree.roots];
  const seen = new Set<string>();
  const branches: string[] = [];
  while (pending.length) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = tree.nodes.get(key);
    if (!node?.children.length) continue;
    branches.push(key);
    pending.push(...node.children);
  }
  return branches;
}

export function outermostSelection(tree: OutlineTree, keys: readonly string[]) {
  const selected = new Set(keys);
  return keys.flatMap((key) => {
    const node = tree.nodes.get(key);
    return node && !outlineAncestors(tree, key).some((ancestor) => selected.has(ancestor.key)) ? [node] : [];
  });
}

export function canMoveOutlineTo(tree: OutlineTree, selection: readonly OutlineNode[], albumId: string | null) {
  if (!selection.length || selection.some((node) => !node.target)) return false;
  const destinationKey = albumId ? 'album:' + albumId : null;
  if (destinationKey && !tree.nodes.has(destinationKey)) return false;
  const ancestors = destinationKey
    ? [destinationKey, ...outlineAncestors(tree, destinationKey).map((node) => node.key)]
    : [];
  return (
    !selection.some((node) => ancestors.includes(node.key)) &&
    selection.some((node) => node.target?.expectedAlbumId !== albumId)
  );
}
