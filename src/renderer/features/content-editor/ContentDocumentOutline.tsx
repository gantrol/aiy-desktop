import { useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { OutlineTree } from '@/renderer/components/outline/OutlineTree';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentOutline, contentOutlineRows, outlineIndex } from '@/shared/content-outline';

const emptyCollapsed: ReadonlySet<string> = new Set();
function toggleCollapsed(value: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function focusContentBlock(editor: Editor, id: string): boolean {
  if (editor.isDestroyed || editor.view.composing) return false;
  const matches: { node: ProseMirrorNode; position: number }[] = [];
  // The outline intentionally omits list containers and first paragraphs. Links
  // resolve against the actual document, not that presentation-only projection.
  editor.state.doc.descendants((node, position) => {
    if (node.attrs.blockId === id) matches.push({ node, position });
  });
  if (matches.length !== 1) return false;
  const { node, position } = matches[0];
  const selection =
    NodeSelection.isSelectable(node) && node.isAtom
      ? NodeSelection.create(editor.state.doc, position)
      : TextSelection.near(editor.state.doc.resolve(Math.min(position + 1, editor.state.doc.content.size)));
  editor.view.dispatch(editor.state.tr.setMeta('aiy:block-navigation', id).setSelection(selection).scrollIntoView());
  editor.view.focus();
  return true;
}
export function followContentBlockAnchor(
  editor: Editor,
  event: { target: EventTarget | null; preventDefault(): void; stopPropagation(): void },
): boolean | undefined {
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  // React portal events can bubble through another editor's wrapper. Never
  // intercept links belonging to an example dialog or a different document.
  if (editor.isDestroyed || !target || !editor.view.dom.contains(target) || target.closest('[data-content-reference]'))
    return undefined;
  const href = target.getAttribute('href');
  if (!href?.startsWith('#aiy-block:')) return undefined;
  event.preventDefault();
  event.stopPropagation();
  try {
    return focusContentBlock(editor, decodeURIComponent(href.slice('#aiy-block:'.length)));
  } catch {
    return false;
  }
}
export function ContentDocumentOutline({ editor }: { editor: Editor }) {
  const copy = useI18n().messages.referenceOutline;
  const document = useEditorState({ editor, selector: ({ editor: current }) => current.state.doc });
  const forest = useMemo(() => contentOutline(document.toJSON()), [document]);
  const index = useMemo(() => outlineIndex(forest), [forest]);
  const [scopeId, setScope] = useState<string | null>(null);
  const scope = scopeId && index.nodes.has(scopeId) ? scopeId : null;
  // Each focus range owns its view state. Entering a previously folded branch
  // reveals its contents without unfolding that branch in the whole-document view.
  const [collapsedByScope, setCollapsedByScope] = useState<Map<string | null, Set<string>>>(() => new Map());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const searching = Boolean(query.trim());
  const hidden = searching ? searchCollapsed : (collapsedByScope.get(scope) ?? emptyCollapsed);
  const rows = contentOutlineRows(forest, scope, hidden, query);
  const ancestors: string[] = [];
  for (let id: string | null | undefined = scope; id; id = index.parents.get(id)) ancestors.unshift(id);
  const zoom = (id: string | null) => {
    setScope(id);
    setQuery('');
    setSearchCollapsed(new Set());
  };
  const open = (id: string) => {
    setError(focusContentBlock(editor, id) ? '' : copy.locationMissing);
  };
  return (
    <aside className="flex min-h-0 min-w-0 flex-col" aria-label={copy.contents}>
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <nav aria-label={copy.zoom} className="flex flex-wrap items-center gap-1 px-2 text-xs">
        <Button size="sm" variant="ghost" onClick={() => zoom(null)}>
          {copy.whole}
        </Button>
        {ancestors.map((id) => (
          <Button key={id} size="sm" variant="ghost" className="max-w-40 truncate" onClick={() => zoom(id)}>
            {index.nodes.get(id)?.title || copy.unnamed}
          </Button>
        ))}
      </nav>
      <Input
        className="mx-2 my-1 w-auto"
        aria-label={copy.search}
        placeholder={copy.search}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSearchCollapsed(new Set());
        }}
      />
      <div className="min-h-0 max-h-[60vh] overflow-y-auto px-1">
        <OutlineTree
          label={copy.contents}
          labels={copy}
          rows={rows.map(({ node, depth, parentId }) => ({
            id: node.id,
            title: node.title,
            depth,
            parentId,
            expandable: Boolean(node.children.length),
            expanded: !hidden.has(node.id),
          }))}
          onOpen={open}
          onZoom={zoom}
          onToggle={(id) => {
            if (searching) setSearchCollapsed((value) => toggleCollapsed(value, id));
            else
              setCollapsedByScope((value) =>
                new Map(value).set(scope, toggleCollapsed(value.get(scope) ?? emptyCollapsed, id)),
              );
          }}
        />
      </div>
    </aside>
  );
}
