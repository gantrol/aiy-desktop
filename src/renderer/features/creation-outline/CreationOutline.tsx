import { useMemo, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { itemDragScopeProps } from '@/renderer/components/albums/itemDrag';
import type { AlbumDto } from '@/shared/contracts';
import type {
  CreationFormProjection,
  CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  CREATION_OUTLINE_BATCH_LIMIT,
  type CreationOutlineCommand,
  type CreationOutlineResult,
} from '@/shared/contracts/creation-outline';
import {
  createOutlineTree,
  outlineAncestors,
  outermostSelection,
  type OutlineNode,
} from '@/renderer/features/creation-outline/outline-tree';
import { useOutlineSelection } from '@/renderer/features/creation-outline/useOutlineSelection';
import { OutlineMoveDialog } from '@/renderer/features/creation-outline/OutlineMoveDialog';
import { OutlineToolbar } from '@/renderer/features/creation-outline/OutlineToolbar';
import { useOutlineDrag } from '@/renderer/features/creation-outline/useOutlineDrag';
import { useOutlineCommands } from '@/renderer/features/creation-outline/useOutlineCommands';
import { useOutlineVideoDocuments } from '@/renderer/features/creation-outline/useOutlineVideoDocuments';
import {
  useCreationOutlineNavigation,
  useCreationOutlineDisclosure,
  useCreationOutlineView,
  type CreationOutlineView,
} from '@/renderer/features/creation-outline/useCreationOutlineView';
import { useCreationTreeScroll } from '@/renderer/components/creator/useCreationTreeScroll';
import { useOutlineArticleContent } from '@/renderer/features/creation-outline/useOutlineArticleContent';
import { withArticleStructure, outlineBlockKey } from '@/renderer/features/creation-outline/outlineArticleTree';
import { useOutlineContentNavigation } from '@/renderer/features/creation-outline/useOutlineContentNavigation';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import { useOutlineNodeActions } from '@/renderer/features/creation-outline/useOutlineNodeActions';
import { OutlineActionDialogs } from '@/renderer/features/creation-outline/OutlineActionDialogs';
import { OutlineScopeActions } from '@/renderer/features/creation-outline/OutlineScopeActions';
import { OutlineBrowseList } from '@/renderer/features/creation-outline/OutlineBrowseList';

export interface CreationOutlineProps {
  leadingContent?: import('react').ReactNode;
  spaceId: string;
  refresh(): Promise<void>;
  notify(message: string): void;
  onNew(albumId: string | null, isCurrent: () => boolean): Promise<unknown> | void;
  albums: readonly AlbumDto[];
  creations: readonly CreationItemProjection[];
  initialAlbumId?: string | null;
  currentKey?: string | null;
  view?: CreationOutlineView;
  active?: boolean;
  documentNavigationRevision?: number;
  busy: boolean;
  onCommand(command: CreationOutlineCommand): Promise<CreationOutlineResult>;
  onOpenCreationForm(form: CreationFormProjection): void;
  onOpenAlbum(id: string): void;
  onOpenSeries(id: string): void;
}

export function CreationOutline({
  leadingContent,
  spaceId,
  refresh,
  notify,
  onNew,
  albums,
  creations,
  initialAlbumId,
  currentKey: formCurrentKey = null,
  view: sharedView,
  active = true,
  documentNavigationRevision = 0,
  busy,
  onCommand,
  onOpenCreationForm,
  onOpenAlbum,
  onOpenSeries,
}: CreationOutlineProps) {
  const { messages } = useI18n();
  const labels = messages.creator.outline;
  const videoDocuments = useOutlineVideoDocuments(
    creations,
    messages.creator.album,
    active,
    documentNavigationRevision,
  );
  const baseTree = useMemo(
    () => createOutlineTree(albums, videoDocuments.items, messages.creator.album),
    [albums, videoDocuments.items, messages.creator.album],
  );
  const localView = useCreationOutlineView(initialAlbumId);
  const view = sharedView ?? localView;
  const content = useOutlineArticleContent(spaceId, videoDocuments.items, view, active);
  const tree = useMemo(
    () => withArticleStructure(baseTree, content.entries, labels),
    [baseTree, content.entries, labels],
  );
  const articleId = formCurrentKey ? tree.nodes.get(formCurrentKey)?.articleId : undefined;
  const articleView = useWorkspaceArticleEditorState(articleId ?? '');
  const location = articleView.articleLocation?.blockId;
  const blockKey = formCurrentKey && location ? outlineBlockKey(formCurrentKey, location) : null;
  const currentKey = blockKey && tree.nodes.has(blockKey) ? blockKey : formCurrentKey;
  const { setScopeKey, setSearchCollapsed, query, setQuery } = view;
  const {
    scope,
    expandedKeys,
    rows,
    browseRows,
    branchKeys,
    disclose,
    toggle: toggleBranch,
  } = useCreationOutlineDisclosure(tree, view, currentKey);
  const navigationKey = useCreationOutlineNavigation(tree, currentKey, active, view);
  const viewportRef = useCreationTreeScroll({
    active,
    memory: view.scroll,
    navigationKey,
    currentSelector: '[data-outline-current="true"]',
  });
  const [error, setError] = useState('');
  const openContent = useOutlineContentNavigation(spaceId, active, setError, labels.contentUnavailable);
  const path = (node: OutlineNode) => [...outlineAncestors(tree, node.key), node].map((item) => item.title).join(' / ');
  function open(key: string) {
    const node = tree.nodes.get(key);
    if (!node) return;
    if (node.content) {
      void openContent(node);
      return;
    }
    if (node.contentAction && node.contentAction.action !== 'OPEN') {
      content.load(node.contentAction.articleId, node.contentAction.action === 'MORE');
      return;
    }
    if (node.kind === 'album') onOpenAlbum(node.target!.id);
    else if (node.seriesId) onOpenSeries(node.seriesId);
    else if (node.form) onOpenCreationForm(node.form);
  }
  function toggle(key: string, wholeBranch = false) {
    const article = tree.nodes.get(key)?.articleId;
    if (article && !expandedKeys.has(key)) content.load(article);
    toggleBranch(key, wholeBranch);
  }
  const selection = useOutlineSelection(rows, open, toggle, expandedKeys, true, currentKey);
  const {
    pending,
    locked: commandLocked,
    moveOpen,
    setMoveOpen,
    undoToken,
    status,
    execute,
    move,
  } = useOutlineCommands({
    tree,
    busy,
    onCommand,
    onSuccess: selection.clear,
    onError: setError,
  });
  const nodeActions = useOutlineNodeActions({
    spaceId,
    active,
    busy: commandLocked,
    albums,
    refresh,
    notify,
    onError: setError,
    onNew,
  });
  const locked = commandLocked || nodeActions.pending || !active;
  const [moveKeys, setMoveKeys] = useState<string[] | null>(null);
  const selectedRoots = outermostSelection(tree, selection.selection);
  const moveSelection = moveKeys ? outermostSelection(tree, moveKeys) : selectedRoots;
  const movable =
    selectedRoots.length > 0 &&
    selectedRoots.length <= CREATION_OUTLINE_BATCH_LIMIT &&
    selectedRoots.every((node) => node.target);
  function focus(key: string | null) {
    selection.clear();
    setScopeKey(key);
    setQuery('');
    setSearchCollapsed(new Set());
    drag.clear();
  }
  const drag = useOutlineDrag(tree, selection.selection, locked, move);
  const breadcrumbs = scope ? [...outlineAncestors(tree, scope), tree.nodes.get(scope)!] : [];
  const scopeNode = scope ? tree.nodes.get(scope)! : null;
  function moveNode(node: OutlineNode) {
    setError('');
    setMoveKeys([node.key]);
    setMoveOpen(true);
  }
  const scopeActions = (
    <OutlineScopeActions
      node={scopeNode}
      busy={locked}
      actions={nodeActions}
      organization={{ spaceId, refresh, onError: setError }}
      onOpenNode={(node) => open(node.key)}
      onMoveNode={moveNode}
      onOpenSourceNode={(node) => void openContent(node, true)}
    />
  );
  return (
    <section
      {...itemDragScopeProps}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      aria-label={labels.title}
      onDragOver={drag.ignore}
      onDrop={drag.ignore}
      onDragLeave={drag.leave}
    >
      <OutlineToolbar
        scopeActions={scopeActions}
        breadcrumbs={breadcrumbs}
        busy={locked}
        query={query}
        selectedCount={selectedRoots.length}
        movable={movable}
        canUndo={Boolean(undoToken)}
        canExpand={branchKeys.some((key) => !expandedKeys.has(key))}
        canCollapse={branchKeys.some((key) => expandedKeys.has(key))}
        onExpandAll={() => disclose(branchKeys, true)}
        onCollapseAll={() => disclose(branchKeys, false)}
        rootDrop={drag.dropKey === 'root'}
        path={path}
        onFocus={focus}
        onQuery={(value) => {
          selection.clear();
          setQuery(value);
          setSearchCollapsed(new Set());
        }}
        onClear={selection.clear}
        onMove={() => {
          setError('');
          setMoveKeys(null);
          setMoveOpen(true);
        }}
        onUndo={() => {
          if (undoToken) void execute({ kind: 'undo', token: undoToken });
        }}
        onRootDragOver={(event) => drag.over(event, null, 'root')}
        onRootDrop={(event) => drag.drop(event, null)}
      />
      {error && !moveOpen && (
        <div role="alert" className="px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <span role="status" className="sr-only">
        {status}
      </span>
      {videoDocuments.failed && (
        <div role="alert" className="px-3 py-2 text-sm text-destructive">
          {labels.titlesUnavailable}
        </div>
      )}
      <OutlineBrowseList
        leadingContent={leadingContent}
        viewportRef={viewportRef}
        browseRows={browseRows}
        active={active}
        busy={locked}
        loading={pending || nodeActions.pending || videoDocuments.loading}
        currentKey={currentKey}
        expandedKeys={expandedKeys}
        visibility={view.childVisibility}
        selection={selection}
        drag={drag}
        organization={{ spaceId, refresh, onError: setError }}
        nodeActions={nodeActions}
        query={query}
        scopeActions={scopeActions}
        path={path}
        open={open}
        focus={focus}
        toggle={toggle}
        move={moveNode}
        openSource={(node) => void openContent(node, true)}
        clearSearch={() => setQuery('')}
      />
      {(pending || videoDocuments.loading) && (
        <div className="flex justify-center p-2">
          <LoaderCircleIcon className="size-4 animate-spin" aria-label={pending ? labels.move : labels.loading} />
        </div>
      )}
      {moveOpen && (
        <OutlineMoveDialog
          tree={tree}
          selection={moveSelection}
          busy={locked}
          error={error}
          onClose={() => setMoveOpen(false)}
          onMove={(albumId, parentId) => move(moveSelection, albumId, false, parentId)}
        />
      )}
      <OutlineActionDialogs actions={nodeActions} />
    </section>
  );
}
