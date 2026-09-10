import { useMemo, useRef, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { AlbumDto } from '@/shared/contracts';
import type {
  CreationFormProjection,
  CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  CREATION_OUTLINE_BATCH_LIMIT,
  type CreationOutlineCommand,
  type CreationOutlineResult,
} from '@/shared/contracts/creation-outline';
import {
  createOutlineTree,
  outlineAncestors,
  outlineRows,
  outlineBranchKeys,
  outermostSelection,
  canMoveOutlineTo,
  type OutlineNode,
} from '@/renderer/features/creation-outline/outline-tree';
import { useOutlineSelection } from '@/renderer/features/creation-outline/useOutlineSelection';
import { OutlineTreeRow } from '@/renderer/features/creation-outline/OutlineTreeRow';
import { OutlineMoveDialog } from '@/renderer/features/creation-outline/OutlineMoveDialog';
import { OutlineToolbar } from '@/renderer/features/creation-outline/OutlineToolbar';
import { useOutlineDrag } from '@/renderer/features/creation-outline/useOutlineDrag';
import { useOutlineVideoDocuments } from '@/renderer/features/creation-outline/useOutlineVideoDocuments';

export interface CreationOutlineProps {
  albums: readonly AlbumDto[];
  creations: readonly CreationItemProjection[];
  initialAlbumId?: string | null;
  active?: boolean;
  documentNavigationRevision?: number;
  busy: boolean;
  onCommand(command: CreationOutlineCommand): Promise<CreationOutlineResult>;
  onOpenCreationForm(form: CreationFormProjection): void;
  onOpenAlbum(id: string): void;
  onOpenSeries(id: string): void;
}

export function CreationOutline({
  albums,
  creations,
  initialAlbumId,
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
  const tree = useMemo(
    () => createOutlineTree(albums, videoDocuments.items, messages.creator.album),
    [albums, videoDocuments.items, messages.creator.album],
  );
  const [scopeKey, setScopeKey] = useState<string | null>(initialAlbumId ? 'album:' + initialAlbumId : null);
  const scope = scopeKey && tree.nodes.has(scopeKey) ? scopeKey : null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const locked = busy || pending;
  const searching = query.trim().length > 0;
  const expandedKeys = useMemo(
    () => (searching ? new Set([...tree.nodes.keys()].filter((key) => !searchCollapsed.has(key))) : expanded),
    [tree, searching, searchCollapsed, expanded],
  );
  const rows = useMemo(() => outlineRows(tree, scope, expandedKeys, query), [tree, scope, expandedKeys, query]);
  const branchKeys = useMemo(() => outlineBranchKeys(tree, scope), [tree, scope]);
  const path = (node: OutlineNode) => [...outlineAncestors(tree, node.key), node].map((item) => item.title).join(' / ');
  function open(key: string) {
    const node = tree.nodes.get(key);
    if (!node) return;
    if (node.kind === 'album') onOpenAlbum(node.target!.id);
    else if (node.seriesId) onOpenSeries(node.seriesId);
    else if (node.form) onOpenCreationForm(node.form);
  }
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
  const selection = useOutlineSelection(rows, open, toggle, expandedKeys, true);
  const selectedRoots = outermostSelection(tree, selection.selection);
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
  async function execute(command: CreationOutlineCommand) {
    if (locked || pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError('');
    setStatus('');
    try {
      const result = await onCommand(command);
      if (result.kind === 'error') {
        setError(labels.errors[result.code]);
        return false;
      }
      if (result.kind === 'undone' || result.count > 0) setUndoToken(result.kind === 'moved' ? result.undoToken : null);
      setStatus(result.kind === 'moved' ? labels.moved(result.count) : labels.undone);
      selection.clear();
      return true;
    } catch {
      setError(labels.errors.FAILED);
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  async function move(nodes: readonly OutlineNode[], albumId: string | null) {
    if (!canMoveOutlineTo(tree, nodes, albumId) || nodes.length > CREATION_OUTLINE_BATCH_LIMIT) return;
    if (await execute({ kind: 'move', targets: nodes.flatMap((node) => (node.target ? [node.target] : [])), albumId }))
      setMoveOpen(false);
  }
  const drag = useOutlineDrag(tree, selection.selection, locked, move);
  const breadcrumbs = scope ? [...outlineAncestors(tree, scope), tree.nodes.get(scope)!] : [];
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      aria-label={labels.title}
      onDragOver={drag.ignore}
      onDrop={drag.ignore}
      onDragLeave={drag.leave}
    >
      <OutlineToolbar
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
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div
          role="tree"
          aria-label={labels.title}
          aria-multiselectable="true"
          aria-busy={pending || videoDocuments.loading}
          className="min-h-40 py-1"
        >
          {rows.map((row) => (
            <OutlineTreeRow
              key={row.node.key}
              row={row}
              active={active}
              path={path(row.node)}
              expanded={expandedKeys.has(row.node.key)}
              collapsible
              selected={selection.selection.includes(row.node.key)}
              focused={selection.focusKey === row.node.key}
              drop={drag.dropKey === row.node.key}
              busy={locked}
              elementRef={(element) => {
                if (element) selection.elements.current.set(row.node.key, element);
                else selection.elements.current.delete(row.node.key);
              }}
              onChoose={(event) => selection.choose(row.node.key, event.shiftKey, event.ctrlKey || event.metaKey)}
              onKeyDown={(event) => selection.onKeyDown(event, row)}
              onToggle={(wholeBranch) => {
                toggle(row.node.key, wholeBranch);
                selection.focusRow(row.node.key);
              }}
              onFocus={() => focus(row.node.key)}
              onOpen={() => open(row.node.key)}
              onDragStart={(event) => drag.start(event, row.node.key)}
              onDragEnd={drag.clear}
              onDragOver={(event) => {
                if (row.node.kind === 'album') drag.over(event, row.node.target!.id, row.node.key);
                else drag.ignore(event);
              }}
              onDrop={(event) => {
                if (row.node.kind === 'album') drag.drop(event, row.node.target!.id);
                else drag.ignore(event);
              }}
            />
          ))}
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{labels.empty}</div>
          )}
        </div>
      </ScrollArea>
      {(pending || videoDocuments.loading) && (
        <div className="flex justify-center p-2">
          <LoaderCircleIcon className="size-4 animate-spin" aria-label={pending ? labels.move : labels.loading} />
        </div>
      )}
      {moveOpen && (
        <OutlineMoveDialog
          tree={tree}
          selection={selectedRoots}
          busy={locked}
          error={error}
          onClose={() => setMoveOpen(false)}
          onMove={(albumId) => move(selectedRoots, albumId)}
        />
      )}
    </section>
  );
}
