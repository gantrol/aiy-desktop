import type {
  DictionaryClassificationMergePreviewDto,
  DictionaryClassificationMergeConflictResolutionDto,
  DictionaryClassificationMovePreviewDto,
  DictionaryClassificationLocalizationDto,
  DictionaryClassificationNodeDto,
  DictionaryClassificationTermsDto,
  DictionaryClassificationTreeDto,
  Locale,
} from '@/shared/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import type { EditorDialogState } from '@/renderer/components/dictionary/classifications/ClassificationDialogs';
import {
  buildClassificationTree,
  classificationAncestors,
  classificationParentKey,
  classificationRoot,
  classificationSearchMatches,
} from '@/renderer/components/dictionary/classifications/classification-tree';

const emptyTerms: DictionaryClassificationTermsDto = { items: [], total: 0 };

export function useClassificationTreeModel(
  locale: Locale,
  notify: (message: string) => void,
  requestedSelectedId: string | null,
  onSelectedIdChange: (id: string | null, mode?: NavigationMode) => void,
) {
  const [treeDto, setTreeDto] = useState<DictionaryClassificationTreeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [showDisabledRoots, setShowDisabledRoots] = useState(false);
  const [selectedId, setSelectedId] = useState(requestedSelectedId ?? '');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [termQuery, setTermQuery] = useState('');
  const [terms, setTerms] = useState<DictionaryClassificationTermsDto>(emptyTerms);
  const [termsLoading, setTermsLoading] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const treeRequestId = useRef(0);
  const termRequestId = useRef(0);

  const applyTree = useCallback((next: DictionaryClassificationTreeDto, preferredId?: string) => {
    setTreeDto(next);
    setSelectedId((current) => {
      const requested = preferredId ?? current;
      if (requested && next.nodes.some((node) => node.id === requested)) return requested;
      return (
        next.nodes.find((node) => node.parentId === null && node.state === 'ACTIVE')?.id ??
        next.nodes.find((node) => node.parentId === null)?.id ??
        ''
      );
    });
    setExpandedIds((current) => {
      if (current.size) return current;
      return new Set(next.nodes.filter((node) => node.depth <= 1 && node.childCount > 0).map((node) => node.id));
    });
  }, []);

  const loadTree = useCallback(async () => {
    const requestId = ++treeRequestId.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await window.desktopApi.dictionaryClassificationsTree(locale);
      if (requestId === treeRequestId.current) applyTree(result);
    } catch (reason) {
      if (requestId === treeRequestId.current) {
        setLoadError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (requestId === treeRequestId.current) setLoading(false);
    }
  }, [applyTree, locale]);

  useEffect(() => {
    void loadTree();
    return () => {
      treeRequestId.current += 1;
    };
  }, [loadTree]);

  const tree = useMemo(() => buildClassificationTree(treeDto?.nodes ?? []), [treeDto]);
  const selectedNode = tree.byId.get(selectedId) ?? null;
  const activeRoot = selectedNode ? classificationRoot(selectedNode, tree) : (tree.roots[0] ?? null);
  const selectedParent = selectedNode?.parentId ? (tree.byId.get(selectedNode.parentId) ?? null) : null;
  const selectedChildren = selectedNode
    ? (tree.childrenByParent.get(classificationParentKey(selectedNode.id)) ?? [])
    : [];
  const search = useMemo(() => classificationSearchMatches(query, tree), [query, tree]);
  const displayedRoots = useMemo(
    () =>
      tree.roots.filter(
        (root) =>
          search.visibleIds.has(root.id) &&
          (showDisabledRoots || root.state === 'ACTIVE' || root.id === activeRoot?.id),
      ),
    [activeRoot?.id, search.visibleIds, showDisabledRoots, tree.roots],
  );

  const applySelectedId = useCallback(
    (id: string) => {
      setSelectedId(id);
      setExpandedIds((current) => {
        const next = new Set(current);
        for (const ancestor of classificationAncestors(id, tree)) next.add(ancestor.id);
        return next;
      });
      setTermQuery('');
    },
    [tree],
  );

  const selectNode = useCallback(
    (id: string, mode: NavigationMode = 'push') => {
      if (id !== selectedId) applySelectedId(id);
      if (id !== requestedSelectedId) onSelectedIdChange(id, mode);
    },
    [applySelectedId, onSelectedIdChange, requestedSelectedId, selectedId],
  );

  useEffect(() => {
    if (!treeDto) return;
    const requestedId = requestedSelectedId && tree.byId.has(requestedSelectedId) ? requestedSelectedId : '';
    const currentId = selectedId && tree.byId.has(selectedId) ? selectedId : '';
    const canonicalId =
      requestedId || currentId || tree.roots.find((root) => root.state === 'ACTIVE')?.id || tree.roots[0]?.id || '';
    if (canonicalId !== selectedId) applySelectedId(canonicalId);
    const canonicalLocationId = canonicalId || null;
    if (canonicalLocationId !== requestedSelectedId) {
      onSelectedIdChange(canonicalLocationId, 'replace');
    }
  }, [applySelectedId, onSelectedIdChange, requestedSelectedId, selectedId, tree, treeDto]);

  useEffect(() => {
    const requestId = ++termRequestId.current;
    if (!selectedNode) {
      setTerms(emptyTerms);
      setTermsLoading(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setTermsLoading(true);
      try {
        const result = await window.desktopApi.dictionaryClassificationsTerms({
          classificationId: selectedNode.id,
          includeDescendants,
          locale,
          query: termQuery,
          limit: 100,
        });
        if (requestId === termRequestId.current) setTerms(result);
      } catch (reason) {
        if (requestId === termRequestId.current) {
          notify(reason instanceof Error ? reason.message : String(reason));
          setTerms(emptyTerms);
        }
      } finally {
        if (requestId === termRequestId.current) setTermsLoading(false);
      }
    }, 140);
    return () => {
      window.clearTimeout(timer);
      if (requestId === termRequestId.current) termRequestId.current += 1;
    };
  }, [includeDescendants, locale, notify, selectedNode, termQuery, treeDto]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    treeDto,
    loading,
    loadError,
    query,
    setQuery,
    showDisabledRoots,
    setShowDisabledRoots,
    selectedId,
    expandedIds,
    setExpandedIds,
    includeDescendants,
    setIncludeDescendants,
    termQuery,
    setTermQuery,
    terms,
    termsLoading,
    draggingId,
    setDraggingId,
    dropTargetId,
    setDropTargetId,
    tree,
    selectedNode,
    activeRoot,
    selectedParent,
    selectedChildren,
    search,
    displayedRoots,
    applyTree,
    loadTree,
    selectNode,
    toggleExpanded,
  };
}

export type ClassificationTreeModel = ReturnType<typeof useClassificationTreeModel>;

export function useClassificationMutations({
  locale,
  model,
  refresh,
  notify,
}: {
  locale: Locale;
  model: ClassificationTreeModel;
  refresh(): Promise<void>;
  notify(message: string): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.notices;
  const { applyTree, selectNode, setExpandedIds, tree, treeDto } = model;
  const [busy, setBusy] = useState(false);
  const [editorState, setEditorState] = useState<EditorDialogState | null>(null);
  const [moveNode, setMoveNode] = useState<DictionaryClassificationNodeDto | null>(null);
  const [moveInitialParentId, setMoveInitialParentId] = useState<string | null>(null);
  const [mergeNode, setMergeNode] = useState<DictionaryClassificationNodeDto | null>(null);
  const [stateNode, setStateNode] = useState<DictionaryClassificationNodeDto | null>(null);
  const [restoreNode, setRestoreNode] = useState<DictionaryClassificationNodeDto | null>(null);
  const [rootOrderOpen, setRootOrderOpen] = useState(false);

  const commitMutation = useCallback(
    async (operation: () => Promise<DictionaryClassificationTreeDto>, notice: string, preferredId?: string) => {
      setBusy(true);
      try {
        const result = await operation();
        applyTree(result, preferredId);
        await refresh();
        notify(notice);
        return result;
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : String(reason));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [applyTree, notify, refresh],
  );

  const submitEditor = useCallback(
    async (name: string, nameLocale: string, localizations: DictionaryClassificationLocalizationDto[]) => {
      if (!editorState) return;
      if (editorState.mode === 'rename' && editorState.node) {
        const nodeId = editorState.node.id;
        const result = await commitMutation(
          () =>
            window.desktopApi.dictionaryClassificationUpdate({ id: nodeId, name, nameLocale, localizations, locale }),
          copy.updated,
          nodeId,
        );
        if (result) setEditorState(null);
        return;
      }
      const existingIds = new Set(treeDto?.nodes.map((node) => node.id) ?? []);
      const result = await commitMutation(
        () =>
          window.desktopApi.dictionaryClassificationCreate({
            parentId: editorState.parent?.id ?? null,
            name,
            nameLocale,
            localizations,
            locale,
          }),
        editorState.parent ? copy.childCreated : copy.topLevelCreated,
      );
      if (!result) return;
      const created = result.nodes.find((node) => !existingIds.has(node.id));
      if (created) {
        applyTree(result, created.id);
        setExpandedIds((current) => new Set(current).add(created.parentId ?? created.id));
        selectNode(created.id);
      }
      setEditorState(null);
    },
    [applyTree, commitMutation, copy, editorState, locale, selectNode, setExpandedIds, treeDto],
  );

  const openMove = useCallback((node: DictionaryClassificationNodeDto, initialParentId = node.parentId) => {
    setMoveNode(node);
    setMoveInitialParentId(initialParentId);
  }, []);

  const previewMove = useCallback(
    (parentId: string | null): Promise<DictionaryClassificationMovePreviewDto> => {
      if (!moveNode) return Promise.reject(new Error(copy.notFound));
      return window.desktopApi.dictionaryClassificationMovePreview({ id: moveNode.id, parentId, locale });
    },
    [copy.notFound, locale, moveNode],
  );

  const commitMove = useCallback(
    async (parentId: string | null) => {
      if (!moveNode) return;
      const result = await commitMutation(
        () => window.desktopApi.dictionaryClassificationMove({ id: moveNode.id, parentId, locale }),
        copy.moved,
        moveNode.id,
      );
      if (result) setMoveNode(null);
    },
    [commitMutation, copy.moved, locale, moveNode],
  );

  const previewMerge = useCallback(
    (targetId: string): Promise<DictionaryClassificationMergePreviewDto> => {
      if (!mergeNode) return Promise.reject(new Error(copy.notFound));
      return window.desktopApi.dictionaryClassificationMergePreview({ sourceId: mergeNode.id, targetId, locale });
    },
    [copy.notFound, locale, mergeNode],
  );

  const commitMerge = useCallback(
    async (targetId: string, conflictResolutions: DictionaryClassificationMergeConflictResolutionDto[]) => {
      if (!mergeNode) return;
      const result = await commitMutation(
        () =>
          window.desktopApi.dictionaryClassificationMerge({
            sourceId: mergeNode.id,
            targetId,
            conflictResolutions,
            locale,
          }),
        copy.merged,
        targetId,
      );
      if (result) {
        selectNode(targetId, 'replace');
        setMergeNode(null);
      }
    },
    [commitMutation, copy.merged, locale, mergeNode, selectNode],
  );

  const confirmStateChange = useCallback(
    async (includeDescendants = false) => {
      if (!stateNode) return;
      const state = stateNode.state === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      const result = await commitMutation(
        () =>
          window.desktopApi.dictionaryClassificationSetState({
            id: stateNode.id,
            state,
            includeDescendants,
            locale,
          }),
        state === 'ACTIVE' ? copy.restored : copy.disabled,
        stateNode.id,
      );
      if (result) setStateNode(null);
    },
    [commitMutation, copy.disabled, copy.restored, locale, stateNode],
  );

  const restoreSource = useCallback(async () => {
    if (!restoreNode) return;
    const result = await commitMutation(
      () => window.desktopApi.dictionaryClassificationRestoreSource({ id: restoreNode.id, locale }),
      copy.sourceRestored,
      restoreNode.id,
    );
    if (result) setRestoreNode(null);
  }, [commitMutation, copy.sourceRestored, locale, restoreNode]);

  const reorderNode = useCallback(
    async (node: DictionaryClassificationNodeDto, direction: -1 | 1) => {
      const siblings = [...(tree.childrenByParent.get(classificationParentKey(node.parentId)) ?? [])];
      const index = siblings.findIndex((sibling) => sibling.id === node.id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
      [siblings[index], siblings[targetIndex]] = [siblings[targetIndex], siblings[index]];
      await commitMutation(
        () =>
          window.desktopApi.dictionaryClassificationReorder({
            parentId: node.parentId,
            orderedIds: siblings.map((sibling) => sibling.id),
            locale,
          }),
        copy.reordered,
        node.id,
      );
    },
    [commitMutation, copy.reordered, locale, tree.childrenByParent],
  );

  const reorderRoots = useCallback(
    async (orderedIds: string[]) => {
      const result = await commitMutation(
        () => window.desktopApi.dictionaryClassificationReorder({ parentId: null, orderedIds, locale }),
        copy.reordered,
      );
      if (result) setRootOrderOpen(false);
    },
    [commitMutation, copy.reordered, locale],
  );

  const saveNode = useCallback(
    (
      node: DictionaryClassificationNodeDto,
      name: string,
      nameLocale: string,
      localizations: DictionaryClassificationLocalizationDto[],
    ) =>
      commitMutation(
        () =>
          window.desktopApi.dictionaryClassificationUpdate({ id: node.id, name, nameLocale, localizations, locale }),
        copy.updated,
        node.id,
      ),
    [commitMutation, copy.updated, locale],
  );

  return {
    busy,
    editorState,
    setEditorState,
    moveNode,
    setMoveNode,
    moveInitialParentId,
    mergeNode,
    setMergeNode,
    stateNode,
    setStateNode,
    restoreNode,
    setRestoreNode,
    rootOrderOpen,
    setRootOrderOpen,
    commitMutation,
    submitEditor,
    openMove,
    previewMove,
    commitMove,
    previewMerge,
    commitMerge,
    confirmStateChange,
    restoreSource,
    reorderNode,
    reorderRoots,
    saveNode,
  };
}

export type ClassificationMutations = ReturnType<typeof useClassificationMutations>;
