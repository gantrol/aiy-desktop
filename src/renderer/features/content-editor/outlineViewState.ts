import type { Editor } from '@tiptap/core';
import { activeOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Step, StepResult } from '@tiptap/pm/transform';
import { isOutlineChildList } from '@/shared/outline-structure';
import type { OutlineDropPlacement } from '@/renderer/features/content-editor/outlineMove';
import { outlineMoveTargets } from '@/renderer/features/content-editor/outlineMove';

export interface OutlineViewState {
  folded: ReadonlySet<string>;
  foldedByFocus: ReadonlyMap<string | null, ReadonlySet<string>>;
  selected: readonly string[];
  anchor: string | null;
  active: string | null;
  focus: string | null;
  drop: { id: string; placement: OutlineDropPlacement } | null;
  drag: { ids: readonly string[]; validTargets: ReadonlySet<string> } | null;
}

const initialState: OutlineViewState = {
  folded: new Set(),
  foldedByFocus: new Map(),
  selected: [],
  anchor: null,
  active: null,
  focus: null,
  drop: null,
  drag: null,
};

const outlineViewKey = new PluginKey<OutlineViewState>('aiy-outline-view');
const outlineHistoryBoundary = 'aiy:outline-history-boundary';

type ViewSnapshot = {
  folded: string[];
  foldedByFocus: [string | null, string[]][];
  selected: string[];
  anchor: string | null;
  active: string | null;
  focus: string | null;
};

function viewSnapshot(view: OutlineViewState): ViewSnapshot {
  return {
    folded: [...view.folded],
    foldedByFocus: [...view.foldedByFocus].map(([scope, folded]) => [scope, [...folded]]),
    selected: [...view.selected],
    anchor: view.anchor,
    active: view.active,
    focus: view.focus,
  };
}

function restoreView(snapshot: ViewSnapshot): OutlineViewState {
  return {
    ...snapshot,
    folded: new Set(snapshot.folded),
    foldedByFocus: new Map(snapshot.foldedByFocus.map(([scope, folded]) => [scope, new Set(folded)])),
    drag: null,
    drop: null,
  };
}

/** A local history step: the document and its serialized content remain identical. */
class OutlineViewStep extends Step {
  constructor(
    readonly before: ViewSnapshot,
    readonly after: ViewSnapshot,
  ) {
    super();
  }

  apply(doc: ProseMirrorNode) {
    return StepResult.ok(doc);
  }

  invert() {
    return new OutlineViewStep(this.after, this.before);
  }

  map() {
    return this;
  }

  toJSON() {
    return { stepType: 'aiyOutlineView', before: this.before, after: this.after };
  }

  static fromJSON(_schema: unknown, json: { before: ViewSnapshot; after: ViewSnapshot }) {
    return new OutlineViewStep(json.before, json.after);
  }
}

Step.jsonID('aiyOutlineView', OutlineViewStep);

/** Attach selection/folds to the same transaction as a structural change. */
export function attachOutlineView(transaction: Transaction, next: OutlineViewState, previous?: OutlineViewState) {
  if (previous) {
    closeHistory(transaction).step(new OutlineViewStep(viewSnapshot(previous), viewSnapshot(next)));
    transaction.setMeta(outlineHistoryBoundary, true);
  }
  return transaction.setMeta(outlineViewKey, next);
}
const scopeScroll = new WeakMap<Editor, Map<string | null, { top: number; id: string | null; offset: number }>>();
const visibilityCache = new WeakMap<
  ProseMirrorNode,
  WeakMap<OutlineViewState, Map<string, 'inside' | 'path' | 'outside'>>
>();

export function outlineViewState(state: EditorState): OutlineViewState {
  return outlineViewKey.getState(state) ?? initialState;
}

function itemId(item: ProseMirrorNode): string | null {
  return typeof item.attrs.blockId === 'string' && item.attrs.blockId ? item.attrs.blockId : null;
}

interface OutlineItemSummary {
  id: string;
  ancestors: readonly string[];
  hasChildren: boolean;
}

function outlineItemSummaries(doc: ProseMirrorNode): OutlineItemSummary[] {
  const summaries: OutlineItemSummary[] = [];
  const visit = (list: ProseMirrorNode, ancestors: readonly string[]) => {
    list.forEach((item) => {
      if (item.type.name !== 'listItem') return;
      const id = itemId(item);
      if (!id) return;
      const childLists: ProseMirrorNode[] = [];
      item.forEach((child) => {
        if (isOutlineChildList({ type: child.type.name, attrs: child.attrs }) && child.childCount > 0)
          childLists.push(child);
      });
      summaries.push({ id, ancestors, hasChildren: childLists.length > 0 });
      childLists.forEach((childList) => visit(childList, [...ancestors, id]));
    });
  };
  doc.forEach((child) => {
    if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) visit(child, []);
  });
  return summaries;
}

export function outlineParentIds(doc: ProseMirrorNode, focus: string | null = null): string[] {
  const summaries = outlineItemSummaries(doc);
  return summaries
    .filter((item) => item.hasChildren && (!focus || item.id === focus || item.ancestors.includes(focus)))
    .map((item) => item.id);
}

export function outlineChildBranchIds(item: ProseMirrorNode): string[] {
  const ids: string[] = [];
  item.forEach((group) => {
    if (!isOutlineChildList({ type: group.type.name, attrs: group.attrs })) return;
    group.forEach((child) => {
      const id = itemId(child);
      if (child.type.name !== 'listItem' || !id) return;
      let hasChildren = false;
      child.forEach((content) => {
        if (isOutlineChildList({ type: content.type.name, attrs: content.attrs }) && content.childCount > 0)
          hasChildren = true;
      });
      if (hasChildren) ids.push(id);
    });
  });
  return ids;
}

interface VisibleItem {
  id: string;
  ancestors: readonly string[];
}

export function outlineVisibleItems(doc: ProseMirrorNode, view: OutlineViewState): VisibleItem[] {
  const all: VisibleItem[] = [];
  const visit = (list: ProseMirrorNode, ancestors: readonly string[]) => {
    list.forEach((item) => {
      if (item.type.name !== 'listItem') return;
      const id = itemId(item);
      if (!id) return;
      all.push({ id, ancestors });
      if (view.folded.has(id)) return;
      item.forEach((child) => {
        if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) visit(child, [...ancestors, id]);
      });
    });
  };
  doc.forEach((child) => {
    if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) visit(child, []);
  });
  if (!view.focus) return all;
  const root = all.find((item) => item.id === view.focus);
  if (!root) return all;
  return all.filter((item) => item.id === root.id || item.ancestors.includes(root.id));
}

export function outlinePlacementWithinFocus(
  doc: ProseMirrorNode,
  view: OutlineViewState,
  sourceIds: readonly string[],
  targetId: string,
  placement: OutlineDropPlacement,
) {
  if (!view.focus) return true;
  if (targetId === view.focus && placement !== 'INSIDE') return false;
  return outlineScopedTargets(doc, view, sourceIds, new Set([targetId])).has(targetId);
}

export function outlineScopedTargets(
  doc: ProseMirrorNode,
  view: OutlineViewState,
  sourceIds: readonly string[],
  candidates: ReadonlySet<string>,
) {
  if (!view.focus) return candidates;
  const inside = new Set(
    outlineVisibleItems(doc, { ...view, focus: null, folded: new Set() })
      .filter((row) => row.ancestors.includes(view.focus!))
      .map((row) => row.id),
  );
  if (sourceIds.some((id) => !inside.has(id))) return new Set<string>();
  return new Set([...candidates].filter((id) => id === view.focus || inside.has(id)));
}

export function outlineItemVisibility(doc: ProseMirrorNode, view: OutlineViewState, id: string) {
  if (!view.focus) return 'inside' as const;
  let byView = visibilityCache.get(doc);
  if (!byView) {
    byView = new WeakMap();
    visibilityCache.set(doc, byView);
  }
  let visibility = byView.get(view);
  if (!visibility) {
    const rows = outlineVisibleItems(doc, { ...view, focus: null, folded: new Set() });
    const focused = rows.find((item) => item.id === view.focus);
    visibility = new Map();
    const ancestors = new Set(focused?.ancestors ?? []);
    for (const item of rows)
      visibility.set(
        item.id,
        !focused || item.id === view.focus || item.ancestors.includes(view.focus)
          ? 'inside'
          : ancestors.has(item.id)
            ? 'path'
            : 'outside',
      );
    byView.set(view, visibility);
  }
  return visibility.get(id) ?? 'inside';
}

function scrollContainer(editor: Editor): HTMLElement | null {
  let current = editor.view.dom.parentElement;
  while (current) {
    const overflow = window.getComputedStyle(current).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return current;
    current = current.parentElement;
  }
  return null;
}

function captureScopeScroll(editor: Editor, root: HTMLElement) {
  const boundary = root.getBoundingClientRect().top;
  const row = Array.from(
    root.querySelectorAll<HTMLElement>('.aiy-outline-item[data-outline-visibility="inside"]'),
  ).find((item) => {
    const title = item.querySelector<HTMLElement>(
      ':scope > [data-node-view-content] > [data-node-view-content-react] > p:first-child',
    );
    const rect = (title ?? item).getBoundingClientRect();
    return rect.bottom > boundary && rect.top < root.getBoundingClientRect().bottom;
  });
  const title = row?.querySelector<HTMLElement>(
    ':scope > [data-node-view-content] > [data-node-view-content-react] > p:first-child',
  );
  const positions = scopeScroll.get(editor) ?? new Map();
  positions.set(outlineViewState(editor.state).focus, {
    top: root.scrollTop,
    id: row?.dataset.outlineId ?? null,
    offset: row ? (title ?? row).getBoundingClientRect().top - boundary : 0,
  });
  scopeScroll.set(editor, positions);
}

function restoreScopeScroll(editor: Editor, root: HTMLElement, focus: string | null) {
  const saved = scopeScroll.get(editor)?.get(focus);
  requestAnimationFrame(() => {
    if (editor.isDestroyed || outlineViewState(editor.state).focus !== focus) return;
    if (!saved) {
      root.scrollTop = 0;
      return;
    }
    root.scrollTop = saved.top;
    const row = saved.id
      ? Array.from(root.querySelectorAll<HTMLElement>('.aiy-outline-item[data-outline-id]')).find(
          (item) => item.dataset.outlineId === saved.id && item.getBoundingClientRect().height > 0,
        )
      : null;
    if (row) {
      const title = row.querySelector<HTMLElement>(
        ':scope > [data-node-view-content] > [data-node-view-content-react] > p:first-child',
      );
      root.scrollTop += (title ?? row).getBoundingClientRect().top - root.getBoundingClientRect().top - saved.offset;
    }
  });
}

export function outlineFocusPath(doc: ProseMirrorNode, id: string): { id: string; title: string }[] {
  const visit = (
    list: ProseMirrorNode,
    path: readonly { id: string; title: string }[],
  ): { id: string; title: string }[] => {
    for (let index = 0; index < list.childCount; index += 1) {
      const item = list.child(index);
      if (item.type.name !== 'listItem') continue;
      const currentId = itemId(item);
      if (!currentId) continue;
      const next = [...path, { id: currentId, title: item.firstChild?.textContent.trim().slice(0, 80) || '…' }];
      if (currentId === id) return next;
      for (let child = 1; child < item.childCount; child += 1) {
        const group = item.child(child);
        if (!isOutlineChildList({ type: group.type.name, attrs: group.attrs })) continue;
        const found = visit(group, next);
        if (found.length) return found;
      }
    }
    return [];
  };
  for (let index = 0; index < doc.childCount; index += 1) {
    const list = doc.child(index);
    if (!isOutlineChildList({ type: list.type.name, attrs: list.attrs })) continue;
    const found = visit(list, []);
    if (found.length) return found;
  }
  return [];
}

export function setOutlineView(editor: Editor, next: OutlineViewState) {
  if (editor.isDestroyed) return;
  const active = next.active && next.selected.includes(next.active) ? next.active : (next.selected.at(-1) ?? null);
  editor.view.dispatch(editor.state.tr.setMeta(outlineViewKey, { ...next, active }).setMeta('addToHistory', false));
}

function changeOutlineFocus(doc: ProseMirrorNode, current: OutlineViewState, focus: string | null): OutlineViewState {
  if (current.focus === focus) return current;
  const foldedByFocus = new Map(current.foldedByFocus).set(current.focus, current.folded);
  const saved = foldedByFocus.get(focus);
  // A scope starts with its own open tree; it must not inherit the whole document's folds.
  const folded = new Set(saved ?? []);
  if (focus) {
    const path = outlineFocusPath(doc, focus);
    // Ancestors must reveal the focused scope; only its first visit opens the scope root.
    for (const item of path) if (item.id !== focus || !saved) folded.delete(item.id);
  }
  return { ...current, focus, folded, foldedByFocus, selected: [], anchor: null, active: null, drag: null, drop: null };
}

function setOutlineItemsFolded(editor: Editor, ids: ReadonlySet<string>, collapse: boolean) {
  if (editor.isDestroyed || activeOutlineView(editor).composing) return false;
  const current = outlineViewState(editor.state);
  const transaction = editor.state.tr;
  const folded = new Set(current.folded);
  let changed = false;
  editor.state.doc.descendants((item, position) => {
    const id = itemId(item);
    if (item.type.name !== 'listItem' || !id || !ids.has(id)) return;
    if (current.folded.has(id) === collapse) return;
    let hasChildren = false;
    item.forEach((child, offset) => {
      if (!isOutlineChildList({ type: child.type.name, attrs: child.attrs }) || !child.childCount) return;
      hasChildren = true;
      const from = position + 1 + offset;
      const selection = editor.state.selection;
      if (collapse && !transaction.selectionSet && selection.from < from + child.nodeSize && selection.to > from)
        transaction.setSelection(TextSelection.near(editor.state.doc.resolve(position + 2)));
    });
    if (hasChildren) {
      if (collapse) folded.add(id);
      else folded.delete(id);
      changed = true;
    }
  });
  if (!changed) return false;
  // Change only the requested level; deeper fold choices survive collapse and expansion.
  const visible = new Set(outlineVisibleItems(editor.state.doc, { ...current, folded }).map((item) => item.id));
  const next: OutlineViewState = {
    ...current,
    folded,
    selected: current.selected.filter((selected) => visible.has(selected)),
    anchor: current.anchor && visible.has(current.anchor) ? current.anchor : null,
    active: current.active && visible.has(current.active) ? current.active : null,
  };
  editor.view.dispatch(attachOutlineView(transaction, next, current));
  return true;
}

export function setSelectedOutlineItemsFolded(editor: Editor, folded: boolean) {
  if (!editor.isEditable) return false;
  return setOutlineItemsFolded(editor, new Set(outlineViewState(editor.state).selected), folded);
}

export function toggleOutlineFold(editor: Editor, id: string) {
  return setOutlineItemsFolded(editor, new Set([id]), !outlineViewState(editor.state).folded.has(id));
}

export function toggleOutlineChildBranches(editor: Editor, id: string) {
  if (editor.isDestroyed || activeOutlineView(editor).composing) return false;
  let ids: string[] = [];
  editor.state.doc.descendants((item) => {
    if (item.type.name !== 'listItem' || itemId(item) !== id) return;
    ids = outlineChildBranchIds(item);
    return false;
  });
  if (!ids.length) return false;
  const current = outlineViewState(editor.state);
  return setOutlineItemsFolded(
    editor,
    new Set(ids),
    ids.some((childId) => !current.folded.has(childId)),
  );
}

export function toggleOutlineAllParents(editor: Editor) {
  if (editor.isDestroyed || activeOutlineView(editor).composing) return false;
  const current = outlineViewState(editor.state);
  const ids = outlineParentIds(editor.state.doc, current.focus);
  if (!ids.length) return false;
  return setOutlineItemsFolded(
    editor,
    new Set(ids),
    ids.some((id) => !current.folded.has(id)),
  );
}

export function selectOutlineItem(editor: Editor, id: string, shift = false, additive = false) {
  const current = outlineViewState(editor.state);
  const visible = outlineVisibleItems(editor.state.doc, current).map((item) => item.id);
  const index = visible.indexOf(id);
  if (index < 0) return;
  if (shift) {
    const anchorIndex = visible.indexOf(current.anchor ?? id);
    const from = Math.min(index, anchorIndex < 0 ? index : anchorIndex);
    const to = Math.max(index, anchorIndex < 0 ? index : anchorIndex);
    const range = visible.slice(from, to + 1);
    setOutlineView(editor, {
      ...current,
      selected: additive ? [...new Set([...current.selected, ...range])] : range,
      anchor: current.anchor ?? id,
      active: id,
    });
  } else if (additive) {
    setOutlineView(editor, {
      ...current,
      selected: current.selected.includes(id)
        ? current.selected.filter((selected) => selected !== id)
        : [...current.selected, id],
      anchor: id,
      active: id,
    });
  } else setOutlineView(editor, { ...current, selected: [id], anchor: id, active: id });
}

export function focusOutlineItem(editor: Editor, id: string | null) {
  if (editor.isDestroyed || activeOutlineView(editor).composing) return;
  if (id && !outlineFocusPath(editor.state.doc, id).length) return;
  const current = outlineViewState(editor.state);
  const root = current.focus !== id ? scrollContainer(editor) : null;
  if (root) captureScopeScroll(editor, root);
  const next = changeOutlineFocus(editor.state.doc, current, id);
  const visible = new Set(outlineVisibleItems(editor.state.doc, next).map((item) => item.id));
  const { $from, $to } = editor.state.selection;
  let target: number | null = null;
  for (const resolved of [$from, $to]) {
    for (let depth = 1; depth <= resolved.depth; depth += 1) {
      const nodeId = itemId(resolved.node(depth));
      if (resolved.node(depth).type.name !== 'listItem' || !nodeId || !visible.has(nodeId)) continue;
      const child = depth < resolved.depth ? resolved.node(depth + 1) : null;
      if (next.folded.has(nodeId) && child && isOutlineChildList({ type: child.type.name, attrs: child.attrs }))
        target = resolved.before(depth) + 2;
    }
  }
  if (
    id &&
    ![$from, $to].every((resolved) => {
      for (let depth = 1; depth <= resolved.depth; depth += 1) if (itemId(resolved.node(depth)) === id) return true;
      return false;
    })
  ) {
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'listItem' && itemId(node) === id) target = position + 2;
    });
    if (target === null) return;
  }
  const transaction = editor.state.tr;
  if (target !== null) transaction.setSelection(TextSelection.create(transaction.doc, target));
  editor.view.dispatch(transaction.setMeta(outlineViewKey, next).setMeta('addToHistory', false));
  if (root) restoreScopeScroll(editor, root, id);
}

export function previewOutlineDrop(editor: Editor, id: string | null, placement?: OutlineDropPlacement) {
  const current = outlineViewState(editor.state);
  const drop = id && placement ? { id, placement } : null;
  if (current.drop?.id === drop?.id && current.drop?.placement === drop?.placement) return;
  setOutlineView(editor, { ...current, drop });
}

export function beginOutlineDrag(editor: Editor, ids: readonly string[]) {
  const current = outlineViewState(editor.state);
  const targets = outlineMoveTargets(editor.state.doc.toJSON(), ids);
  setOutlineView(editor, {
    ...current,
    drag: { ids, validTargets: outlineScopedTargets(editor.state.doc, current, ids, targets) },
    drop: null,
  });
}

export function endOutlineDrag(editor: Editor) {
  const current = outlineViewState(editor.state);
  if (current.drag || current.drop) setOutlineView(editor, { ...current, drag: null, drop: null });
}

export const OutlineView = new Plugin<OutlineViewState>({
  key: outlineViewKey,
  appendTransaction: (transactions, _oldState, state) => {
    if (!transactions.some((transaction) => transaction.getMeta(outlineHistoryBoundary))) return null;
    return closeHistory(state.tr).setMeta('addToHistory', false);
  },
  state: {
    init: () => initialState,
    apply: (transaction, previous, _oldState, nextState) => {
      const historyStep = [...transaction.steps].reverse().find((step) => step instanceof OutlineViewStep);
      const next =
        historyStep instanceof OutlineViewStep
          ? restoreView(historyStep.after)
          : (transaction.getMeta(outlineViewKey) as OutlineViewState | undefined);
      const value = next ?? previous;
      if (!transaction.docChanged) {
        if (value.focus && transaction.selectionSet) {
          const resolved = nextState.doc.resolve(nextState.selection.from);
          const path: string[] = [];
          for (let depth = 1; depth <= resolved.depth; depth += 1) {
            if (resolved.node(depth).type.name === 'listItem' && itemId(resolved.node(depth)))
              path.push(itemId(resolved.node(depth))!);
          }
          if (path.length && !path.includes(value.focus)) return changeOutlineFocus(nextState.doc, value, null);
        }
        return value;
      }
      const ids = new Set(
        outlineVisibleItems(nextState.doc, { ...value, focus: null, folded: new Set() }).map((item) => item.id),
      );
      const scoped = value.focus && !ids.has(value.focus) ? changeOutlineFocus(nextState.doc, value, null) : value;
      const visible = new Set(outlineVisibleItems(nextState.doc, scoped).map((item) => item.id));
      return {
        folded: new Set([...scoped.folded].filter((id) => ids.has(id))),
        foldedByFocus: new Map(
          [...scoped.foldedByFocus]
            .filter(([scope]) => scope === null || ids.has(scope))
            .map(([scope, folded]) => [scope, new Set([...folded].filter((id) => ids.has(id)))]),
        ),
        selected: scoped.selected.filter((id) => visible.has(id)),
        anchor: scoped.anchor && visible.has(scoped.anchor) ? scoped.anchor : null,
        active: scoped.active && visible.has(scoped.active) ? scoped.active : null,
        focus: scoped.focus,
        drop: value.drop && ids.has(value.drop.id) ? value.drop : null,
        drag: null,
      };
    },
  },
});
