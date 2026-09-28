import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  outlineAncestors,
  outlineBranchKeys,
  outlineRows,
  type OutlineTree,
} from '@/renderer/features/creation-outline/outline-tree';
import {
  creationTreeNavigationKey,
  useCreationTreeScrollMemory,
} from '@/renderer/components/creator/useCreationTreeScroll';
import { useCreationAlbumChildVisibility } from '@/renderer/components/creator/useCreationAlbumChildVisibility';
import { projectOutlineBrowseRows } from '@/renderer/features/creation-outline/outlineBrowseRows';
import type { OutlineArticleContent } from '@/renderer/features/creation-outline/useOutlineArticleContent';

/** Browsing belongs to the host sidebar; batch selection belongs to each mounted outline. */
export function useCreationOutlineView(initialAlbumId?: string | null) {
  const [articleContent, setArticleContent] = useState(new Map<string, OutlineArticleContent>());
  const [scopeKey, setScopeKey] = useState<string | null>(initialAlbumId ? 'album:' + initialAlbumId : null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const navigation = useRef<string | null>(null);
  const scopePath = useRef<string[]>([]);
  const scroll = useCreationTreeScrollMemory();
  const childVisibility = useCreationAlbumChildVisibility();
  return {
    articleContent,
    setArticleContent,
    scopeKey,
    setScopeKey,
    expanded,
    setExpanded,
    searchCollapsed,
    setSearchCollapsed,
    query,
    setQuery,
    navigation,
    scopePath,
    scroll,
    childVisibility,
  };
}

export type CreationOutlineView = ReturnType<typeof useCreationOutlineView>;

export function useCreationOutlineDisclosure(tree: OutlineTree, view: CreationOutlineView, currentKey: string | null) {
  const { scopeKey, expanded, setExpanded, searchCollapsed, setSearchCollapsed, query } = view;
  const scope = scopeKey && tree.nodes.has(scopeKey) ? scopeKey : null;
  const searching = query.trim().length > 0;
  const expandedKeys = useMemo(
    () => (searching ? new Set([...tree.nodes.keys()].filter((key) => !searchCollapsed.has(key))) : expanded),
    [tree, searching, searchCollapsed, expanded],
  );
  const sourceRows = useMemo(() => outlineRows(tree, scope, expandedKeys, query), [tree, scope, expandedKeys, query]);
  const project = view.childVisibility.project;
  const { rows, browseRows } = useMemo(
    () => projectOutlineBrowseRows(tree, scope, sourceRows, expandedKeys, currentKey, searching, project),
    [tree, scope, sourceRows, expandedKeys, currentKey, searching, project],
  );
  const branchKeys = useMemo(() => outlineBranchKeys(tree, scope), [tree, scope]);
  function disclose(keys: readonly string[], open: boolean) {
    const update = searching ? setSearchCollapsed : setExpanded;
    update((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (searching ? !open : open) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }
  function toggle(key: string, wholeBranch = false) {
    disclose(wholeBranch ? outlineBranchKeys(tree, key, true) : [key], !expandedKeys.has(key));
  }
  return { scope, expandedKeys, rows, browseRows, branchKeys, disclose, toggle };
}

export function useCreationOutlineNavigation(
  tree: OutlineTree,
  currentKey: string | null,
  active: boolean,
  view: CreationOutlineView,
) {
  const { scopeKey, setScopeKey, setExpanded, query, setQuery, setSearchCollapsed, navigation, scopePath } = view;
  const navigationKey = creationTreeNavigationKey(
    currentKey,
    currentKey ? outlineAncestors(tree, currentKey).map((node) => node.key) : [],
  );

  useLayoutEffect(() => {
    if (scopeKey && !tree.nodes.has(scopeKey)) {
      setScopeKey([...scopePath.current].reverse().find((key) => tree.nodes.has(key)) ?? null);
    } else {
      scopePath.current = scopeKey ? [...outlineAncestors(tree, scopeKey).map((node) => node.key), scopeKey] : [];
    }
  }, [scopeKey, scopePath, setScopeKey, tree]);

  useLayoutEffect(() => {
    if (!active || navigation.current === navigationKey) return;
    if (currentKey && !tree.nodes.has(currentKey)) return;
    navigation.current = navigationKey;
    if (!currentKey) return;
    const ancestors = outlineAncestors(tree, currentKey).map((node) => node.key);
    const nextScope = scopeKey && ancestors.includes(scopeKey) ? scopeKey : null;
    setScopeKey(nextScope);
    setExpanded((current) => new Set([...current, ...ancestors]));
    // Keep a useful search, but never let an old search hide newly opened work.
    if (
      query &&
      !outlineRows(tree, nextScope, new Set(tree.nodes.keys()), query).some((row) => row.node.key === currentKey)
    ) {
      setQuery('');
    }
    setSearchCollapsed((current) => new Set([...current].filter((key) => !ancestors.includes(key))));
  }, [
    active,
    currentKey,
    navigation,
    navigationKey,
    query,
    scopeKey,
    setExpanded,
    setQuery,
    setScopeKey,
    setSearchCollapsed,
    tree,
  ]);

  return navigationKey;
}
