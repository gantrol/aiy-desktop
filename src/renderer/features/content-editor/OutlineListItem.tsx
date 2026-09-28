import { ListItem } from '@tiptap/extension-list';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
  type NodeViewProps,
} from '@tiptap/react';
import { useEffect, type MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { toggleOutlineTaskState } from '@/renderer/features/content-editor/outlineEditing';
import {
  focusOutlineItem,
  outlineChildBranchIds,
  outlineItemVisibility,
  outlineViewState,
  selectOutlineItem,
  setOutlineView,
  toggleOutlineChildBranches,
  toggleOutlineFold,
} from '@/renderer/features/content-editor/outlineViewState';
import { isOutlineChildList } from '@/shared/outline-structure';
import { OutlineItemMenu } from '@/renderer/features/content-editor/OutlineItemMenu';
import { OutlineBranchRail } from '@/renderer/features/content-editor/OutlineBranchRail';
import { focusOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { editingItemId, outlineTextSelectionItem } from '@/renderer/features/content-editor/outlinePointerSelection';
import { cn } from '@/renderer/lib/utils';
import { useOutlineItemDrag } from '@/renderer/features/content-editor/useOutlineItemDrag';
import './outline-list-item.css';

function insideFoldedContent(node: NodeViewProps['node'], itemPosition: number, position: number) {
  let inside = false;
  node.forEach((child, offset, index) => {
    const start = itemPosition + 1 + offset;
    if (index > 0 && position >= start && position < start + child.nodeSize) inside = true;
  });
  return inside;
}

function outlineFocusButtonClassName(editing: boolean) {
  return cn(
    'h-7 w-6 rounded-sm hover:bg-transparent',
    editing
      ? 'text-[var(--button-primary)] hover:text-[var(--button-primary)]'
      : 'text-muted-foreground hover:text-foreground',
  );
}

function OutlineItem({ node, editor, getPos }: NodeViewProps) {
  const initialPosition = getPos();
  const noteItem =
    initialPosition !== undefined &&
    (() => {
      const resolved = editor.state.doc.resolve(initialPosition + 1);
      for (let depth = 1; depth <= resolved.depth; depth += 1) {
        if (resolved.node(depth).attrs.outlineRole === 'NOTE' || resolved.node(depth).type.name === 'taskList')
          return true;
      }
      return false;
    })();
  const { messages } = useI18n();
  const copy = messages.referenceOutline;
  const view = useEditorState({ editor, selector: ({ editor: current }) => outlineViewState(current.state) });
  const id = String(node.attrs.blockId ?? '');
  const editing = useEditorState({ editor, selector: ({ editor: current }) => editingItemId(current) === id });
  const folded = view.folded.has(id);
  const selected = view.selected.includes(id);
  const visibility = outlineItemVisibility(editor.state.doc, view, id);
  const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable });
  const drag = useOutlineItemDrag({ editor, id, selected, view, editable, visibility, getPos });
  let childCount = 0;
  node.forEach((child) => {
    if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) childCount += child.childCount;
  });
  const childBranchIds = outlineChildBranchIds(node);
  const childBranchesExpanded = childBranchIds.some((childId) => !view.folded.has(childId));
  useEffect(() => {
    if (!folded) return;
    const reveal = () => {
      const position = getPos();
      if (position === undefined) return;
      const selection = editor.state.selection;
      // Navigation into a hidden descendant reveals it without changing content.
      if (insideFoldedContent(node, position, selection.from)) toggleOutlineFold(editor, id);
    };
    const revealNavigation = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      if (transaction.getMeta('aiy:block-navigation')) reveal();
    };
    editor.on('selectionUpdate', reveal);
    editor.on('transaction', revealNavigation);
    return () => {
      editor.off('selectionUpdate', reveal);
      editor.off('transaction', revealNavigation);
    };
  }, [editor, folded, getPos, id, node]);

  if (noteItem) {
    return (
      <NodeViewWrapper className="relative pl-5 before:absolute before:left-1 before:top-2 before:size-1 before:rounded-full before:bg-current">
        <NodeViewContent />
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper
      className={`aiy-outline-item relative ${visibility === 'path' ? 'pl-0' : 'pl-6'} ${selected ? 'bg-muted/40' : ''}`}
      data-outline-id={id}
      data-outline-folded={folded ? 'true' : undefined}
      data-outline-visibility={visibility}
      data-outline-selected={selected ? 'true' : undefined}
      data-outline-drop={view.drop?.id === id ? view.drop.placement.toLowerCase() : undefined}
      {...drag.dropBindings}
      onMouseDownCapture={(event: MouseEvent<HTMLElement>) => {
        if (!(event.target instanceof Element) || event.target.closest('.aiy-outline-item') !== event.currentTarget)
          return;
        if (event.target.closest('[data-outline-control]')) return;
        if (event.target instanceof Element && event.target.closest('[data-node-view-content]')) {
          // Modified title clicks belong to item selection; keep the existing range as its anchor.
          if (
            (event.shiftKey || event.ctrlKey || event.metaKey) &&
            outlineTextSelectionItem(event.target, event.currentTarget)
          )
            return;
          if (view.selected.length) setOutlineView(editor, { ...view, selected: [], anchor: null });
          return;
        }
        if (event.target !== event.currentTarget || !editable || !id) return;
        event.preventDefault();
        selectOutlineItem(editor, id, event.shiftKey, event.ctrlKey || event.metaKey);
      }}
    >
      {visibility === 'inside' && childCount > 0 && !folded && (
        <OutlineBranchRail
          action={
            childBranchIds.length
              ? {
                  expanded: childBranchesExpanded,
                  label: childBranchesExpanded ? copy.collapseChildBranches : copy.expandChildBranches,
                  onToggle: () => toggleOutlineChildBranches(editor, id),
                }
              : null
          }
        />
      )}
      {visibility === 'inside' && (
        <div
          data-outline-control
          contentEditable={false}
          className="group/outline-marker absolute left-0 top-0 flex h-7 w-6 items-center"
        >
          {node.childCount > 1 && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={folded ? copy.expand : copy.collapse}
              aria-expanded={!folded}
              title={folded ? copy.expand : copy.collapse}
              className={`absolute -left-3 top-0 z-10 h-7 w-3 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground group-hover/outline-marker:pointer-events-auto group-hover/outline-marker:opacity-100 group-focus-within/outline-marker:pointer-events-auto group-focus-within/outline-marker:opacity-100 ${folded ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                toggleOutlineFold(editor, id);
              }}
            >
              <ChevronRight aria-hidden="true" strokeWidth={1.5} className={`size-3 ${folded ? '' : 'rotate-90'}`} />
            </Button>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className={outlineFocusButtonClassName(editing)}
            data-outline-focus
            draggable={drag.draggable}
            {...drag.markerBindings}
            aria-label={view.focus === id ? copy.whole : copy.zoom}
            aria-pressed={view.focus === id}
            title={view.focus === id ? copy.whole : copy.zoom}
            onClick={(event) => {
              if (drag.dragged.current) return;
              if (event.shiftKey || event.ctrlKey || event.metaKey) {
                selectOutlineItem(editor, id, event.shiftKey, event.ctrlKey || event.metaKey);
                focusOutlineView(editor);
                return;
              }
              focusOutlineItem(editor, view.focus === id ? null : id);
              focusOutlineView(editor);
            }}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          </Button>
        </div>
      )}
      {visibility === 'inside' && (
        <div data-outline-control contentEditable={false} className="absolute right-0 top-0 z-10 flex h-7 items-center">
          {(node.attrs.taskState === 'TODO' || node.attrs.taskState === 'DONE') && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1 text-xs text-muted-foreground"
              role="checkbox"
              aria-checked={node.attrs.taskState === 'DONE'}
              aria-label={`${node.attrs.taskState} · ${node.firstChild?.textContent || id}`}
              disabled={!editable}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleOutlineTaskState(editor, id)}
            >
              {node.attrs.taskState}
            </Button>
          )}
          <OutlineItemMenu
            editor={editor}
            node={node}
            getPos={getPos}
            editable={editable}
            selected={selected}
            selectedIds={view.selected}
            id={id}
          />
        </div>
      )}
      {drag.dragError && (
        <span role="alert" className="block text-xs text-destructive">
          {drag.dragError}
        </span>
      )}
      <NodeViewContent
        className={`min-w-0 [&>[data-node-view-content-react]>p:not(:first-child)]:my-2 [&>[data-node-view-content-react]>p:first-child]:!my-0 [&>[data-node-view-content-react]>p:first-child]:min-h-7 [&>[data-node-view-content-react]>p:first-child]:leading-7 ${node.attrs.taskState ? '[&>[data-node-view-content-react]>p:first-child]:pr-20' : '[&>[data-node-view-content-react]>p:first-child]:pr-7'}`}
      />
    </NodeViewWrapper>
  );
}

/** A dedicated view over the existing list schema: editing, Markdown and history stay shared. */
export const OutlineListItem = ListItem.extend({
  addNodeView: () => ReactNodeViewRenderer(OutlineItem, { as: 'li', className: '!my-1 !list-none !pl-0' }),
});
