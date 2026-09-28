import type { AlbumDto } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { compareCreationLibraryOrder } from '@/renderer/components/creator/creationLibraryOrder';
import { creationCoverFirstAssets } from '@/renderer/components/creator/creationCoverFirstAssets';
import {
  creationFormPreviewAssetIds,
  creationFormTitle,
  creationFormKindLabel,
  type CreationFormProjection,
  type CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import type { CreationOutlineTarget } from '@/shared/contracts/creation-outline';
import type { CreationAlbumChildVisibilityEntry } from '@/renderer/components/creator/useCreationAlbumChildVisibility';

export interface OutlineNode {
  key: string;
  title: string;
  label: string;
  parent: string | null;
  children: string[];
  kind: 'album' | 'creation' | 'form' | 'series' | 'block' | 'content-action';
  articleId?: string;
  content?: {
    articleId: string;
    blockId: string;
    referenceId?: string;
    kind: import('@/shared/contracts/article-structure').ArticleStructureNode['kind'];
  };
  contentAction?: { articleId: string; action: 'LOAD' | 'MORE' | 'OPEN' };
  previewAssetId?: string;
  target?: CreationOutlineTarget;
  form?: CreationFormProjection;
  primary?: boolean;
  seriesId?: string;
  libraryEntry?: CreationAlbumChildVisibilityEntry;
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

export function outlineCurrentNodeKey(
  albumId: string | null,
  form: CreationFormProjection | null,
  seriesId: string | null,
) {
  if (albumId) return 'album:' + albumId;
  if (!form) return null;
  const key = 'form:' + form.form.id;
  return form.role === 'IMAGE_CREATION' &&
    seriesId !== form.entityRef.id &&
    form.session?.memberSeries.some((series) => series.id === seriesId)
    ? key + ':series:' + seriesId
    : key;
}

function creationNode(
  creation: CreationItemProjection,
  activeCreations: ReadonlyMap<string, CreationItemProjection>,
  nodes: ReadonlyMap<string, OutlineNode>,
  label: string,
): OutlineNode {
  const parentCreation = activeCreations.get(creation.item.parentCreationItemId ?? '');
  const albumKey = creation.item.albumId ? 'album:' + creation.item.albumId : null;
  const parent =
    parentCreation && parentCreation.item.albumId === creation.item.albumId
      ? 'creation:' + parentCreation.key
      : albumKey && nodes.has(albumKey)
        ? albumKey
        : null;
  const key = 'creation:' + creation.key;
  return {
    key,
    title: creation.title,
    label,
    kind: 'creation',
    parent,
    children: [],
    previewAssetId: formPreviewAssetId(creation.defaultForm),
    target: {
      kind: 'CREATION_ITEM',
      id: creation.key,
      expectedAlbumId: creation.item.albumId,
      expectedParentCreationItemId: creation.item.parentCreationItemId ?? null,
    },
    form: creation.defaultForm ?? undefined,
    libraryEntry: {
      key,
      pinned: creation.item.pinned,
      activityAt: creation.activityAt,
      createdAt: creation.item.createdAt,
    },
  };
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
      libraryEntry: {
        key: albumKey(album.id),
        pinned: album.pinned,
        activityAt: album.activityAt,
        createdAt: album.createdAt,
      },
    });
  }
  const activeCreations = new Map(
    creations.filter(({ item }) => item.lifecycle === 'ACTIVE').map((creation) => [creation.key, creation]),
  );
  for (const creation of creations) {
    if (
      creation.item.lifecycle !== 'ACTIVE' ||
      (creation.item.albumId && tree.effectivelyArchived.has(creation.item.albumId))
    )
      continue;
    const itemKey = 'creation:' + creation.key;
    nodes.set(itemKey, creationNode(creation, activeCreations, nodes, labels.creations));
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
        primary: creation.item.primaryFormId === form.form.id,
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
  const compare = (leftKey: string, rightKey: string) => {
    const left = nodes.get(leftKey)!;
    const right = nodes.get(rightKey)!;
    return compareCreationLibraryOrder(left.libraryEntry!, right.libraryEntry!);
  };
  roots.sort(compare);
  for (const node of nodes.values()) {
    if (node.kind === 'album') node.children.sort(compare);
    if (node.kind === 'creation')
      node.children.sort((leftKey, rightKey) => {
        const left = nodes.get(leftKey)!;
        const right = nodes.get(rightKey)!;
        if (left.kind !== right.kind) return left.kind === 'form' ? -1 : 1;
        return left.kind === 'creation' ? compare(leftKey, rightKey) : 0;
      });
  }
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

export function canMoveOutlineTo(
  tree: OutlineTree,
  selection: readonly OutlineNode[],
  albumId: string | null,
  copy = false,
  parentCreationItemId: string | null = null,
) {
  if (!selection.length || selection.some((node) => !node.target)) return false;
  if (parentCreationItemId && (copy || selection.some((node) => node.kind !== 'creation'))) return false;
  const destinationKey = parentCreationItemId
    ? 'creation:' + parentCreationItemId
    : albumId
      ? 'album:' + albumId
      : null;
  if (destinationKey && !tree.nodes.has(destinationKey)) return false;
  if (parentCreationItemId && tree.nodes.get(destinationKey!)?.target?.expectedAlbumId !== albumId) return false;
  const ancestors = destinationKey
    ? [destinationKey, ...outlineAncestors(tree, destinationKey).map((node) => node.key)]
    : [];
  return (
    !selection.some((node) => ancestors.includes(node.key)) &&
    (copy ||
      selection.some(
        (node) =>
          node.target?.expectedAlbumId !== albumId ||
          (node.kind === 'creation' && (node.target?.expectedParentCreationItemId ?? null) !== parentCreationItemId),
      ))
  );
}

export function outlineDestination(node: OutlineNode | undefined) {
  return {
    albumId: node?.kind === 'album' ? node.target!.id : (node?.target?.expectedAlbumId ?? null),
    parentCreationItemId: node?.kind === 'creation' ? node.target!.id : null,
  };
}
